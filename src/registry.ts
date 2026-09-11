import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonical, digest, ensureDir } from "./files.js";
import {
  assessmentSchema,
  hash,
  id,
  metricsSchema,
  setupSchema,
  skillSchema,
  setupHarness,
  setupVersion,
  scope as scopeSchema,
  type Assessment,
  type Metrics,
  type Setup,
  type Skill,
} from "./schema.js";
import { validateSetup } from "./setups.js";
import { validateSkill } from "./skills.js";
import {
  credentialSchema,
  TeamError,
  type ProfileListing,
  type SkillListing,
  type TeamIdentity,
} from "./team-protocol.js";
import { migrateWebAuth } from "./web-auth.js";
import { createWebHandler, publicOrigin } from "./web-server.js";
import { Operations, artifactRef, deviceStatusSchema } from "./operations.js";
import { trustedProxyAddresses } from "./proxy.js";

const metadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    teamId: z.uuid(),
    teamName: id,
    scope: scopeSchema,
  })
  .strict();
type RegistryMetadata = z.infer<typeof metadataSchema>;
const failure = (status: number, code: string, message: string): never => {
  throw new TeamError(status, code, message);
};

/** A single registry is one team and one scope. All mutations and change cursors commit together. */
export class Registry {
  readonly db: DatabaseSync;
  readonly metadata: RegistryMetadata;
  readonly ops: Operations;
  constructor(
    data: string,
    init?: { teamName: string; scope: "personal" | "work" },
  ) {
    const initialMetadata = init
      ? metadataSchema.parse({
          schemaVersion: 1,
          teamId: randomUUID(),
          ...init,
        })
      : undefined;
    const root = resolve(data);
    const path = join(root, "registry.sqlite");
    if (init && existsSync(path)) throw new Error("Registry already exists");
    if (!init && !existsSync(path))
      throw new Error("Initialize this registry first");
    ensureDir(root);
    this.db = new DatabaseSync(path, { timeout: 5000 });
    chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    if (init) {
      this.db.exec(`
        CREATE TABLE metadata (value TEXT NOT NULL);
        CREATE TABLE tokens (token_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
        CREATE TABLE blobs (revision TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE profile_revisions (owner TEXT NOT NULL, name TEXT NOT NULL, revision TEXT NOT NULL REFERENCES blobs(revision), published_at TEXT NOT NULL, PRIMARY KEY(owner,name,revision));
        CREATE TABLE profile_heads (owner TEXT NOT NULL, name TEXT NOT NULL, revision TEXT NOT NULL REFERENCES blobs(revision), PRIMARY KEY(owner,name));
        CREATE TABLE runs (run_id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE assessments (event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id), owner TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL);
      `);
      this.db
        .prepare("INSERT INTO metadata(value) VALUES(?)")
        .run(canonical(initialMetadata));
    }
    this.metadata = metadataSchema.parse(
      JSON.parse(
        String(this.db.prepare("SELECT value FROM metadata").get()!.value),
      ),
    );
    migrateWebAuth(this.db);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS skill_blobs (revision TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skill_revisions (owner TEXT NOT NULL, name TEXT NOT NULL, revision TEXT NOT NULL REFERENCES skill_blobs(revision), published_at TEXT NOT NULL, PRIMARY KEY(owner,name,revision));
      CREATE TABLE IF NOT EXISTS skill_heads (owner TEXT NOT NULL, name TEXT NOT NULL, revision TEXT NOT NULL REFERENCES skill_blobs(revision), PRIMARY KEY(owner,name));`);
    this.ops = new Operations(this);
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private change(kind: string, body: unknown) {
    this.db
      .prepare("INSERT INTO changes(kind,body) VALUES(?,?)")
      .run(kind, canonical(body));
  }
  grant(actorId: string, expiresDays = 90) {
    id.parse(actorId);
    z.number().int().min(1).max(365).parse(expiresDays);
    const tokenId = randomUUID();
    const token = `ps_${randomBytes(32).toString("hex")}`;
    const created = new Date();
    const expires = new Date(created.getTime() + expiresDays * 86400000);
    this.db
      .prepare(
        "INSERT INTO tokens(token_id,token_hash,actor_id,created_at,expires_at) VALUES(?,?,?,?,?)",
      )
      .run(
        tokenId,
        digest(token),
        actorId,
        created.toISOString(),
        expires.toISOString(),
      );
    return credentialSchema.parse({
      schemaVersion: 1,
      teamId: this.metadata.teamId,
      teamName: this.metadata.teamName,
      scope: this.metadata.scope,
      actorId,
      tokenId,
      token,
    });
  }
  tokens() {
    return this.db
      .prepare(
        "SELECT token_id AS tokenId, actor_id AS actorId, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM tokens ORDER BY created_at",
      )
      .all();
  }
  revoke(tokenId: string) {
    z.uuid().parse(tokenId);
    const result = this.db
      .prepare(
        "UPDATE tokens SET revoked_at=? WHERE token_id=? AND revoked_at IS NULL",
      )
      .run(new Date().toISOString(), tokenId);
    return Number(result.changes) > 0;
  }
  authenticate(token: string): TeamIdentity {
    if (!/^ps_[a-f0-9]{64}$/.test(token))
      return failure(
        401,
        "unauthorized",
        "A valid team credential is required",
      );
    const row = this.db
      .prepare(
        "SELECT token_id,actor_id FROM tokens WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?",
      )
      .get(digest(token), new Date().toISOString());
    if (!row)
      return failure(
        401,
        "unauthorized",
        "Credential expired, revoked, or invalid",
      );
    const account = this.db
      .prepare("SELECT disabled_at FROM web_users WHERE actor_id=?")
      .get(String(row.actor_id));
    if (account?.disabled_at)
      return failure(401, "unauthorized", "This member account is disabled");
    this.db
      .prepare("UPDATE web_device_tokens SET last_used_at=? WHERE token_id=?")
      .run(new Date().toISOString(), String(row.token_id));
    return {
      teamId: this.metadata.teamId,
      teamName: this.metadata.teamName,
      scope: this.metadata.scope,
      actorId: String(row.actor_id),
      tokenId: String(row.token_id),
    };
  }
  publish(actor: string, raw: Setup, expectedRevision: string | null) {
    const profile = validateSetup(raw);
    if (profile.scope !== this.metadata.scope)
      return failure(
        403,
        "scope_mismatch",
        "Profile scope does not match this registry",
      );
    return this.transaction(() => {
      this.ops.assertAvailable(
        "profile",
        actor,
        profile.name,
        profile.revision,
      );
      if (this.ops.blockedPins(profile).length)
        return failure(
          410,
          "withdrawn_dependency",
          "Remove withdrawn skill revisions before publishing this setup.",
        );
      const head = this.db
        .prepare("SELECT revision FROM profile_heads WHERE owner=? AND name=?")
        .get(actor, profile.name);
      const current = head ? String(head.revision) : null;
      if (current === profile.revision)
        return { revision: profile.revision, published: false };
      if (current !== expectedRevision)
        return failure(
          409,
          "profile_conflict",
          `Setup changed on another device. Current revision: ${current ?? "none"}. Inspect it before publishing with --expected.`,
        );
      this.ops.checkQuota(Buffer.byteLength(canonical(profile)));
      const now = new Date().toISOString();
      this.db
        .prepare("INSERT OR IGNORE INTO blobs(revision,body) VALUES(?,?)")
        .run(profile.revision, canonical(profile));
      this.db
        .prepare(
          "INSERT OR IGNORE INTO profile_revisions(owner,name,revision,published_at) VALUES(?,?,?,?)",
        )
        .run(actor, profile.name, profile.revision, now);
      this.db
        .prepare(
          "INSERT INTO profile_heads(owner,name,revision) VALUES(?,?,?) ON CONFLICT(owner,name) DO UPDATE SET revision=excluded.revision",
        )
        .run(actor, profile.name, profile.revision);
      this.change("profile", this.listing(actor, profile, now));
      this.ops.cache("profile", this.listing(actor, profile, now));
      this.ops.audit(
        actor,
        "profile.published",
        `${actor}/${profile.name}@${profile.revision}`,
      );
      return { revision: profile.revision, published: true };
    });
  }
  listing(owner: string, p: Setup, publishedAt: string): ProfileListing {
    return {
      owner,
      name: p.name,
      revision: p.revision,
      workflowId: p.workflow.id,
      description: p.workflow.prompt.slice(0, 240),
      model:
        p.schemaVersion === 1
          ? `${p.settings.defaultProvider}/${p.settings.defaultModel}`
          : String(p.settings.model ?? "Harness default"),
      ...(p.schemaVersion === 1 ? { piVersion: p.piVersion } : {}),
      harness: { kind: setupHarness(p), version: setupVersion(p) },
      publishedAt,
      skills: p.files.filter(
        (f) => f.path.endsWith("/SKILL.md") || f.path === "SKILL.md",
      ).length,
      extensions:
        p.schemaVersion === 1
          ? p.resources.extensions.length
          : p.resources.hooks.length,
      skillPins: (p.skillPins ?? []).map(({ name, revision }) => ({
        name,
        revision,
      })),
    };
  }
  profiles(): ProfileListing[] {
    return this.ops.listings("profile") as ProfileListing[];
  }
  profile(owner: string, name: string, revision: string) {
    id.parse(owner);
    id.parse(name);
    hash.parse(revision);
    this.ops.assertAvailable("profile", owner, name, revision);
    const row = this.db
      .prepare(
        "SELECT b.body FROM profile_revisions r JOIN blobs b ON r.revision=b.revision WHERE r.owner=? AND r.name=? AND r.revision=?",
      )
      .get(owner, name, revision);
    if (!row)
      return failure(404, "not_found", "This setup revision does not exist");
    return validateSetup(JSON.parse(String(row.body)));
  }
  publishSkill(actor: string, raw: Skill, expectedRevision: string | null) {
    const skill = validateSkill(raw);
    if (skill.scope !== this.metadata.scope)
      return failure(
        403,
        "scope_mismatch",
        "Skill scope does not match this registry",
      );
    return this.transaction(() => {
      this.ops.assertAvailable("skill", actor, skill.name, skill.revision);
      const head = this.db
        .prepare("SELECT revision FROM skill_heads WHERE owner=? AND name=?")
        .get(actor, skill.name);
      const current = head ? String(head.revision) : null;
      if (current === skill.revision)
        return { revision: skill.revision, published: false };
      if (current !== expectedRevision)
        return failure(
          409,
          "skill_conflict",
          `Skill changed on another device. Current revision: ${current ?? "none"}. Inspect it before publishing with --expected.`,
        );
      this.ops.checkQuota(Buffer.byteLength(canonical(skill)));
      const now = new Date().toISOString();
      this.db
        .prepare("INSERT OR IGNORE INTO skill_blobs(revision,body) VALUES(?,?)")
        .run(skill.revision, canonical(skill));
      this.db
        .prepare(
          "INSERT OR IGNORE INTO skill_revisions(owner,name,revision,published_at) VALUES(?,?,?,?)",
        )
        .run(actor, skill.name, skill.revision, now);
      this.db
        .prepare(
          "INSERT INTO skill_heads(owner,name,revision) VALUES(?,?,?) ON CONFLICT(owner,name) DO UPDATE SET revision=excluded.revision",
        )
        .run(actor, skill.name, skill.revision);
      this.change("skill", this.skillListing(actor, skill, now));
      this.ops.cache("skill", this.skillListing(actor, skill, now));
      this.ops.audit(
        actor,
        "skill.published",
        `${actor}/${skill.name}@${skill.revision}`,
      );
      return { revision: skill.revision, published: true };
    });
  }
  skillListing(owner: string, skill: Skill, publishedAt: string): SkillListing {
    const { scope, kind, schemaVersion, files, ...meta } = skill;
    return { ...meta, owner, publishedAt, files: files.length };
  }
  skills(): SkillListing[] {
    return this.ops.listings("skill") as SkillListing[];
  }
  skill(owner: string, name: string, revision: string): Skill {
    id.parse(owner);
    id.parse(name);
    hash.parse(revision);
    this.ops.assertAvailable("skill", owner, name, revision);
    const row = this.db
      .prepare(
        "SELECT b.body FROM skill_revisions r JOIN skill_blobs b ON r.revision=b.revision WHERE r.owner=? AND r.name=? AND r.revision=?",
      )
      .get(owner, name, revision);
    if (!row)
      return failure(404, "not_found", "This skill revision does not exist");
    return validateSkill(JSON.parse(String(row.body)));
  }
  putRuns(actor: string, records: Metrics[]) {
    return this.transaction(() => {
      let added = 0;
      for (const raw of records) {
        const r = metricsSchema.parse(raw);
        if (r.actorId !== actor || r.scope !== this.metadata.scope)
          return failure(
            403,
            "ownership_mismatch",
            "Upload only your own runs in this registry's scope",
          );
        if (r.outcome !== null)
          return failure(
            400,
            "legacy_score",
            "Scores must be uploaded as versioned assessments",
          );
        if (r.collectionState === "collecting")
          return failure(
            400,
            "collecting",
            "Only finalized telemetry checkpoints may be synced.",
          );
        const body = canonical(r);
        const old = this.db
          .prepare("SELECT body FROM runs WHERE run_id=?")
          .get(r.runId);
        if (old) {
          if (String(old.body) !== body)
            return failure(409, "run_conflict", `Run ${r.runId} is immutable`);
          continue;
        }
        this.ops.validateTrialRun(actor, r);
        this.ops.checkQuota(Buffer.byteLength(body) * 2, 1);
        this.db
          .prepare("INSERT INTO runs(run_id,owner,body) VALUES(?,?,?)")
          .run(r.runId, actor, body);
        this.change("run", r);
        added++;
      }
      return { added };
    });
  }
  putAssessments(actor: string, events: Assessment[]) {
    return this.transaction(() => {
      let added = 0;
      for (const raw of events) {
        const e = assessmentSchema.parse(raw);
        if (e.actorId !== actor)
          return failure(
            403,
            "ownership_mismatch",
            "Assessments must identify the authenticated reviewer",
          );
        const body = canonical(e);
        const old = this.db
          .prepare("SELECT body FROM assessments WHERE event_id=?")
          .get(e.eventId);
        if (old) {
          if (String(old.body) !== body)
            return failure(
              409,
              "assessment_conflict",
              "An assessment event is immutable",
            );
          continue;
        }
        this.ops.checkQuota(Buffer.byteLength(body) * 2);
        const run = this.db
          .prepare("SELECT body FROM runs WHERE run_id=?")
          .get(e.runId);
        if (
          !run ||
          metricsSchema.parse(JSON.parse(String(run.body))).status !==
            "completed"
        )
          return failure(
            400,
            "invalid_run",
            "Assess only a completed team run",
          );
        if (new Set(e.parents).size !== e.parents.length)
          return failure(400, "invalid_parent", "Duplicate assessment parent");
        for (const parent of e.parents) {
          const p = this.db
            .prepare("SELECT run_id,owner FROM assessments WHERE event_id=?")
            .get(parent);
          if (!p || p.run_id !== e.runId || p.owner !== actor)
            return failure(
              409,
              "missing_parent",
              "Sync preceding assessments before their edits",
            );
        }
        this.db
          .prepare(
            "INSERT INTO assessments(event_id,run_id,owner,body) VALUES(?,?,?,?)",
          )
          .run(e.eventId, e.runId, actor, body);
        this.change("assessment", e);
        added++;
      }
      return { added };
    });
  }
  changes(after: number, limit: number) {
    const max = Number(
      this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM changes").get()!
        .seq,
    );
    if (after > max)
      return failure(
        409,
        "cursor_ahead",
        "Registry history is behind this device; reconnect using a new remote name after inspecting the restored registry",
      );
    const candidates = this.db
      .prepare(
        "SELECT seq,kind,body FROM changes WHERE seq>? ORDER BY seq LIMIT ?",
      )
      .all(after, limit);
    const rows: typeof candidates = [];
    let bytes = 1024;
    for (const row of candidates) {
      const size = Buffer.byteLength(String(row.body)) + 128;
      if (rows.length && bytes + size > 16_000_000) break;
      rows.push(row);
      bytes += size;
    }
    const nextCursor = rows.length ? Number(rows.at(-1)!.seq) : after;
    return {
      teamId: this.metadata.teamId,
      scope: this.metadata.scope,
      nextCursor,
      hasMore: nextCursor < max,
      changes: rows.map((r) => ({
        seq: Number(r.seq),
        kind: String(r.kind),
        value: JSON.parse(String(r.body)),
      })),
    };
  }
}

async function requestBody(req: IncomingMessage, maxBytes: number) {
  if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
    return failure(415, "content_type", "Use application/json");
  if (Number(req.headers["content-length"]) > maxBytes) {
    req.resume();
    return failure(413, "too_large", "Request exceeds the upload limit");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes)
      return failure(413, "too_large", "Request exceeds the upload limit");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return failure(400, "invalid_json", "Invalid JSON request");
  }
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
export async function serveRegistry(
  registry: Registry,
  options: {
    host?: string;
    port?: number;
    publicUrl?: string;
    webRoot?: string;
    trustedProxies?: string[];
  } = {},
) {
  let origin = options.publicUrl ? publicOrigin(options.publicUrl) : "";
  const web = createWebHandler(registry, {
    origin: () => origin,
    webRoot:
      options.webRoot ?? fileURLToPath(new URL("../web/dist", import.meta.url)),
    trustedProxies: trustedProxyAddresses(options.trustedProxies),
  });
  const server = createServer(async (req, res) => {
    try {
      if (await web(req, res)) return;
      if (req.headers.origin)
        return failure(
          403,
          "origin_not_allowed",
          "This endpoint accepts authenticated CLI clients",
        );
      const url = new URL(req.url ?? "/", "http://registry.invalid");
      if (req.method === "GET" && url.pathname === "/health") {
        send(res, 200, { ok: true });
        return;
      }
      const identity = registry.authenticate(
        /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "",
      );
      if (req.method === "GET" && url.pathname === "/v1/me") {
        send(res, 200, identity);
        return;
      }
      const trialPath = /^\/v1\/trials\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && trialPath) {
        send(res, 200, { trial: registry.ops.trial(trialPath[1]!) });
        return;
      }
      if (
        req.method === "POST" &&
        ["/v1/withdraw", "/v1/sync-status", "/v1/revoke-device"].includes(
          url.pathname,
        )
      ) {
        const raw = await requestBody(req, 16_000);
        registry.authenticate(
          /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "",
        );
        if (url.pathname === "/v1/withdraw") {
          const ref = artifactRef
            .extend({ kind: z.enum(["profile", "skill"]) })
            .strict()
            .parse(raw);
          send(
            res,
            200,
            registry.ops.withdraw(identity.actorId, ref.kind, {
              owner: ref.owner,
              name: ref.name,
              revision: ref.revision,
            }),
          );
        } else if (url.pathname === "/v1/sync-status")
          send(
            res,
            200,
            registry.ops.syncStatus(
              identity.tokenId,
              deviceStatusSchema.parse(raw),
            ),
          );
        else {
          const input = z.object({ tokenId: z.uuid() }).strict().parse(raw);
          const old = registry.db
            .prepare("SELECT actor_id FROM tokens WHERE token_id=?")
            .get(input.tokenId);
          if (!old || old.actor_id !== identity.actorId)
            return failure(
              403,
              "owner_required",
              "Revoke only your own device credential.",
            );
          registry.revoke(input.tokenId);
          registry.ops.audit(identity.actorId, "device.renewed", input.tokenId);
          send(res, 200, { ok: true });
        }
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/profiles") {
        send(res, 200, { profiles: registry.profiles() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/skills") {
        send(res, 200, { skills: registry.skills() });
        return;
      }
      const skillPath = /^\/v1\/skills\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
        url.pathname,
      );
      if (req.method === "GET" && skillPath) {
        send(res, 200, {
          skill: registry.skill(
            decodeURIComponent(skillPath[1]!),
            decodeURIComponent(skillPath[2]!),
            skillPath[3]!,
          ),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/skills") {
        const body = z
          .object({ skill: skillSchema, expectedRevision: hash.nullable() })
          .strict()
          .parse(await requestBody(req, 45_000_000));
        registry.authenticate(
          /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "",
        );
        send(
          res,
          200,
          registry.publishSkill(
            identity.actorId,
            body.skill,
            body.expectedRevision,
          ),
        );
        return;
      }
      const profilePath = /^\/v1\/profiles\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(
        url.pathname,
      );
      if (req.method === "GET" && profilePath) {
        send(res, 200, {
          profile: registry.profile(
            decodeURIComponent(profilePath[1]!),
            decodeURIComponent(profilePath[2]!),
            profilePath[3]!,
          ),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/changes") {
        const after = z.coerce
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .parse(url.searchParams.get("after") ?? 0);
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(500)
          .parse(url.searchParams.get("limit") ?? 100);
        send(res, 200, registry.changes(after, limit));
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/profiles") {
        const body = z
          .object({ profile: setupSchema, expectedRevision: hash.nullable() })
          .strict()
          .parse(await requestBody(req, 45_000_000));
        // Recheck after asynchronous body receipt so revocation applies before a pending write.
        registry.authenticate(
          /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "",
        );
        send(
          res,
          200,
          registry.publish(
            identity.actorId,
            body.profile,
            body.expectedRevision,
          ),
        );
        return;
      }
      if (
        req.method === "POST" &&
        ["/v1/runs", "/v1/assessments"].includes(url.pathname)
      ) {
        const raw = await requestBody(req, 32_000_000);
        registry.authenticate(
          /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "",
        );
        const result =
          url.pathname === "/v1/runs"
            ? registry.putRuns(
                identity.actorId,
                z
                  .object({ records: z.array(metricsSchema).min(1).max(200) })
                  .strict()
                  .parse(raw).records,
              )
            : registry.putAssessments(
                identity.actorId,
                z
                  .object({
                    assessments: z.array(assessmentSchema).min(1).max(200),
                  })
                  .strict()
                  .parse(raw).assessments,
              );
        send(res, 200, result);
        return;
      }
      send(res, 404, { error: "not_found", message: "Unknown endpoint" });
    } catch (error) {
      if (error instanceof TeamError)
        send(res, error.status, { error: error.code, message: error.message });
      else if (error instanceof z.ZodError)
        send(res, 400, {
          error: "invalid_schema",
          message: req.url?.startsWith("/api/")
            ? "Check the fields and try again. Passwords need at least 12 characters; handles use letters, numbers, dots, dashes, or underscores."
            : "Request does not match the permitted metadata or profile schema",
        });
      else
        send(res, 400, {
          error: "invalid_request",
          message: "Request could not be accepted",
        });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxRequestsPerSocket = 100;
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4318, options.host ?? "127.0.0.1", () => {
      server.removeListener("error", reject);
      done();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Registry did not bind a TCP port");
  if (!origin)
    origin = publicOrigin(
      `http://${options.host === "localhost" ? "localhost" : "127.0.0.1"}:${address.port}`,
    );
  return {
    server,
    port: address.port,
    origin,
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((err) => (err ? reject(err) : done()));
        server.closeIdleConnections();
      }),
  };
}
