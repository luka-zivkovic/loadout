import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  assessmentSchema,
  id,
  metricsSchema,
  harnessSchema,
} from "./schema.js";
import { inside } from "./files.js";
import { TeamError } from "./team-protocol.js";
import {
  WebAuth,
  emailSchema,
  memberProfileSchema,
  passwordSchema,
  personSchema,
  roleSchema,
} from "./web-auth.js";
import type { Registry } from "./registry.js";
import { sharingDisclosureText } from "./sharing.js";
import { workspaceApi } from "./workspace-api.js";
import { clientAddress } from "./proxy.js";
import { hasMcpDetails, setupMcpServerNames } from "./setups.js";

const shortToken = z.string().max(100);
const userCode = z.string().regex(/^[A-Fa-f0-9]{5}-[A-Fa-f0-9]{5}$/);
const browserSecurityHeaders = {
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};
function parseUrl(value: string, message: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(message);
  }
}
export function publicOrigin(value: string) {
  const url = parseUrl(
    value,
    "--public-url must be the dashboard's origin, without credentials or a path",
  );
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error(
      "--public-url must be the dashboard's origin, without credentials or a path",
    );
  if (
    url.protocol === "http:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("The public dashboard URL must use HTTPS outside loopback");
  return url.origin;
}
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...browserSecurityHeaders,
  });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new TeamError(415, "content_type", "Use application/json.");
  if (Number(req.headers["content-length"] ?? 0) > 16_384)
    throw new TeamError(413, "too_large", "Request is too large.");
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16_384)
      throw new TeamError(413, "too_large", "Request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new TeamError(400, "invalid_json", "Invalid request.");
  }
}
function cookie(value: string, secure: boolean, clear = false) {
  return `pi_share_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${secure ? "; Secure" : ""}`;
}
export function registrationInstructions(registry: Registry, origin: string) {
  return `Connect my local Pi, Claude Code, or Codex harness to Loadout (${registry.metadata.teamName}).\n\n1. Use the locally installed loadout CLI. If it is missing, ask me for the Loadout repository location and run the commands below with node /path/to/pi-share/dist/cli.js instead of loadout. Do not install a similarly named package from a public registry.\n2. Run:\n   loadout team login ${registry.metadata.teamName} --scope ${registry.metadata.scope} --url ${origin}\n3. Show me the device code and browser approval link. Wait for me to sign in and approve the matching device code. Never ask for my password or approve the device for me.\n4. After approval, run:\n   loadout team status ${registry.metadata.teamName} --scope ${registry.metadata.scope}\n5. Report the connected team, member, and device status. Do not capture, publish, or sync existing data until I explicitly choose to do so.\n\nThis instruction contains no access credential. Account registration requires a separate admin invitation.\n\n${sharingDisclosureText()}\n`;
}

