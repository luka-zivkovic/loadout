import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { Registry, serveRegistry } from "../dist/registry.js";
import { WebAuth } from "../dist/web-auth.js";
import { Store } from "../dist/store.js";
import { TeamClient, connectTeam, loginTeam } from "../dist/team-client.js";
import {
  canonical,
  digest,
  packFile,
  validateFiles,
  jsonWrite,
} from "../dist/files.js";
import { exampleProfile, sealProfile } from "../dist/profiles.js";
import {
  addSkillToSetup,
  captureSetup,
  saveSetup,
  sealNativeSetup,
} from "../dist/setups.js";
import { sealSkill } from "../dist/skills.js";
import { Collector } from "../dist/metrics.js";
import { NativeTelemetry } from "../dist/telemetry.js";
import { TelemetryCheckpoint, recoverTelemetry } from "../dist/checkpoints.js";
import {
  rememberCapture,
  checkSources,
  localDeviceStatus,
} from "../dist/local-state.js";
import { assertLocalAvailable } from "../dist/availability.js";
import { clientAddress, trustedProxyAddresses } from "../dist/proxy.js";
import { checkDeployment } from "../dist/deployment.js";
import {
  activityPage,
  analyticsSummary,
  comparisonList,
  comparisonData,
} from "../dist/analytics.js";

