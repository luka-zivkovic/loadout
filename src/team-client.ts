import {
  existsSync,
  openSync,
  closeSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { assessmentConflicts, orderAssessments } from "./assessments.js";
import { canonical, digest, ensureDir, jsonRead, jsonWrite } from "./files.js";
import { getSetup, saveSetup, validateSetup } from "./setups.js";
import { getSkill, saveSkill, validateSkill } from "./skills.js";
import {
  hash,
  id,
  type Assessment,
  type Metrics,
  type Setup,
  type Skill,
} from "./schema.js";
import {
  changesSchema,
  credentialSchema,
  profileListingSchema,
  skillListingSchema,
  teamIdentitySchema,
  withdrawalSchema,
  TeamError,
  type TeamIdentity,
} from "./team-protocol.js";
import type { Store } from "./store.js";
import { localDeviceStatus } from "./local-state.js";
import { trialSchema, type Trial } from "./operations.js";

const connectionSchema = credentialSchema
  .extend({ url: z.string().url() })
  .strict();
type Connection = z.infer<typeof connectionSchema>;
const syncStateSchema = z
  .object({
    withdrawals: z.array(withdrawalSchema).default([]),
    lastSyncAt: z.iso.datetime().nullable().default(null),
    schemaVersion: z.literal(1),
    cursor: z.number().int().nonnegative(),
    runs: z.record(z.uuid(), hash),
    assessments: z.array(z.uuid()),
    publishedHeads: z.record(id, hash),
    catalogue: z.array(profileListingSchema),
    imports: z.record(id, z.string()),
    publishedSkills: z.record(id, hash).default({}),
    skillCatalogue: z.array(skillListingSchema).default([]),
    skillImports: z.record(id, z.string()).default({}),
  })
  .strict();
type SyncState = z.infer<typeof syncStateSchema>;
const initialState = (): SyncState => ({
  withdrawals: [],
  lastSyncAt: null,
  schemaVersion: 1,
  cursor: 0,
  runs: {},
  assessments: [],
  publishedHeads: {},
  catalogue: [],
  imports: {},
  publishedSkills: {},
  skillCatalogue: [],
  skillImports: {},
});
function metadataBatches<T>(items: T[]) {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 1024;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (size > 15_000_000)
      throw new Error("A metadata record exceeds the transfer limit");
    if (
      current.length &&
      (current.length >= 100 || bytes + size > 16_000_000)
    ) {
      batches.push(current);
      current = [];
      bytes = 1024;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function registryUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Registry URL must not contain credentials, a query, or a fragment",
    );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error(
      "Remote registries require HTTPS; plain HTTP is permitted only on loopback",
    );
  return url.href.replace(/\/+$/, "");
}
async function request(
  connection: { url: string; token?: string },
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${registryUrl(connection.url)}${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...(connection.token
        ? { Authorization: `Bearer ${connection.token}` }
        : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Registry returned no response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 64_000_000)
        throw new Error("Registry response exceeds 64 MB");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error(
      `Registry returned an invalid response (HTTP ${response.status})`,
    );
  }
  if (!response.ok) {
    const error = z
      .object({ error: z.string().max(80), message: z.string().max(500) })
      .safeParse(value);
    throw new TeamError(
      response.status,
      error.success ? error.data.error : "request_failed",
      error.success
        ? error.data.message.replace(/[\x00-\x1f\x7f]/g, " ")
        : `Registry request failed (HTTP ${response.status})`,
    );
  }
  return value;
}
export async function loginTeam(
  store: Store,
  name: string,
  url: string,
  label: string,
  onStart: (request: { userCode: string; verificationUrl: string }) => void,
  signal?: AbortSignal,
) {
  id.parse(name);
  url = registryUrl(url);
  const existingPath = join(store.dir, "remotes", name, "connection.json");
  if (
    existsSync(existingPath) &&
    connectionSchema.parse(jsonRead(existingPath)).url !== url
  )
    throw new Error(
      "Reauthentication must use the existing registry URL; choose a new remote for another server.",
    );
  const start = z
    .object({
      deviceCode: z.string(),
      userCode: z.string().regex(/^[A-F0-9]{5}-[A-F0-9]{5}$/),
      verificationUrl: z.string().url(),
      expiresAt: z.iso.datetime(),
      intervalSeconds: z.number().int().min(2).max(30),
      team: z.object({ scope: z.enum(["work", "personal"]), teamId: z.uuid() }),
    })
    .parse(await request({ url }, "/v1/device/start", { label }));
  if (new URL(start.verificationUrl).origin !== new URL(url).origin)
    throw new Error("Device approval URL must belong to this registry");
  if (start.team.scope !== store.scope)
    throw new Error("Team scope does not match this local store");
  const binding = join(store.dir, "team-binding.json");
  if (
    existsSync(binding) &&
    (jsonRead(binding) as { teamId: string }).teamId !== start.team.teamId
  )
    throw new Error(
      "This scoped store belongs to another team; use a separate --home directory",
    );
  onStart(start);
  let interval = start.intervalSeconds;
  while (Date.now() < Date.parse(start.expiresAt)) {
    await delay(interval * 1000, undefined, { signal });
    const result = z
      .discriminatedUnion("status", [
        z.object({ status: z.literal("pending") }),
        z.object({ status: z.literal("slow_down") }),
        z.object({
          status: z.literal("approved"),
          credential: credentialSchema,
        }),
      ])
      .parse(
        await request({ url }, "/v1/device/poll", {
          deviceCode: start.deviceCode,
        }),
      );
    if (result.status === "approved")
      return connectTeam(store, name, url, result.credential);
    if (result.status === "slow_down") interval = Math.min(30, interval + 3);
  }
  throw new Error("Device registration expired; run team login again");
}
function checkIdentity(connection: Connection, identity: TeamIdentity) {
  for (const key of ["teamId", "scope", "actorId", "tokenId"] as const)
    if (connection[key] !== identity[key])
      throw new Error(
        "Registry identity changed; inspect your connection before reconnecting",
      );
}
export async function connectTeam(
  store: Store,
  name: string,
  url: string,
  credential: unknown,
) {
  id.parse(name);
  const secret = credentialSchema.parse(credential);
  if (secret.scope !== store.scope)
    throw new Error("Credential scope does not match this local store");
  const connection = connectionSchema.parse({
    ...secret,
    url: registryUrl(url),
  });
  const identity = teamIdentitySchema.parse(
    await request(connection, "/v1/me"),
  );
  checkIdentity(connection, identity);
  const bindingPath = join(store.dir, "team-binding.json");
  if (
    existsSync(bindingPath) &&
    z.object({ teamId: z.uuid() }).strict().parse(jsonRead(bindingPath))
      .teamId !== identity.teamId
  )
    throw new Error(
      "This scoped store already belongs to another team; use a separate --home directory",
    );
  const dir = join(store.dir, "remotes", name);
  return remoteLock(dir, async () => {
    const path = join(dir, "connection.json");
    const previous = existsSync(path)
      ? connectionSchema.parse(jsonRead(path))
      : null;
    if (
      previous &&
      ["teamId", "scope", "actorId", "url"].some(
        (key) =>
          previous[key as keyof Connection] !==
          connection[key as keyof Connection],
      )
    )
      throw new Error(
        "Reauthentication must preserve the same registry, workspace, scope, and member.",
      );
    if (previous) syncStateSchema.parse(jsonRead(join(dir, "state.json")));
    else jsonWrite(join(dir, "state.json"), initialState(), true);
    jsonWrite(path, connection, Boolean(previous));
    if (!existsSync(bindingPath))
      jsonWrite(bindingPath, { teamId: identity.teamId });
    store.setActor(identity.actorId);
    if (previous && previous.tokenId !== connection.tokenId)
      await request(connection, "/v1/revoke-device", {
        tokenId: previous.tokenId,
      }).catch(() => {
        process.stderr.write(
          "Connected. The previous credential could not be revoked; review it under My devices.\n",
        );
      });
    return identity;
  });
}

async function remoteLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const path = join(dir, "sync.lock");
  ensureDir(dir);
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, "utf8"));
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") rmSync(path);
      }
    }
  }
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch {
    throw new Error(
      "Another sync, transfer, or renewal is using this remote; retry when it finishes.",
    );
  }
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  try {
    return await fn();
  } finally {
    rmSync(path, { force: true });
  }
}

