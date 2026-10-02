import { DurableObject } from "cloudflare:workers";
import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Registry, createRegistryRequestHandler } from "../src/registry.js";
import { WebAuth } from "../src/web-auth.js";
import { TeamError } from "../src/team-protocol.js";
import { durableDatabase } from "./sqlite.js";

interface Env {
  REGISTRY: DurableObjectNamespace<LoadoutRegistry>;
  ASSETS: Fetcher;
  TEAM_NAME: string;
  TEAM_SCOPE: "work" | "personal";
  FIRST_ADMIN_EMAIL: string;
  PUBLIC_ORIGIN: string;
  BOOTSTRAP_SECRET?: string;
}

const securityHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function secretMatches(actual: string | undefined, expected: string | undefined) {
  if (!actual || !expected) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status, headers: securityHeaders });
}

type RegistryHandler = ReturnType<typeof createRegistryRequestHandler>;

async function boundedBody(request: Request, maxBytes: number): Promise<Buffer | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  let tooLarge = Number(request.headers.get("Content-Length") ?? 0) > maxBytes;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) tooLarge = true;
      if (!tooLarge) chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (tooLarge) throw new TeamError(413, "too_large", "Request exceeds the upload limit.");
  return Buffer.concat(chunks, bytes);
}

async function handleRequest(handler: RegistryHandler, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const maxBytes = url.pathname.startsWith("/api/") ? 16_384
    : url.pathname === "/v1/skills" || url.pathname === "/v1/profiles" ? 45_000_000
    : url.pathname === "/v1/runs" || url.pathname === "/v1/assessments" ? 32_000_000
    : 16_000;
  const requestBytes = await boundedBody(request, maxBytes);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  const req = {
    url: url.pathname + url.search,
    method: request.method,
    headers,
    socket: { remoteAddress: request.headers.get("CF-Connecting-IP") ?? "127.0.0.1" },
    resume: () => {},
    async *[Symbol.asyncIterator]() {
      if (requestBytes) yield requestBytes;
    },
  } as unknown as IncomingMessage;
  const responseHeaders = new Headers(securityHeaders);
  let status = 200;
  let finished: Response | undefined;
  const res = {
    setHeader(name: string, value: string) { responseHeaders.set(name, value); },
    writeHead(code: number, values: Record<string, string>) {
      status = code;
      for (const [name, value] of Object.entries(values)) responseHeaders.set(name, value);
      return this;
    },
    end(body?: string | Buffer) {
      const content = Buffer.isBuffer(body) ? new Uint8Array(body) : body;
      finished = new Response(content ?? null, { status, headers: responseHeaders });
      return this;
    },
  } as unknown as ServerResponse;
  await handler(req, res);
  return finished ?? error(500, "incomplete_response", "The registry did not finish the request.");
}

export class LoadoutRegistry extends DurableObject<Env> {
  private readonly ready: Promise<void>;
  private registry!: Registry;
  private handler!: RegistryHandler;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      if (new URL(env.PUBLIC_ORIGIN).hostname !== "127.0.0.1" && ctx.id.jurisdiction !== "eu")
        throw new Error("Loadout registry must use the EU Durable Object jurisdiction");
      this.registry = new Registry("", {
        teamName: env.TEAM_NAME,
        scope: env.TEAM_SCOPE,
      }, durableDatabase(ctx.storage));
      this.handler = createRegistryRequestHandler(this.registry, {
        origin: () => env.PUBLIC_ORIGIN,
        webRoot: "/__cloudflare_assets__",
        setupEmail: env.FIRST_ADMIN_EMAIL,
      });
    });
  }

  async issueSetupLink() {
    await this.ready;
    const challenge = new WebAuth(this.registry).issueSetup();
    return { url: `${this.env.PUBLIC_ORIGIN}/setup#token=${challenge.token}`, expiresAt: challenge.expiresAt };
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    try {
      return await handleRequest(this.handler, request);
    } catch (cause) {
      if (cause instanceof TeamError) return error(cause.status, cause.code, cause.message);
      throw cause;
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_ORIGIN)
      return error(403, "invalid_host", "Use the configured dashboard address.");
    // Local workerd does not implement jurisdictions; production always uses EU.
    const namespace = url.hostname === "127.0.0.1"
      ? env.REGISTRY
      : env.REGISTRY.jurisdiction("eu");
    const registry = namespace.getByName("loadout-team");
    if (url.pathname === "/__loadout/bootstrap") {
      if (request.method !== "POST") return error(405, "method_not_allowed", "Use POST.");
      const supplied = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
      if (!secretMatches(supplied, env.BOOTSTRAP_SECRET))
        return error(403, "forbidden", "Bootstrap authorization failed.");
      try {
        return Response.json(await registry.issueSetupLink(), { headers: securityHeaders });
      } catch (cause) {
        if (cause instanceof TeamError && cause.code === "setup_closed")
          return error(409, "setup_closed", "The first admin account has already been created.");
        throw cause;
      }
    }
    if (url.pathname === "/health" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/"))
      return registry.fetch(request);
    const asset = await env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
  },
};