export function createWebHandler(
  registry: Registry,
  options: { origin: () => string; webRoot: string; trustedProxies?: string[] },
) {
  const auth = new WebAuth(registry);
  return async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://internal.invalid");
    const path = url.pathname;
    const deviceRoute = path.startsWith("/v1/device/");
    const api = path.startsWith("/api/");
    if (!api && !deviceRoute && req.method !== "GET" && req.method !== "HEAD")
      return false;
    if (!api && !deviceRoute && (path.startsWith("/v1/") || path === "/health"))
      return false;
    const origin = options.origin();
    if (
      req.headers.host !==
      parseUrl(origin, "The configured dashboard address is invalid.").host
    )
      throw new TeamError(
        403,
        "invalid_host",
        "Use the configured dashboard address.",
      );
    if (req.headers.origin && req.headers.origin !== origin)
      throw new TeamError(
        403,
        "invalid_origin",
        "Request origin is not allowed.",
      );
    if (api && req.method !== "GET" && req.headers.origin !== origin)
      throw new TeamError(
        403,
        "origin_required",
        "Use the dashboard to perform this action.",
      );
    if (deviceRoute) {
      if (req.headers.origin)
        throw new TeamError(
          403,
          "cli_only",
          "Start device registration from the local CLI.",
        );
      if (req.method === "POST" && path === "/v1/device/start") {
        auth.rateLimit(
          `device-start:${clientAddress(req, options.trustedProxies ?? [])}`,
          30,
        );
        const input = z
          .object({ label: z.string().min(1).max(80) })
          .strict()
          .parse(await body(req));
        json(res, 200, {
          ...auth.beginDevice(input.label),
          verificationUrl: `${origin}/devices`,
          team: registry.metadata,
        });
        return true;
      }
      if (req.method === "POST" && path === "/v1/device/poll") {
        const input = z
          .object({ deviceCode: shortToken })
          .strict()
          .parse(await body(req));
        json(res, 200, auth.pollDevice(input.deviceCode));
        return true;
      }
      json(res, 404, {
        error: "not_found",
        message: "Unknown device endpoint.",
      });
      return true;
    }
    if (api) {
      let session = auth.session(req.headers.cookie);
      if (req.method === "GET" && path === "/api/session") {
        json(res, 200, {
          user: session?.user ?? null,
          csrf: session?.csrf ?? null,
          setupRequired: auth.setupRequired(),
          team: registry.metadata,
        });
        return true;
      }
      const authPaths = [
        "/api/auth/setup",
        "/api/auth/login",
        "/api/auth/join",
        "/api/auth/reset",
        "/api/auth/challenge",
      ];
      if (req.method === "POST" && authPaths.includes(path)) {
        auth.rateLimit(
          `auth:${clientAddress(req, options.trustedProxies ?? [])}`,
          30,
        );
        const raw = await body(req);
        if (path === "/api/auth/challenge") {
          const input = z
            .object({ token: shortToken, kind: z.enum(["invite", "reset"]) })
            .strict()
            .parse(raw);
          json(res, 200, auth.challengeInfo(input.token, input.kind));
          return true;
        }
        let result;
        if (path === "/api/auth/setup")
          result = await auth.setup(
            personSchema
              .extend({ token: shortToken, password: passwordSchema })
              .strict()
              .parse(raw),
          );
        else if (path === "/api/auth/login") {
          const input = z
            .object({ email: emailSchema, password: passwordSchema })
            .strict()
            .parse(raw);
          result = await auth.login(input.email, input.password);
        } else if (path === "/api/auth/join")
          result = await auth.join(
            z
              .object({
                token: shortToken,
                name: z.string().min(1).max(100),
                password: passwordSchema,
              })
              .strict()
              .parse(raw),
          );
        else {
          const input = z
            .object({ token: shortToken, password: passwordSchema })
            .strict()
            .parse(raw);
          result = await auth.resetPassword(input.token, input.password);
        }
        res.setHeader(
          "Set-Cookie",
          cookie(result.sessionToken, origin.startsWith("https:")),
        );
        registry.ops.audit(
          result.user.actorId,
          `account.${path.split("/").at(-1)}`,
          result.user.actorId,
        );
        json(res, 200, { user: result.user, csrf: result.csrf });
        return true;
      }
      if (!session)
        throw new TeamError(401, "sign_in_required", "Sign in to continue.");
      let inputBody: unknown;
      if (req.method !== "GET") {
        auth.checkCsrf(session, String(req.headers["x-csrf-token"] ?? ""));
        auth.rateLimit(`user-write:${session.user.userId}`, 100, 60_000);
        inputBody = await body(req);
        // Revocation can happen while a client is still sending its body.
        session = auth.session(req.headers.cookie);
        if (!session)
          throw new TeamError(401, "sign_in_required", "Sign in to continue.");
        auth.checkCsrf(session, String(req.headers["x-csrf-token"] ?? ""));
      }
      if (req.method === "POST" && path === "/api/auth/logout") {
        auth.logout(session.sessionHash);
        res.setHeader(
          "Set-Cookie",
          cookie("", origin.startsWith("https:"), true),
        );
        json(res, 200, { ok: true });
        return true;
      }
      const workspace = workspaceApi(
        registry,
        url,
        session.user,
        req.method ?? "GET",
        inputBody,
      );
      if (workspace) {
        json(res, 200, workspace.value);
        return true;
      }
      const profilePath = /^\/api\/setups\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
        path,
      );
      const skillPath = /^\/api\/skills\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
      if (req.method === "GET" && skillPath) {
        const skill = registry.skill(
          decodeURIComponent(skillPath[1]!),
          decodeURIComponent(skillPath[2]!),
          skillPath[3]!,
        );
        json(res, 200, {
          skill: {
            ...skill,
            files: skill.files.map(({ data: _data, ...file }) => file),
          },
          instructions: Buffer.from(
            skill.files.find((f) => f.path === "SKILL.md")!.data,
            "base64",
          ).toString("utf8"),
        });
        return true;
      }
      if (req.method === "GET" && profilePath) {
        const profile = registry.profile(
          decodeURIComponent(profilePath[1]!),
          decodeURIComponent(profilePath[2]!),
          profilePath[3]!,
        );
        const preview = profile.schemaVersion === 1 ? profile : {
          ...profile,
          settings: Object.fromEntries(Object.entries(profile.settings).filter(([key]) => key !== "mcp_servers")),
          mcpServers: undefined,
          mcpServerNames: setupMcpServerNames(profile),
        };
        json(res, 200, { profile: { ...preview, files: preview.files.map(({ data: _data, ...file }) => file) }, legacyMcpDetailsBlocked: hasMcpDetails(profile) });
        return true;
      }
      if (req.method === "POST" && path === "/api/assessments") {
        const input = z
          .object({
            runId: z.uuid(),
            parents: z.array(z.uuid()).max(100),
            outcome: assessmentSchema.shape.outcome,
          })
          .strict()
          .parse(inputBody);
        const assessment = assessmentSchema.parse({
          ...input,
          schemaVersion: 1,
          eventId: randomUUID(),
          actorId: session.user.actorId,
          createdAt: new Date().toISOString(),
        });
        registry.putAssessments(session.user.actorId, [assessment]);
        json(res, 201, { assessment });
        return true;
      }
      if (req.method === "GET" && path === "/api/instructions") {
        json(res, 200, {
          instructions: registrationInstructions(registry, origin),
        });
        return true;
      }
      if (req.method === "GET" && path === "/api/people") {
        const people = auth.people();
        json(res, 200, {
          people,
          teams: [
            ...new Set(
              people.flatMap((person) =>
                person.companyTeam ? [person.companyTeam] : [],
              ),
            ),
          ].sort((a, b) => a.localeCompare(b)),
        });
        return true;
      }
      if (req.method === "POST" && path === "/api/profile") {
        const user = auth.updateProfile(
          session.user,
          memberProfileSchema.strict().parse(inputBody),
        );
        registry.ops.audit(
          session.user.actorId,
          "member.profile.updated",
          session.user.actorId,
        );
        json(res, 200, { user });
        return true;
      }
      if (req.method === "GET" && path === "/api/devices") {
        json(res, 200, { devices: auth.devices(session.user) });
        return true;
      }
      if (req.method === "POST" && path === "/api/devices/inspect") {
        const input = z.object({ code: userCode }).strict().parse(inputBody);
        json(res, 200, auth.deviceRequest(input.code));
        return true;
      }
      if (req.method === "POST" && path === "/api/devices/approve") {
        const input = z
          .object({ code: userCode, approve: z.boolean() })
          .strict()
          .parse(inputBody);
        auth.approveDevice(session.user, input.code, input.approve);
        registry.ops.audit(
          session.user.actorId,
          input.approve ? "device.approved" : "device.denied",
          "device registration",
        );
        json(res, 200, { ok: true });
        return true;
      }
      if (req.method === "POST" && path === "/api/devices/revoke") {
        const input = z.object({ tokenId: z.uuid() }).strict().parse(inputBody);
        auth.revokeDevice(session.user, input.tokenId);
        registry.ops.audit(
          session.user.actorId,
          "device.revoked",
          input.tokenId,
        );
        json(res, 200, { ok: true });
        return true;
      }
      if (path.startsWith("/api/admin/")) {
        auth.requireAdmin(session.user);
        if (req.method === "GET" && path === "/api/admin/team") {
          json(res, 200, {
            users: auth.users(),
            invitations: auth.invitations(session.user),
          });
          return true;
        }
        if (req.method === "POST" && path === "/api/admin/invitations") {
          const input = z
            .object({ email: emailSchema, actorId: id, role: roleSchema })
            .strict()
            .parse(inputBody);
          const invitation = auth.invite(session.user, input);
          registry.ops.audit(
            session.user.actorId,
            "member.invited",
            input.actorId,
          );
          json(res, 201, {
            ...invitation,
            url: `${origin}/join#token=${invitation.token}`,
          });
          return true;
        }
        if (req.method === "POST" && path === "/api/admin/invitations/revoke") {
          const input = z
            .object({ challengeId: z.uuid() })
            .strict()
            .parse(inputBody);
          auth.revokeInvitation(session.user, input.challengeId);
          registry.ops.audit(
            session.user.actorId,
            "invitation.revoked",
            input.challengeId,
          );
          json(res, 200, { ok: true });
          return true;
        }
        if (req.method === "POST" && path === "/api/admin/users") {
          const input = z
            .object({
              userId: z.uuid(),
              role: roleSchema.optional(),
              disabled: z.boolean().optional(),
            })
            .strict()
            .parse(inputBody);
          auth.updateUser(session.user, input.userId, input);
          registry.ops.audit(
            session.user.actorId,
            input.disabled !== undefined
              ? `member.${input.disabled ? "disabled" : "enabled"}`
              : `member.role.${input.role}`,
            input.userId,
          );
          json(res, 200, { ok: true });
          return true;
        }
        if (req.method === "POST" && path === "/api/admin/reset-link") {
          const input = z
            .object({ userId: z.uuid() })
            .strict()
            .parse(inputBody);
          const reset = auth.resetLink(input.userId, session.user);
          registry.ops.audit(
            session.user.actorId,
            "password.reset-issued",
            input.userId,
          );
          json(res, 201, {
            ...reset,
            url: `${origin}/reset#token=${reset.token}`,
          });
          return true;
        }
      }
      json(res, 404, {
        error: "not_found",
        message: "Unknown dashboard endpoint.",
      });
      return true;
    }
    const pages = [
      "/",
      "/login",
      "/setup",
      "/join",
      "/reset",
      "/setups",
      "/skills",
      "/people",
      "/activity",
      "/comparisons",
      "/devices",
      "/team",
    ];
    const setupPage =
      /^\/setups\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[a-f0-9]{64}$/.test(
        path,
      );
    let file = pages.includes(path) || setupPage
      ? join(options.webRoot, "index.html")
      : path.startsWith("/assets/")
        ? resolve(options.webRoot, `.${decodeURIComponent(path)}`)
        : "";
    if (
      !file ||
      !existsSync(file) ||
      !inside(realpathSync(options.webRoot), realpathSync(file)) ||
      !statSync(file).isFile()
    )
      return false;
    const type = file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".svg")
          ? "image/svg+xml"
          : file.endsWith(".woff2")
            ? "font/woff2"
            : file.endsWith(".woff")
              ? "font/woff"
              : "text/html";
    res.writeHead(200, {
      "Content-Type": type.startsWith("font/")
        ? type
        : `${type}; charset=utf-8`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...browserSecurityHeaders,
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    res.end(req.method === "HEAD" ? undefined : readFileSync(file));
    return true;
  };
}