const password = "test-only-password-long-enough";
test("deployment preflight reports insecure permissions without changing them", async (t) => {
  const f = await fixture(t);
  const data = join(f.dir, "registry");
  assert.equal(checkDeployment(data, { publicUrl: f.url }).ok, true);
  chmodSync(join(data, "registry.sqlite"), 0o644);
  assert.equal(checkDeployment(data, { publicUrl: f.url }).ok, false);
  assert.equal(statSync(join(data, "registry.sqlite")).mode & 0o777, 0o644);
  assert.equal(
    checkDeployment(data, { trustedProxies: ["untrusted.example"] }).ok,
    false,
  );
});
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "loadout-audit-"));
  const registry = new Registry(join(dir, "registry"), {
    teamName: "team",
    scope: "work",
  });
  const auth = new WebAuth(registry);
  const admin = await auth.setup({
    name: "Admin",
    actorId: "admin",
    email: "admin@example.test",
    password,
    token: auth.issueSetup().token,
  });
  const server = await serveRegistry(registry, { port: 0, ...options });
  const url = `http://127.0.0.1:${server.port}`;
  t.after(async () => {
    await server.close();
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = async (path, body, session = admin, headers = {}) => {
    const r = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(session
          ? {
              Cookie: `pi_share_session=${session.sessionToken}`,
              "X-CSRF-Token": session.csrf,
            }
          : {}),
        ...(body === undefined
          ? {}
          : { Origin: url, "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: await r.json() };
  };
  async function device(label, actor = "admin") {
    const store = new Store(join(dir, label), "work");
    const credential = registry.grant(actor);
    await connectTeam(store, "team", url, credential);
    return { store, credential, client: new TeamClient(store, "team") };
  }
  return { dir, registry, auth, admin, server, url, call, device };
}
function skill(name = "shared-review") {
  return sealSkill({
    schemaVersion: 1,
    kind: "skill",
    name,
    scope: "work",
    description: "Review reusable behavior.",
    compatibleWith: ["pi", "claude-code", "codex"],
    requirements: [],
    files: [
      packFile(
        "SKILL.md",
        Buffer.from(
          `---\nname: ${name}\ndescription: Review reusable behavior.\n---\nReview changes.\n`,
        ),
      ),
      packFile(
        "scripts/check.sh",
        Buffer.from('#!/bin/sh\nprintf "<script>plain text only</script>"\n'),
        true,
      ),
    ],
  });
}
function record(profile, actor = "admin") {
  const collector = new Collector(
    {
      runId: randomUUID(),
      comparisonId: null,
      scope: "work",
      actorId: actor,
      deviceId: randomUUID(),
      profileName: profile.name,
      profileRevision: profile.revision,
      effectiveConfigHash: digest("effective"),
      contextHash: digest("context"),
      workflowId: profile.workflow.id,
      mode: "live",
      source: "runner",
      piVersion: "0.85.1",
      toolPolicy: "read-only",
    },
    ".",
  );
  collector.observe({
    type: "message_end",
    message: {
      role: "assistant",
      provider: "fixture",
      model: "local",
      stopReason: "stop",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { total: 0.01 },
      },
    },
  });
  return collector.finish();
}
function nativeRecord(profile, harness, pin) {
  const r = record(profile);
  delete r.piVersion;
  return {
    ...r,
    schemaVersion: 2,
    status: "recorded",
    source: "telemetry",
    harness: { kind: harness, version: "fixture" },
    coverage: {
      tools: "observed",
      skills: "unavailable",
      tokens: "observed",
      turns: "unavailable",
      retries: "unavailable",
      compactions: "unavailable",
    },
    ...(pin ? { skillPins: [{ name: pin.name, revision: pin.revision }] } : {}),
    skillObservation: "unavailable",
  };
}
const ref = (owner, p) => ({ owner, name: p.name, revision: p.revision });

test("all issued capability formats are rejected in bundled files and native metadata", () => {
  for (const prefix of ["ps", "psb", "psi", "psr", "pss", "psd"]) {
    const text = `https://example.test/join#token=${prefix}_${"a".repeat(64)}`;
    assert.throws(() => packFile("SKILL.md", Buffer.from(text)), /credential/);
    const bytes = Buffer.from(text);
    assert.throws(
      () =>
        validateFiles([
          {
            path: "notes.md",
            data: bytes.toString("base64"),
            sha256: digest(bytes),
          },
        ]),
      /credential/,
    );
    const { revision, ...body } = exampleProfile(
      "review",
      "work",
      "fixture/local",
    );
    assert.throws(
      () => sealProfile({ ...body, requirements: [text] }),
      /credential/,
    );
  }
});

test("withdrawal is authorized, blocks old downloads and embedded copies, and propagates to clients", async (t) => {
  const f = await fixture(t);
  const alice = await f.device("alice", "alice");
  const bob = await f.device("bob", "bob");
  const shared = skill();
  const setup = addSkillToSetup(
    exampleProfile("review", "work", "fixture/local"),
    shared,
  );
  await alice.client.publishSkill(shared);
  await alice.client.publish(setup);
  await bob.client.pull("alice/review");
  await bob.client.sync();
  await assert.rejects(
    () => bob.client.withdraw("skill", "alice/shared-review", shared.revision),
    /publisher or an admin/,
  );
  await alice.client.withdraw("skill", "alice/shared-review", shared.revision);
  assert.throws(
    () => f.registry.skill("alice", shared.name, shared.revision),
    /withdrawn/,
  );
  assert.throws(
    () => f.registry.profile("alice", setup.name, setup.revision),
    /withdrawn skill/,
  );
  assert.equal(f.registry.profiles().length, 0);
  assert.equal(
    (
      await f.call(
        `/api/artifacts/profile/alice/review/${setup.revision}/file?path=shared-skills/shared-review/SKILL.md`,
      )
    ).status,
    410,
  );
  const unavailable = (await f.call("/api/library/unavailable")).body
    .unavailable;
  assert(
    unavailable.some(
      (p) => p.kind === "profile" && p.blockedSkills.includes(shared.name),
    ),
  );
  await bob.client.sync();
  assert.throws(() => assertLocalAvailable(bob.store, setup), /withdrawn/);
  assert(
    existsSync(join(bob.store.dir, "profiles", `${setup.revision}.json`)),
    "existing local copies are retained",
  );
  await assert.rejects(() => alice.client.publish(setup), /withdrawn/);
  f.registry.ops.setLimits("admin", {
    maxStorageMb: 500,
    maxRuns: 100000,
    withdrawalRetentionDays: 0,
  });
  const result = f.registry.ops.purge("admin");
  assert.equal(
    result.purged,
    2,
    "purges standalone skill and blocked embedded setup",
  );
  assert.equal(
    String(
      f.registry.db
        .prepare("SELECT body FROM blobs WHERE revision=?")
        .get(setup.revision).body,
    ),
    '{"purged":true}',
  );
  assert.throws(
    () => f.registry.profile("alice", setup.name, setup.revision),
    /withdrawn/,
  );
  assert(f.registry.ops.events().some((e) => e.action === "skill.withdrawn"));
});

test("withdrawing an old setup revision preserves its reviewed replacement and revision history", async (t) => {
  const f = await fixture(t);
  const a = exampleProfile("review", "work", "fixture/local");
  const b = exampleProfile("review", "work", "fixture/local", true);
  f.registry.publish("admin", a, null);
  f.registry.publish("admin", b, a.revision);
  const r = await f.call("/api/artifacts/withdraw", {
    kind: "profile",
    ...ref("admin", a),
  });
  assert.equal(r.status, 200);
  assert.equal(f.registry.profiles()[0].revision, b.revision);
  assert.equal(
    f.registry.profile("admin", b.name, b.revision).revision,
    b.revision,
  );
  const history = (await f.call("/api/artifacts/profile/admin/review/history"))
    .body.history;
  assert.equal(history.length, 2);
  assert(history.find((p) => p.revision === a.revision).withdrawnAt);
  assert.equal(
    (
      await f.call(
        "/api/artifacts/withdraw",
        { kind: "profile", ...ref("admin", b) },
        null,
      )
    ).status,
    401,
  );
});

test("browser artifact inspection returns plain content and enforces authentication", async (t) => {
  const f = await fixture(t);
  const s = skill();
  f.registry.publishSkill("admin", s, null);
  const path = `/api/artifacts/skill/admin/${s.name}/${s.revision}/file?path=scripts/check.sh`;
  assert.equal((await f.call(path, undefined, null)).status, 401);
  const preview = await f.call(path);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.executable, true);
  assert(preview.body.text.includes("<script>plain text only</script>"));
  assert.equal(
    (await f.call(path.replace("scripts/check.sh", "../registry.sqlite")))
      .status,
    404,
  );
});

test("renewal preserves cursor, imports, published heads, and device identity while replacing credentials", async (t) => {
  const f = await fixture(t);
  const d = await f.device("device");
  const p = exampleProfile("review", "work", "fixture/local");
  saveSetup(d.store, p);
  await d.client.publish(p);
  await d.client.pull("admin/review", { alias: "borrowed" });
  await d.client.sync();
  const statePath = join(d.store.dir, "remotes/team/state.json");
  const before = readFileSync(statePath, "utf8");
  const identity = d.store.identity();
  f.registry.revoke(d.credential.tokenId);
  const renewed = f.registry.grant("admin");
  await connectTeam(d.store, "team", f.url, renewed);
  assert.equal(readFileSync(statePath, "utf8"), before);
  assert.deepEqual(d.store.identity(), identity);
  assert.equal(
    (await d.client.identity()).tokenId,
    renewed.tokenId,
    "running clients reload the renewed connection",
  );
  assert.throws(() => f.registry.authenticate(d.credential.token), /revoked/);
  const connectionPath = join(d.store.dir, "remotes/team/connection.json");
  const connection = readFileSync(connectionPath, "utf8");
  await assert.rejects(
    () =>
      connectTeam(d.store, "team", f.url, f.registry.grant("different-member")),
    /same registry/,
  );
  assert.equal(readFileSync(connectionPath, "utf8"), connection);
  f.registry.revoke(renewed.tokenId);
  await loginTeam(d.store, "team", f.url, "renewed-device", (r) =>
    f.auth.approveDevice(f.admin.user, r.userCode, true),
  );
  assert.equal(readFileSync(statePath, "utf8"), before);
  assert.equal((await d.client.identity()).actorId, "admin");
});

test("period aggregates cover more than 2000 runs, pages do not overlap, and experiment groups stay complete", async (t) => {
  const f = await fixture(t);
  const p = exampleProfile("review", "work", "fixture/local");
  const seed = record(p);
  const insert = f.registry.db.prepare(
    "INSERT INTO runs(run_id,owner,body) VALUES(?,?,?)",
  );
  const comparisonId = randomUUID();
  f.registry.transaction(() => {
    for (let i = 0; i < 2505; i++) {
      const r = {
        ...seed,
        runId: randomUUID(),
        comparisonId: i === 0 ? comparisonId : null,
      };
      if (i === 1) r.models = [{ ...r.models[0], estimatedCostUsd: null }];
      insert.run(r.runId, r.actorId, canonical(r));
    }
    const old = {
      ...seed,
      runId: randomUUID(),
      comparisonId,
      startedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
    };
    insert.run(old.runId, old.actorId, canonical(old));
  });
  const url = new URL("http://test/api/dashboard?days=7&mode=live");
  const start = performance.now();
  const summary = analyticsSummary(f.registry.db, url);
  assert.equal(summary.runs, 2505);
  assert.equal(summary.pricedRuns, 2504);
  assert(Math.abs(summary.spend - 25.04) < 0.00001);
  assert.equal(
    summary.daily.reduce((n, d) => n + d.runs, 0),
    2505,
  );
  const first = activityPage(f.registry.db, url);
  url.searchParams.set("offset", "100");
  const second = activityPage(f.registry.db, url);
  assert.equal(first.records.length, 100);
  assert.equal(first.total, 2505);
  assert.equal(second.records.length, 100);
  assert(
    !second.records.some((r) => first.records.some((a) => a.runId === r.runId)),
  );
  assert.equal(
    comparisonList(f.registry.db, url).find(
      (c) => c.comparisonId === comparisonId,
    ).runs,
    2,
  );
  assert.equal(comparisonData(f.registry.db, comparisonId).records.length, 2);
  const dashboard = (await f.call("/api/dashboard?days=7&mode=live")).body;
  assert.equal(dashboard.summary.runs, 2505);
  assert.equal(dashboard.records.length, 100);
  assert.equal(dashboard.truncated, false);
  assert(
    performance.now() - start < 10000,
    "representative local fixture should finish within 10 seconds",
  );
});

test("skill activity ignores catalogue harness filtering and retains missing-price coverage", async (t) => {
  const f = await fixture(t);
  const s = skill();
  f.registry.publishSkill("admin", s, null);
  const p = exampleProfile("review", "work", "fixture/local");
  const a = nativeRecord(p, "claude-code", s);
  const b = nativeRecord(p, "codex", s);
  b.models = [{ ...b.models[0], estimatedCostUsd: null }];
  f.registry.putRuns("admin", [a, b]);
  const r = await f.call(
    `/api/skills/admin/${s.name}/${s.revision}/activity?days=30&mode=live&harness=codex`,
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.summary.runs, 2);
  assert.equal(r.body.summary.harnesses.length, 2);
  assert.equal(
    r.body.summary.harnesses.find((h) => h.harness === "codex").spend,
    null,
  );
  await f.call("/api/skills/feedback", { ...ref("admin", s), value: "useful" });
  await f.call("/api/skills/feedback", {
    ...ref("admin", s),
    value: "needs-local-setup",
  });
  assert.deepEqual(
    f.registry.ops.feedbackSummary(ref("admin", s)).map((r) => ({ ...r })),
    [{ value: "needs-local-setup", count: 1 }],
  );
});

test("trials pin comparable setups and require evidence for an adoption decision", async (t) => {
  const f = await fixture(t);
  const a = exampleProfile("baseline", "work", "fixture/local");
  const b = exampleProfile("candidate", "work", "fixture/local", true);
  f.registry.publish("admin", a, null);
  f.registry.publish("colleague", b, null);
  const created = await f.call("/api/trials", {
    name: "Review trial",
    baseline: ref("admin", a),
    candidate: ref("colleague", b),
  });
  assert.equal(created.status, 200);
  const trial = created.body.trial;
  assert.equal(trial.kind, "controlled");
  assert.equal(
    (
      await f.call(`/api/trials/${trial.trialId}/conclusion`, {
        conclusion: "adopt-candidate",
      })
    ).status,
    409,
  );
  const rs = [a, b].map((p) => ({ ...record(p), comparisonId: trial.trialId }));
  assert.throws(
    () => f.registry.putRuns("another", [{ ...rs[0], actorId: "another" }]),
    /trial owner/,
  );
  assert.throws(
    () =>
      f.registry.putRuns("admin", [
        { ...rs[0], profileRevision: digest("unrelated") },
      ]),
    /exact setup/,
  );
  assert.throws(
    () => f.registry.putRuns("admin", [{ ...rs[0], source: "extension" }]),
    /frozen-context/,
  );
  f.registry.putRuns("admin", [rs[0]]);
  assert.throws(
    () =>
      f.registry.putRuns("admin", [
        { ...rs[1], contextHash: digest("another task") },
      ]),
    /same frozen task/,
  );
  f.registry.putRuns("admin", [rs[1]]);
  for (const r of rs)
    f.registry.putAssessments("admin", [
      {
        schemaVersion: 1,
        eventId: randomUUID(),
        runId: r.runId,
        actorId: "admin",
        parents: [],
        createdAt: new Date().toISOString(),
        outcome: {
          validFindings: 1,
          falsePositives: 0,
          missedKnownIssues: 0,
          evaluator: "human",
        },
      },
    ]);
  assert.equal(
    (
      await f.call(`/api/trials/${trial.trialId}/conclusion`, {
        conclusion: "adopt-candidate",
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.call(`/api/trials/${trial.trialId}`)).body.records.length,
    2,
  );
  assert.throws(
    () => f.registry.ops.conclude("another", trial.trialId, "keep-baseline"),
    /trial owner/,
  );
});

test("counter checkpoints stay local until finalized and can recover after process loss", async (t) => {
  const f = await fixture(t);
  const d = await f.device("collector");
  const p = exampleProfile("review", "work", "fixture/local");
  const r = nativeRecord(p, "codex");
  r.deviceId = d.store.identity().deviceId;
  const cp = new TelemetryCheckpoint(d.store);
  cp.save([r]);
  await d.client.sync();
  assert.equal(
    f.registry.db.prepare("SELECT COUNT(*) AS n FROM runs").get().n,
    0,
  );
  assert.equal((await d.client.status()).pendingLiveRuns, 0);
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  const lease = JSON.parse(readFileSync(cp.path, "utf8"));
  lease.pid = child.pid;
  jsonWrite(cp.path, lease, true);
  assert.equal(recoverTelemetry(d.store).recovered, 1);
  await d.client.sync();
  const saved = JSON.parse(
    String(f.registry.db.prepare("SELECT body FROM runs").get().body),
  );
  assert.equal(saved.collectionState, "interrupted");
  const active = new TelemetryCheckpoint(d.store);
  active.save([{ ...r, runId: randomUUID() }]);
  assert.equal(
    recoverTelemetry(d.store).recovered,
    0,
    "never recover a living collector",
  );
});

test("source checks detect drift without replacing the captured or published revision", async (t) => {
  const f = await fixture(t);
  const d = await f.device("sources");
  const root = join(f.dir, "native");
  mkdirSync(root);
  writeFileSync(join(root, "config.toml"), 'model="before"\n');
  const options = {
    name: "native",
    harness: "codex",
    scope: "work",
    agentDir: root,
    version: "fixture",
  };
  const p = captureSetup(options);
  saveSetup(d.store, p);
  rememberCapture(d.store, options, p.revision);
  await d.client.publish(p);
  writeFileSync(join(root, "config.toml"), 'model="after"\n');
  assert.equal(checkSources(d.store)[0].state, "changed");
  await d.client.sync();
  assert.equal(f.registry.profiles()[0].revision, p.revision);
  const status = localDeviceStatus(d.store, { native: p.revision }, 0);
  assert.equal(status.changedSources, 1);
  assert(!JSON.stringify(status).includes(root));
  const receipt = f.registry.db
    .prepare("SELECT synced_at,body FROM device_sync WHERE token_id=?")
    .get(d.credential.tokenId);
  assert(receipt.synced_at);
  assert.equal(JSON.parse(String(receipt.body)).changedSources, 1);
  writeFileSync(join(root, "config.toml"), 'model="before"\n');
  const promptFile = join(f.dir, "reusable-request.md");
  writeFileSync(promptFile, "Review reusable behavior.");
  const withPrompt = {
    ...options,
    prompt: readFileSync(promptFile, "utf8"),
    promptFile,
  };
  const prompted = captureSetup(withPrompt);
  rememberCapture(d.store, withPrompt, prompted.revision);
  assert.equal(checkSources(d.store)[0].state, "unchanged");
  writeFileSync(promptFile, "Review reusable behavior and edge cases.");
  assert.equal(checkSources(d.store)[0].state, "changed");
  assert(
    !JSON.stringify(localDeviceStatus(d.store, {}, 0)).includes(promptFile),
  );
});

test("proxy handling ignores untrusted headers and chooses the first untrusted hop", () => {
  const req = (peer, forwarded) => ({
    socket: { remoteAddress: peer },
    headers: { "x-forwarded-for": forwarded },
  });
  const trusted = trustedProxyAddresses(["127.0.0.1", "10.0.0.1"]);
  assert.equal(
    clientAddress(req("192.0.2.2", "198.51.100.1"), trusted),
    "192.0.2.2",
  );
  assert.equal(
    clientAddress(
      req("::ffff:127.0.0.1", "198.51.100.99, 192.0.2.5, 10.0.0.1"),
      trusted,
    ),
    "192.0.2.5",
  );
  assert.equal(
    clientAddress(req("127.0.0.1", "invalid"), trusted),
    "127.0.0.1",
  );
  assert.throws(() => trustedProxyAddresses(["0.0.0.0/0"]), /explicit IP/);
});

test("quotas reject new uploads atomically while listings do not decode stored artifact blobs", async (t) => {
  const f = await fixture(t);
  const p = exampleProfile("review", "work", "fixture/local");
  f.registry.publish("admin", p, null);
  f.registry.db
    .prepare("UPDATE blobs SET body=? WHERE revision=?")
    .run('{"corrupt":true}', p.revision);
  assert.equal(f.registry.profiles()[0].revision, p.revision);
  assert.throws(() => f.registry.profile("admin", p.name, p.revision));
  f.registry.db
    .prepare("UPDATE blobs SET body=? WHERE revision=?")
    .run(canonical(p), p.revision);
  f.registry.ops.setLimits("admin", {
    maxStorageMb: 10,
    maxRuns: 100,
    withdrawalRetentionDays: 30,
  });
  const seed = record(p);
  f.registry.transaction(() => {
    const q = f.registry.db.prepare(
      "INSERT INTO runs(run_id,owner,body) VALUES(?,?,?)",
    );
    for (let i = 0; i < 99; i++) {
      const r = { ...seed, runId: randomUUID() };
      q.run(r.runId, r.actorId, canonical(r));
    }
  });
  const before = f.registry.changes(0, 100).changes.length;
  assert.throws(
    () =>
      f.registry.putRuns("admin", [
        { ...seed, runId: randomUUID() },
        { ...seed, runId: randomUUID() },
      ]),
    /quota/,
  );
  assert.equal(
    f.registry.db.prepare("SELECT COUNT(*) AS n FROM runs").get().n,
    99,
  );
  assert.equal(f.registry.changes(0, 100).changes.length, before);
});

test("Cursor and OpenCode setups cannot create comparisons", async (t) => {
  const f = await fixture(t);
  for (const harness of ["cursor", "opencode"]) {
    const setup = (name) =>
      sealNativeSetup({
        schemaVersion: 2,
        kind: "setup",
        name,
        scope: "work",
        harness: { kind: harness, version: "fixture" },
        settings: {},
        workflow: { id: "review", prompt: "Review carefully." },
        resources: { skills: [], hooks: [], agents: [], prompts: [] },
        instructions: [],
        files: [],
        skillPins: [],
        requirements: [],
        omittedSettings: [],
      });
    const baseline = setup(`${harness}-baseline`);
    const candidate = setup(`${harness}-candidate`);
    f.registry.publish("admin", baseline, null);
    f.registry.publish("colleague", candidate, null);
    const trialCount = f.registry.ops.trials().length;
    const response = await f.call("/api/trials", {
      name: `${harness} comparison`,
      baseline: ref("admin", baseline),
      candidate: ref("colleague", candidate),
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "unsupported_harness");
    assert.equal(f.registry.ops.trials().length, trialCount);
    if (harness === "cursor") {
      await f.device("unsupported-trial");
      const trialId = randomUUID();
      const now = new Date().toISOString();
      f.registry.db
        .prepare("INSERT INTO trials(trial_id,owner,body) VALUES(?,?,?)")
        .run(
          trialId,
          "admin",
          canonical({
            trialId,
            owner: "admin",
            name: "Previously created Cursor comparison",
            baseline: ref("admin", baseline),
            candidate: ref("colleague", candidate),
            createdAt: now,
            updatedAt: now,
            kind: "observation",
            conclusion: null,
          }),
        );
      await assert.rejects(
        () =>
          exec(
            process.execPath,
            [
              "dist/cli.js",
              "team",
              "trial",
              "team",
              trialId,
              "--home",
              join(f.dir, "unsupported-trial"),
              "--scope",
              "work",
              "--prepare-only",
            ],
            { cwd: process.cwd() },
          ),
        /Comparisons currently support Pi, Claude Code, and Codex setups only/,
      );
    }
  }
  assert.equal(f.registry.ops.trials().length, 1);
});

test("CLI trial preparation freezes the chosen local task and preserves pinned native launch configuration", async (t) => {
  const f = await fixture(t);
  const d = await f.device("trial-cli");
  const a = exampleProfile("baseline", "work", "fixture/local");
  const b = exampleProfile("candidate", "work", "fixture/local", true);
  f.registry.publish("admin", a, null);
  f.registry.publish("colleague", b, null);
  const trial = f.registry.ops.createTrial("admin", {
    name: "CLI preparation",
    baseline: ref("admin", a),
    candidate: ref("colleague", b),
  });
  const repo = join(f.dir, "repository");
  mkdirSync(repo);
  const git = (args) => {
    const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(["init", "-q"]);
  writeFileSync(join(repo, "code.txt"), "LOCAL_TASK_SENTINEL\n");
  git(["add", "code.txt"]);
  git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "initial",
  ]);
  const args = [
    "dist/cli.js",
    "team",
    "trial",
    "team",
    trial.trialId,
    "--home",
    join(f.dir, "trial-cli"),
    "--scope",
    "work",
    "--repo",
    repo,
    "--base",
    "HEAD",
    "--head",
    "HEAD",
    "--prepare-only",
  ];
  const prepared = JSON.parse(
    (await exec(process.execPath, args, { cwd: process.cwd() })).stdout,
  );
  assert(existsSync(join(prepared.packet, "packet.json")));
  assert.equal(prepared.profiles.length, 2);
  assert.equal(
    JSON.parse(
      (await exec(process.execPath, args, { cwd: process.cwd() })).stdout,
    ).packet,
    prepared.packet,
  );
  await assert.rejects(
    () =>
      exec(
        process.execPath,
        args.map((x, i) => (args[i - 1] === "--base" ? "HEAD~1" : x)),
        { cwd: process.cwd() },
      ),
    /frozen local task/,
  );
  assert(
    !JSON.stringify(f.registry.changes(0, 100)).includes("LOCAL_TASK_SENTINEL"),
  );
  const root = join(f.dir, "native-trial");
  mkdirSync(root);
  writeFileSync(join(root, "config.toml"), 'model="model-a"\n');
  const one = captureSetup({
    name: "native-a",
    scope: "work",
    harness: "codex",
    agentDir: root,
    version: "fixture",
  });
  writeFileSync(join(root, "config.toml"), 'model="model-b"\n');
  const two = captureSetup({
    name: "native-b",
    scope: "work",
    harness: "codex",
    agentDir: root,
    version: "fixture",
  });
  f.registry.publish("admin", one, null);
  f.registry.publish("colleague", two, null);
  const native = f.registry.ops.createTrial("admin", {
    name: "Native preparation",
    baseline: ref("admin", one),
    candidate: ref("colleague", two),
  });
  const command = [
    "dist/cli.js",
    "team",
    "trial",
    "team",
    native.trialId,
    "--home",
    join(f.dir, "trial-cli"),
    "--scope",
    "work",
    "--prepare-only",
  ];
  const output = JSON.parse(
    (await exec(process.execPath, command, { cwd: process.cwd() })).stdout,
  );
  assert.equal(output.capability, "observations-only");
  assert.equal(output.prepared.length, 2);
  assert(output.prepared[0].telemetry.includes("--config-dir"));
  assert.equal(
    JSON.parse(
      readFileSync(
        join(output.prepared[0].directory, "pi-share-setup.json"),
        "utf8",
      ),
    ).revision,
    one.revision,
  );
});
