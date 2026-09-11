import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonical } from "./files.js";
import {
  hash,
  id,
  setupSchema,
  skillSchema,
  setupHarness,
  type Metrics,
} from "./schema.js";
import {
  TeamError,
  withdrawalSchema,
  type ProfileListing,
  type SkillListing,
} from "./team-protocol.js";
import type { Registry } from "./registry.js";

export const artifactRef = z
  .object({ owner: id, name: id, revision: hash })
  .strict();
export const trialInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    baseline: artifactRef,
    candidate: artifactRef,
  })
  .strict();
export const deviceStatusSchema = z
  .object({
    deviceId: z.uuid(),
    pendingRuns: z.number().int().min(0),
    savedSetups: z.number().int().min(0),
    unpublishedSetups: z.number().int().min(0),
    changedSources: z.number().int().min(0),
    uncheckedSources: z.number().int().min(0),
    collector: z.enum(["running", "stopped", "unknown"]),
    sourceCheckedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const limitsSchema = z
  .object({
    maxStorageMb: z.number().int().min(10).max(1_000_000),
    maxRuns: z.number().int().min(100).max(10_000_000),
    withdrawalRetentionDays: z.number().int().min(0).max(3650),
  })
  .strict();
export const trialSchema = trialInput
  .extend({
    trialId: z.uuid(),
    owner: id,
    createdAt: z.iso.datetime(),
    kind: z.enum(["controlled", "observation"]),
    conclusion: z
      .enum(["keep-baseline", "adopt-candidate", "insufficient-evidence"])
      .nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Trial = z.infer<typeof trialSchema>;
const fail = (status: number, code: string, message: string): never => {
  throw new TeamError(status, code, message);
};

export class Operations {
  constructor(readonly registry: Registry) {
    const db = registry.db;
    db.exec(`CREATE TABLE IF NOT EXISTS artifact_catalog (kind TEXT NOT NULL,owner TEXT NOT NULL,name TEXT NOT NULL,revision TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,owner,name,revision));
      CREATE TABLE IF NOT EXISTS withdrawals (kind TEXT NOT NULL,owner TEXT NOT NULL,name TEXT NOT NULL,revision TEXT NOT NULL,withdrawn_at TEXT NOT NULL,actor TEXT NOT NULL,PRIMARY KEY(kind,owner,name,revision));
      CREATE TABLE IF NOT EXISTS audit_events (event_id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS device_sync (token_id TEXT PRIMARY KEY REFERENCES tokens(token_id),synced_at TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trials (trial_id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS skill_feedback (owner TEXT NOT NULL,name TEXT NOT NULL,revision TEXT NOT NULL,actor TEXT NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,name,revision,actor));
      CREATE TABLE IF NOT EXISTS operation_settings (key TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_period ON runs(json_extract(body,'$.mode'),json_extract(body,'$.startedAt') DESC,run_id);
      CREATE INDEX IF NOT EXISTS runs_harness_period ON runs(COALESCE(json_extract(body,'$.harness.kind'),'pi'),json_extract(body,'$.mode'),json_extract(body,'$.startedAt') DESC);
      CREATE INDEX IF NOT EXISTS runs_comparison ON runs(json_extract(body,'$.comparisonId'));
      CREATE INDEX IF NOT EXISTS assessments_run ON assessments(run_id);
      CREATE INDEX IF NOT EXISTS withdrawals_revision ON withdrawals(kind,revision);`);
    // Backfill metadata once. Browsing never decodes all bundled file bodies.
    for (const r of db
      .prepare(
        "SELECT r.*,b.body FROM profile_revisions r JOIN blobs b ON b.revision=r.revision WHERE NOT EXISTS(SELECT 1 FROM artifact_catalog c WHERE c.kind='profile' AND c.owner=r.owner AND c.name=r.name AND c.revision=r.revision)",
      )
      .all()) {
      const setup = setupSchema.parse(JSON.parse(String(r.body)));
      this.cache(
        "profile",
        registry.listing(String(r.owner), setup, String(r.published_at)),
      );
    }
    for (const r of db
      .prepare(
        "SELECT r.*,b.body FROM skill_revisions r JOIN skill_blobs b ON b.revision=r.revision WHERE NOT EXISTS(SELECT 1 FROM artifact_catalog c WHERE c.kind='skill' AND c.owner=r.owner AND c.name=r.name AND c.revision=r.revision)",
      )
      .all()) {
      this.cache(
        "skill",
        registry.skillListing(
          String(r.owner),
          skillSchema.parse(JSON.parse(String(r.body))),
          String(r.published_at),
        ),
      );
    }
  }
  get db() {
    return this.registry.db;
  }
  audit(actor: string, action: string, target: string) {
    this.db
      .prepare(
        "INSERT INTO audit_events(actor,action,target,created_at) VALUES(?,?,?,?)",
      )
      .run(actor, action, target, new Date().toISOString());
  }
  events(before = Number.MAX_SAFE_INTEGER) {
    return this.db
      .prepare(
        "SELECT event_id AS eventId,actor,action,target,created_at AS createdAt FROM audit_events WHERE event_id<? ORDER BY event_id DESC LIMIT 100",
      )
      .all(before);
  }
  isAdmin(actor: string) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM web_users WHERE actor_id=? AND role='admin' AND disabled_at IS NULL",
        )
        .get(actor),
    );
  }
  limits() {
    const row = this.db
      .prepare("SELECT body FROM operation_settings WHERE key='limits'")
      .get();
    return row
      ? limitsSchema.parse(JSON.parse(String(row.body)))
      : { maxStorageMb: 500, maxRuns: 100_000, withdrawalRetentionDays: 30 };
  }
  usage() {
    const row = this.db
      .prepare(
        "SELECT (SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM blobs)+(SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM skill_blobs)+(SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM runs)+(SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM assessments)+(SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM changes) AS bytes,(SELECT COUNT(*) FROM runs) AS runs",
      )
      .get()!;
    return {
      bytes: Number(row.bytes),
      runs: Number(row.runs),
      limits: this.limits(),
    };
  }
  checkQuota(bytes: number, runs = 0) {
    const usage = this.usage();
    if (
      usage.bytes + bytes > usage.limits.maxStorageMb * 1_000_000 ||
      usage.runs + runs > usage.limits.maxRuns
    )
      fail(
        413,
        "quota_exceeded",
        "Workspace storage quota reached. Ask an admin to review retention or increase the quota.",
      );
  }
  setLimits(actor: string, input: unknown) {
    if (actor !== "host" && !this.isAdmin(actor))
      fail(403, "admin_required", "Admin access required.");
    const limits = limitsSchema.parse(input);
    this.db
      .prepare(
        "INSERT INTO operation_settings(key,body) VALUES('limits',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body",
      )
      .run(canonical(limits));
    this.audit(actor, "limits.updated", "workspace");
    return limits;
  }
  cache(kind: "profile" | "skill", listing: ProfileListing | SkillListing) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO artifact_catalog(kind,owner,name,revision,body) VALUES(?,?,?,?,?)",
      )
      .run(
        kind,
        listing.owner,
        listing.name,
        listing.revision,
        canonical(listing),
      );
  }
  withdrawn(kind: string, owner: string, name: string, revision: string) {
    return this.db
      .prepare(
        "SELECT withdrawn_at FROM withdrawals WHERE kind=? AND owner=? AND name=? AND revision=?",
      )
      .get(kind, owner, name, revision);
  }
  blockedPins(p: { skillPins?: { revision: string; name: string }[] }) {
    return (p.skillPins ?? [])
      .filter((pin) =>
        this.db
          .prepare(
            "SELECT 1 FROM withdrawals WHERE kind='skill' AND revision=?",
          )
          .get(pin.revision),
      )
      .map((p) => p.name);
  }
  assertAvailable(
    kind: "profile" | "skill",
    owner: string,
    name: string,
    revision: string,
  ) {
    if (this.withdrawn(kind, owner, name, revision))
      fail(
        410,
        "withdrawn",
        "This revision was withdrawn. Download a reviewed replacement from the library.",
      );
    if (kind === "profile") {
      const row = this.db
        .prepare(
          "SELECT body FROM artifact_catalog WHERE kind=? AND owner=? AND name=? AND revision=?",
        )
        .get(kind, owner, name, revision);
      if (row && this.blockedPins(JSON.parse(String(row.body))).length)
        fail(
          410,
          "withdrawn_dependency",
          "This setup bundles a withdrawn skill revision and cannot be downloaded. Publish a revised setup without that content.",
        );
    }
  }
  listings(
    kind: "profile" | "skill",
    includeWithdrawn = false,
  ): (ProfileListing | SkillListing)[] {
    const table = kind === "profile" ? "profile_heads" : "skill_heads";
    return this.db
      .prepare(
        `SELECT c.body FROM ${table} h JOIN artifact_catalog c ON c.kind=? AND c.owner=h.owner AND c.name=h.name AND c.revision=h.revision ORDER BY json_extract(c.body,'$.publishedAt') DESC`,
      )
      .all(kind)
      .map((r) => JSON.parse(String(r.body)) as ProfileListing | SkillListing)
      .filter(
        (p) =>
          includeWithdrawn ||
          (!this.withdrawn(kind, p.owner, p.name, p.revision) &&
            (kind !== "profile" ||
              !this.blockedPins(p as ProfileListing).length)),
      );
  }
  history(kind: "profile" | "skill", owner: string, name: string) {
    id.parse(owner);
    id.parse(name);
    return this.db
      .prepare(
        "SELECT c.body,w.withdrawn_at FROM artifact_catalog c LEFT JOIN withdrawals w ON w.kind=c.kind AND w.owner=c.owner AND w.name=c.name AND w.revision=c.revision WHERE c.kind=? AND c.owner=? AND c.name=? ORDER BY json_extract(c.body,'$.publishedAt') DESC",
      )
      .all(kind, owner, name)
      .map((r) => {
        const p = JSON.parse(String(r.body));
        return {
          ...p,
          withdrawnAt: r.withdrawn_at ?? null,
          blockedSkills: kind === "profile" ? this.blockedPins(p) : [],
        };
      });
  }
  withdrawals() {
    return this.db
      .prepare(
        "SELECT kind,owner,name,revision,withdrawn_at AS withdrawnAt FROM withdrawals ORDER BY withdrawn_at DESC",
      )
      .all()
      .map((r) => withdrawalSchema.parse(r));
  }
  withdraw(
    actor: string,
    kind: "profile" | "skill",
    ref: z.infer<typeof artifactRef>,
  ) {
    artifactRef.parse(ref);
    if (actor !== ref.owner && !this.isAdmin(actor))
      fail(
        403,
        "owner_required",
        "Only the publisher or an admin can withdraw a revision.",
      );
    return this.registry.transaction(() => {
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM artifact_catalog WHERE kind=? AND owner=? AND name=? AND revision=?",
          )
          .get(kind, ref.owner, ref.name, ref.revision)
      )
        fail(404, "not_found", "Revision not found.");
      const old = this.withdrawn(kind, ref.owner, ref.name, ref.revision);
      if (old) return { ...ref, kind, withdrawnAt: String(old.withdrawn_at) };
      const value = { kind, ...ref, withdrawnAt: new Date().toISOString() };
      this.db
        .prepare(
          "INSERT INTO withdrawals(kind,owner,name,revision,withdrawn_at,actor) VALUES(?,?,?,?,?,?)",
        )
        .run(kind, ref.owner, ref.name, ref.revision, value.withdrawnAt, actor);
      this.db
        .prepare("INSERT INTO changes(kind,body) VALUES('withdrawal',?)")
        .run(canonical(value));
      this.audit(
        actor,
        `${kind}.withdrawn`,
        `${ref.owner}/${ref.name}@${ref.revision}`,
      );
      return value;
    });
  }
  purge(actor: string) {
    if (actor !== "host" && !this.isAdmin(actor))
      fail(403, "admin_required", "Admin access required.");
    const before = new Date(
      Date.now() - this.limits().withdrawalRetentionDays * 86400000,
    ).toISOString();
    return this.registry.transaction(() => {
      let purged = 0;
      for (const kind of ["profile", "skill"] as const) {
        const table = kind === "profile" ? "blobs" : "skill_blobs";
        for (const r of this.db
          .prepare(
            `SELECT revision FROM ${table} WHERE body != '{"purged":true}'`,
          )
          .all()) {
          const refs = this.db
            .prepare(
              "SELECT owner,name FROM artifact_catalog WHERE kind=? AND revision=?",
            )
            .all(kind, r.revision!);
          if (
            !refs.length ||
            refs.some((ref) => {
              const w = this.withdrawn(
                kind,
                String(ref.owner),
                String(ref.name),
                String(r.revision),
              );
              if (w && String(w.withdrawn_at) <= before) return false;
              if (kind !== "profile") return true;
              const listing = JSON.parse(
                String(
                  this.db
                    .prepare(
                      "SELECT body FROM artifact_catalog WHERE kind='profile' AND owner=? AND name=? AND revision=?",
                    )
                    .get(ref.owner!, ref.name!, r.revision!)!.body,
                ),
              );
              return !(listing.skillPins ?? []).some(
                (pin: { revision: string }) =>
                  this.db
                    .prepare(
                      "SELECT 1 FROM withdrawals WHERE kind='skill' AND revision=? AND withdrawn_at<=?",
                    )
                    .get(pin.revision, before),
              );
            })
          )
            continue;
          this.db
            .prepare(
              `UPDATE ${table} SET body='{"purged":true}' WHERE revision=?`,
            )
            .run(r.revision!);
          purged++;
        }
      }
      this.audit(
        actor,
        "retention.purged",
        `${purged} payloads; backup expiry is separate`,
      );
      return { purged, before };
    });
  }
  syncStatus(tokenId: string, input: unknown) {
    const status = deviceStatusSchema.parse(input);
    const syncedAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO device_sync(token_id,synced_at,body) VALUES(?,?,?) ON CONFLICT(token_id) DO UPDATE SET synced_at=excluded.synced_at,body=excluded.body",
      )
      .run(tokenId, syncedAt, canonical(status));
    return { syncedAt };
  }
  createTrial(actor: string, raw: unknown) {
    const input = trialInput.parse(raw);
    const baseline = this.registry.profile(
      input.baseline.owner,
      input.baseline.name,
      input.baseline.revision,
    );
    const candidate = this.registry.profile(
      input.candidate.owner,
      input.candidate.name,
      input.candidate.revision,
    );
    if (baseline.revision === candidate.revision)
      fail(400, "same_revision", "Choose two different setup revisions.");
    if (setupHarness(baseline) !== setupHarness(candidate))
      fail(
        400,
        "harness_mismatch",
        "Whole-setup trials require the same harness. Share individual skills across harnesses.",
      );
    if (baseline.workflow.id !== candidate.workflow.id)
      fail(400, "workflow_mismatch", "Choose setups with the same workflow.");
    const createdAt = new Date().toISOString();
    const trial: Trial = {
      ...input,
      trialId: randomUUID(),
      owner: actor,
      createdAt,
      updatedAt: createdAt,
      kind:
        baseline.schemaVersion === 1 && candidate.schemaVersion === 1
          ? "controlled"
          : "observation",
      conclusion: null,
    };
    this.checkQuota(Buffer.byteLength(canonical(trial)));
    this.db
      .prepare("INSERT INTO trials(trial_id,owner,body) VALUES(?,?,?)")
      .run(trial.trialId, actor, canonical(trial));
    this.audit(actor, "trial.created", trial.trialId);
    return trial;
  }
  trial(trialId: string): Trial {
    z.uuid().parse(trialId);
    const row = this.db
      .prepare("SELECT body FROM trials WHERE trial_id=?")
      .get(trialId);
    if (!row) return fail(404, "not_found", "Trial not found.");
    return JSON.parse(String(row.body));
  }
  trials(): Trial[] {
    return this.db
      .prepare(
        "SELECT body FROM trials ORDER BY json_extract(body,'$.createdAt') DESC",
      )
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  validateTrialRun(actor: string, run: Metrics) {
    if (!run.comparisonId) return;
    const row = this.db
      .prepare("SELECT body FROM trials WHERE trial_id=?")
      .get(run.comparisonId);
    if (!row) return; // Legacy experiments do not have a named trial.
    const trial = trialSchema.parse(JSON.parse(String(row.body)));
    if (trial.owner !== actor)
      fail(
        403,
        "trial_owner",
        "Upload trial runs using the trial owner's account.",
      );
    if (
      ![trial.baseline, trial.candidate].some(
        (ref) =>
          ref.revision === run.profileRevision && ref.name === run.profileName,
      )
    )
      fail(
        400,
        "trial_revision",
        "Trial runs must use one of its exact setup revisions.",
      );
    if (trial.kind === "controlled") {
      if (run.source !== "runner" || run.toolPolicy !== "read-only")
        fail(
          400,
          "trial_context",
          "Controlled trial runs must use the frozen-context, read-only runner.",
        );
      const earlier = this.db
        .prepare(
          "SELECT body FROM runs WHERE json_extract(body,'$.comparisonId')=? LIMIT 1",
        )
        .get(run.comparisonId);
      if (earlier) {
        const first = JSON.parse(String(earlier.body)) as Metrics;
        if (first.contextHash !== run.contextHash || first.mode !== run.mode)
          fail(
            409,
            "trial_context",
            "Use the same frozen task and live/demo mode for both revisions; create a new trial for another task.",
          );
      }
    } else {
      const listing = this.db
        .prepare(
          "SELECT body FROM artifact_catalog WHERE kind='profile' AND owner=? AND name=? AND revision=?",
        )
        .get(
          trial.baseline.owner,
          trial.baseline.name,
          trial.baseline.revision,
        );
      const harness = JSON.parse(String(listing!.body)).harness?.kind;
      if (run.source !== "telemetry" || run.harness?.kind !== harness)
        fail(
          400,
          "trial_harness",
          "Native observations must come from the trial's harness.",
        );
    }
  }
  conclude(actor: string, trialId: string, value: unknown) {
    const trial = this.trial(trialId);
    if (trial.owner !== actor)
      fail(
        403,
        "owner_required",
        "Only the trial owner can record its decision.",
      );
    trial.conclusion = z
      .enum(["keep-baseline", "adopt-candidate", "insufficient-evidence"])
      .parse(value);
    if (trial.conclusion !== "insufficient-evidence") {
      for (const ref of [trial.baseline, trial.candidate]) {
        const row = this.db
          .prepare(
            "SELECT 1 FROM runs r WHERE json_extract(r.body,'$.comparisonId')=? AND json_extract(r.body,'$.profileRevision')=? AND (?='observation' OR (json_extract(r.body,'$.status')='completed' AND EXISTS(SELECT 1 FROM assessments a WHERE a.run_id=r.run_id))) LIMIT 1",
          )
          .get(trialId, ref.revision, trial.kind);
        if (!row)
          fail(
            409,
            "evaluation_required",
            "Sync both revisions and assess completed Pi reviews before deciding, or choose insufficient evidence.",
          );
      }
    }
    trial.updatedAt = new Date().toISOString();
    this.db
      .prepare("UPDATE trials SET body=? WHERE trial_id=?")
      .run(canonical(trial), trialId);
    this.audit(actor, "trial.concluded", trialId);
    return trial;
  }
  feedback(actor: string, ref: z.infer<typeof artifactRef>, value: unknown) {
    this.registry.skill(ref.owner, ref.name, ref.revision);
    const vote = z.enum(["useful", "needs-local-setup"]).parse(value);
    this.db
      .prepare(
        "INSERT INTO skill_feedback(owner,name,revision,actor,value,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,name,revision,actor) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
      )
      .run(
        ref.owner,
        ref.name,
        ref.revision,
        actor,
        vote,
        new Date().toISOString(),
      );
    return this.feedbackSummary(ref);
  }
  feedbackSummary(ref: z.infer<typeof artifactRef>) {
    return this.db
      .prepare(
        "SELECT value,COUNT(*) AS count FROM skill_feedback WHERE owner=? AND name=? AND revision=? GROUP BY value",
      )
      .all(ref.owner, ref.name, ref.revision);
  }
}