export class TeamClient {
  readonly dir: string;
  private connection: Connection;
  constructor(
    readonly store: Store,
    readonly name: string,
  ) {
    id.parse(name);
    this.dir = join(store.dir, "remotes", name);
    this.connection = connectionSchema.parse(
      jsonRead(join(this.dir, "connection.json")),
    );
    if (this.connection.scope !== store.scope)
      throw new Error("Remote scope does not match this store");
    const binding = z
      .object({ teamId: z.uuid() })
      .strict()
      .parse(jsonRead(join(store.dir, "team-binding.json")));
    if (binding.teamId !== this.connection.teamId)
      throw new Error(
        "Remote belongs to a different team than this scoped store",
      );
  }
  get actorId() {
    return this.connection.actorId;
  }
  private state() {
    return syncStateSchema.parse(jsonRead(join(this.dir, "state.json")));
  }
  private save(state: SyncState) {
    jsonWrite(join(this.dir, "state.json"), syncStateSchema.parse(state), true);
  }
  private async locked<T>(fn: (state: SyncState) => Promise<T>): Promise<T> {
    return remoteLock(this.dir, async () => {
      await this.identity();
      return fn(this.state());
    });
  }
  async identity() {
    const latest = connectionSchema.parse(
      jsonRead(join(this.dir, "connection.json")),
    );
    for (const key of ["teamId", "scope", "actorId", "url"] as const)
      if (latest[key] !== this.connection[key])
        throw new Error(
          "The remote identity changed; restart after inspecting its connection.",
        );
    this.connection = latest;
    const identity = teamIdentitySchema.parse(
      await request(this.connection, "/v1/me"),
    );
    checkIdentity(this.connection, identity);
    return identity;
  }
  async profiles() {
    await this.identity();
    return z
      .object({ profiles: z.array(profileListingSchema) })
      .strict()
      .parse(await request(this.connection, "/v1/profiles")).profiles;
  }
  async publish(profile: Setup, expected?: string | null) {
    validateSetup(profile);
    if (profile.scope !== this.store.scope)
      throw new Error("Profile scope does not match this remote");
    return this.locked(async (state) => {
      const expectedRevision =
        expected === undefined
          ? Object.hasOwn(state.publishedHeads, profile.name)
            ? state.publishedHeads[profile.name]!
            : null
          : expected;
      const result = z
        .object({ revision: hash, published: z.boolean() })
        .strict()
        .parse(
          await request(this.connection, "/v1/profiles", {
            profile,
            expectedRevision,
          }),
        );
      if (result.revision !== profile.revision)
        throw new Error("Registry acknowledged a different setup revision");
      state.publishedHeads[profile.name] = result.revision;
      this.save(state);
      return result;
    });
  }
  async pull(ref: string, options: { revision?: string; alias?: string } = {}) {
    const parts = ref.split("/");
    if (parts.length !== 2) throw new Error("Use member/setup-name");
    const owner = id.parse(parts[0]);
    const name = id.parse(parts[1]);
    return this.locked(async (state) => {
      const listings = z
        .object({ profiles: z.array(profileListingSchema) })
        .strict()
        .parse(await request(this.connection, "/v1/profiles")).profiles;
      const listing = listings.find(
        (p) => p.owner === owner && p.name === name,
      );
      const revision = hash.parse(options.revision ?? listing?.revision);
      const raw = z
        .object({ profile: z.unknown() })
        .strict()
        .parse(
          await request(
            this.connection,
            `/v1/profiles/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${revision}`,
          ),
        );
      const profile = validateSetup(raw.profile);
      if (
        profile.name !== name ||
        profile.revision !== revision ||
        profile.scope !== this.store.scope
      )
        throw new Error(
          "Downloaded setup does not match the requested identity",
        );
      const label = `${owner}--${name}`;
      const alias = id.parse(
        options.alias ??
          (label.length <= 80
            ? label
            : `${label.slice(0, 60)}-${digest(label).slice(0, 12)}`),
      );
      if (
        existsSync(join(this.store.dir, "names", `${alias}.json`)) &&
        state.imports[alias] !== ref &&
        getSetup(this.store, alias).revision !== revision
      )
        throw new Error(
          "Local alias already names another setup; choose a different --as name",
        );
      saveSetup(this.store, profile, alias);
      state.imports[alias] = ref;
      if (owner === this.actorId) state.publishedHeads[name] = revision;
      this.save(state);
      return { alias, profile };
    });
  }
  async skills() {
    await this.identity();
    return z
      .object({ skills: z.array(skillListingSchema) })
      .strict()
      .parse(await request(this.connection, "/v1/skills")).skills;
  }
  async publishSkill(skill: Skill, expected?: string | null) {
    validateSkill(skill);
    if (skill.scope !== this.store.scope)
      throw new Error("Skill scope does not match this remote");
    return this.locked(async (state) => {
      const expectedRevision =
        expected === undefined
          ? (state.publishedSkills[skill.name] ?? null)
          : expected;
      const result = z
        .object({ revision: hash, published: z.boolean() })
        .strict()
        .parse(
          await request(this.connection, "/v1/skills", {
            skill,
            expectedRevision,
          }),
        );
      if (result.revision !== skill.revision)
        throw new Error("Registry acknowledged a different skill revision");
      state.publishedSkills[skill.name] = result.revision;
      this.save(state);
      return result;
    });
  }
  async pullSkill(
    ref: string,
    options: { revision?: string; alias?: string } = {},
  ) {
    const parts = ref.split("/");
    if (parts.length !== 2) throw new Error("Use member/skill-name");
    const owner = id.parse(parts[0]);
    const name = id.parse(parts[1]);
    return this.locked(async (state) => {
      const listings = z
        .object({ skills: z.array(skillListingSchema) })
        .strict()
        .parse(await request(this.connection, "/v1/skills")).skills;
      const revision = hash.parse(
        options.revision ??
          listings.find((p) => p.owner === owner && p.name === name)?.revision,
      );
      const raw = z
        .object({ skill: z.unknown() })
        .strict()
        .parse(
          await request(
            this.connection,
            `/v1/skills/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${revision}`,
          ),
        );
      const skill = validateSkill(raw.skill);
      if (
        skill.name !== name ||
        skill.revision !== revision ||
        skill.scope !== this.store.scope
      )
        throw new Error(
          "Downloaded skill does not match the requested identity",
        );
      const label = `${owner}--${name}`;
      const alias = id.parse(
        options.alias ??
          (label.length <= 80
            ? label
            : `${label.slice(0, 60)}-${digest(label).slice(0, 12)}`),
      );
      if (
        existsSync(join(this.store.dir, "skill-names", `${alias}.json`)) &&
        state.skillImports[alias] !== ref &&
        getSkill(this.store, alias).revision !== revision
      )
        throw new Error(
          "Local alias already names another skill; choose a different --as name",
        );
      saveSkill(this.store, skill, alias);
      state.skillImports[alias] = ref;
      if (owner === this.actorId) state.publishedSkills[name] = revision;
      this.save(state);
      return { alias, skill };
    });
  }
  private async pullChanges(state: SyncState) {
    let runs = 0;
    let assessments = 0;
    let changes = 0;
    do {
      const page = changesSchema.parse(
        await request(
          this.connection,
          `/v1/changes?after=${state.cursor}&limit=100`,
        ),
      );
      if (
        page.teamId !== this.connection.teamId ||
        page.scope !== this.store.scope
      )
        throw new Error("Change feed belongs to a different registry");
      const last = page.changes.at(-1)?.seq ?? state.cursor;
      if (
        page.nextCursor !== last ||
        (page.hasMore && !page.changes.length) ||
        page.changes.some(
          (c, i) => c.seq <= (i ? page.changes[i - 1]!.seq : state.cursor),
        )
      )
        throw new Error("Invalid registry change cursor");
      const existing = new Map(this.store.records().map((r) => [r.runId, r]));
      const incoming = page.changes.flatMap((c) =>
        c.kind === "run" ? [c.value] : [],
      );
      for (const r of incoming) {
        if (r.scope !== this.store.scope)
          throw new Error("Change feed contains a run in the wrong scope");
        const old = existing.get(r.runId);
        if (
          old &&
          canonical({ ...old, outcome: null }) !==
            canonical({ ...r, outcome: null })
        )
          throw new Error(
            `Local run ${r.runId} conflicts with its registry record`,
          );
      }
      const events = page.changes.flatMap((c) =>
        c.kind === "assessment" ? [c.value] : [],
      );
      const allEvents = orderAssessments([
        ...this.store.assessments(),
        ...events,
      ]);
      const allRuns = new Map(
        [...existing.values(), ...incoming].map((r) => [r.runId, r]),
      );
      for (const e of allEvents)
        if (allRuns.get(e.runId)?.status !== "completed")
          throw new Error(
            "Change feed contains an assessment without a completed run",
          );
      for (const r of incoming)
        if (!existing.has(r.runId)) {
          this.store.writeMetrics(r);
          existing.set(r.runId, r);
          runs++;
        }
      assessments += this.store.mergeAssessments(events);
      for (const c of page.changes)
        if (c.kind === "profile") {
          state.catalogue = state.catalogue.filter(
            (p) => p.owner !== c.value.owner || p.name !== c.value.name,
          );
          state.catalogue.push(c.value);
        }
      for (const c of page.changes)
        if (c.kind === "skill") {
          state.skillCatalogue = state.skillCatalogue.filter(
            (p) => p.owner !== c.value.owner || p.name !== c.value.name,
          );
          state.skillCatalogue.push(c.value);
        }
      for (const c of page.changes)
        if (c.kind === "withdrawal") {
          state.withdrawals = state.withdrawals.filter(
            (w) =>
              !(
                w.kind === c.value.kind &&
                w.owner === c.value.owner &&
                w.name === c.value.name &&
                w.revision === c.value.revision
              ),
          );
          state.withdrawals.push(c.value);
        }
      state.catalogue = state.catalogue.filter(
        (p) =>
          !state.withdrawals.some(
            (w) =>
              (w.kind === "profile" &&
                w.owner === p.owner &&
                w.name === p.name &&
                w.revision === p.revision) ||
              (w.kind === "skill" &&
                p.skillPins?.some((pin) => pin.revision === w.revision)),
          ),
      );
      state.skillCatalogue = state.skillCatalogue.filter(
        (p) =>
          !state.withdrawals.some(
            (w) =>
              w.kind === "skill" &&
              w.owner === p.owner &&
              w.name === p.name &&
              w.revision === p.revision,
          ),
      );
      jsonWrite(
        join(this.store.dir, "withdrawals.json"),
        state.withdrawals,
        true,
      );
      state.cursor = page.nextCursor;
      changes += page.changes.length;
      this.save(state);
      if (!page.hasMore) break;
    } while (true);
    return { runs, assessments, changes };
  }
  async sync(options: { includeDemo?: boolean } = {}) {
    return this.locked(async (state) => {
      const first = await this.pullChanges(state);
      const records = this.store.records();
      const byId = new Map(records.map((r) => [r.runId, r]));
      const eligible = records.filter(
        (r) =>
          r.collectionState !== "collecting" &&
          r.actorId === this.actorId &&
          (options.includeDemo || r.mode !== "demo"),
      );
      // Preserve pre-v0.2 scores as explicit first assessments, without changing immutable run counters.
      for (const r of eligible)
        if (
          r.outcome &&
          !this.store
            .assessments()
            .some((e) => e.runId === r.runId && e.actorId === this.actorId)
        )
          this.store.score(r.runId, this.actorId, r.outcome);
      let uploadedRuns = 0;
      let uploadedAssessments = 0;
      const outgoing = eligible
        .map((r) => ({ ...r, outcome: null }))
        .filter((r) => state.runs[r.runId] !== digest(canonical(r)));
      for (const batch of metadataBatches(outgoing)) {
        const result = z
          .object({ added: z.number().int().nonnegative() })
          .strict()
          .parse(
            await request(this.connection, "/v1/runs", { records: batch }),
          );
        uploadedRuns += result.added;
        for (const r of batch) state.runs[r.runId] = digest(canonical(r));
        this.save(state);
      }
      const sent = new Set(state.assessments);
      const events = this.store
        .assessments()
        .filter(
          (e) =>
            e.actorId === this.actorId &&
            !sent.has(e.eventId) &&
            (options.includeDemo || byId.get(e.runId)?.mode !== "demo"),
        );
      for (const batch of metadataBatches(events)) {
        const result = z
          .object({ added: z.number().int().nonnegative() })
          .strict()
          .parse(
            await request(this.connection, "/v1/assessments", {
              assessments: batch,
            }),
          );
        uploadedAssessments += result.added;
        state.assessments.push(...batch.map((e) => e.eventId));
        this.save(state);
      }
      const last = await this.pullChanges(state);
      const receipt = z
        .object({ syncedAt: z.iso.datetime() })
        .parse(
          await request(
            this.connection,
            "/v1/sync-status",
            localDeviceStatus(this.store, state.publishedHeads, 0),
          ),
        );
      state.lastSyncAt = receipt.syncedAt;
      this.save(state);
      return {
        syncedAt: receipt.syncedAt,
        uploadedRuns,
        uploadedAssessments,
        downloadedRuns: first.runs + last.runs,
        downloadedAssessments: first.assessments + last.assessments,
        changes: first.changes + last.changes,
        cursor: state.cursor,
        scoreConflicts: assessmentConflicts(this.store.assessments()),
      };
    });
  }
  async withdraw(kind: "profile" | "skill", ref: string, revision: string) {
    const [owner, name, extra] = ref.split("/");
    if (extra || !owner || !name) throw new Error("Use owner/name");
    return this.locked(async (state) => {
      const result = withdrawalSchema.parse(
        await request(this.connection, "/v1/withdraw", {
          kind,
          owner: id.parse(owner),
          name: id.parse(name),
          revision: hash.parse(revision),
        }),
      );
      await this.pullChanges(state);
      return result;
    });
  }
  async trial(trialId: string): Promise<Trial> {
    z.uuid().parse(trialId);
    await this.identity();
    const result = (await request(
      this.connection,
      `/v1/trials/${trialId}`,
    )) as { trial: Trial };
    const trial = trialSchema.parse(result.trial);
    if (trial.trialId !== trialId)
      throw new Error("Registry returned a different trial identity.");
    return trial;
  }
  async status() {
    const identity = await this.identity();
    const state = this.state();
    const local = this.store.records();
    return {
      ...identity,
      remote: this.name,
      url: this.connection.url,
      cursor: state.cursor,
      publishedProfiles: Object.keys(state.publishedHeads).length,
      lastSyncAt: state.lastSyncAt,
      local: localDeviceStatus(
        this.store,
        state.publishedHeads,
        local.filter(
          (r) =>
            r.collectionState !== "collecting" &&
            r.actorId === this.actorId &&
            r.mode === "live" &&
            !state.runs[r.runId],
        ).length,
      ),
      withdrawals: state.withdrawals,
      knownTeamProfiles: state.catalogue.length,
      syncedRuns: Object.keys(state.runs).length,
      publishedSkills: Object.keys(state.publishedSkills).length,
      knownTeamSkills: state.skillCatalogue.length,
      pendingLiveRuns: local.filter(
        (r) =>
          r.collectionState !== "collecting" &&
          r.actorId === this.actorId &&
          r.mode === "live" &&
          state.runs[r.runId] !== digest(canonical({ ...r, outcome: null })),
      ).length,
      localRunsByOtherActors: local.filter((r) => r.actorId !== this.actorId)
        .length,
      scoreConflicts: assessmentConflicts(this.store.assessments()),
    };
  }
}
