import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Registry, serveRegistry } from '../dist/registry.js';
import { TeamClient, connectTeam, registryUrl } from '../dist/team-client.js';
import { Store } from '../dist/store.js';
import { Collector } from '../dist/metrics.js';
import { canonical, digest, jsonWrite } from '../dist/files.js';
import { exampleProfile, getProfile, saveProfile, sealProfile } from '../dist/profiles.js';
import { assessmentHeads, orderAssessments } from '../dist/assessments.js';
import { formatReport } from '../dist/runner.js';

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-share-team-'));
  const registry = new Registry(join(dir, 'registry'), { teamName: 'engineering', scope: 'work' });
  const server = await serveRegistry(registry, { port: 0 }); const url = `http://127.0.0.1:${server.port}`;
  t.after(async () => { await server.close(); registry.close(); rmSync(dir, { recursive: true, force: true }); });
  async function device(name, actor) {
    const store = new Store(join(dir, name), 'work'); const credential = registry.grant(actor);
    await connectTeam(store, 'team', url, credential);
    return { store, credential, client: new TeamClient(store, 'team') };
  }
  async function api(credential, path, body) {
    const response = await fetch(`${url}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(credential ? { Authorization: `Bearer ${credential.token}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, value: await response.json() };
  }
  return { dir, registry, url, device, api };
}
function run(store, profile, mode = 'live') {
  const collector = new Collector({ runId: randomUUID(), comparisonId: null, scope: store.scope, ...store.identity(),
    profileName: profile.name, profileRevision: profile.revision, effectiveConfigHash: digest('effective'), contextHash: digest('same-context'),
    workflowId: profile.workflow.id, mode, source: 'runner', piVersion: '0.85.1', toolPolicy: 'profile',
  }, '.');
  collector.observe({ type: 'message_end', message: { role: 'assistant', provider: 'fixture', model: 'local', stopReason: 'stop',
    content: [{ type: 'text', text: 'PRIVATE_RESPONSE_SENTINEL' }], usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.01 } },
  } });
  return store.writeMetrics(collector.finish());
}
const score = (valid) => ({ validFindings: valid, falsePositives: 0, missedKnownIssues: 0, evaluator: 'human' });

test('registry authenticates, enforces ownership/scope, rejects trace fields, and revokes credentials', async t => {
  const f = await fixture(t); const alice = await f.device('alice', 'alice'); const bob = await f.device('bob', 'bob');
  const profile = exampleProfile('review', 'work', 'fixture/local'); const record = run(alice.store, profile);
  assert.equal((await f.api(null, '/v1/profiles')).status, 401);
  assert.equal((await f.api(bob.credential, '/v1/runs', { records: [record] })).status, 403);
  assert.equal((await f.api(alice.credential, '/v1/runs', { records: [{ ...record, transcript: 'PRIVATE_TRACE_SENTINEL' }] })).status, 400);
  assert.equal((await f.api(alice.credential, '/v1/runs', { records: [{ ...record, scope: 'personal' }] })).status, 403);
  assert.equal((await f.api(alice.credential, '/v1/profiles', { profile: exampleProfile('personal', 'personal', 'fixture/local'), expectedRevision: null })).status, 403);
  assert.equal((await f.api(alice.credential, '/v1/runs', { records: [record, { ...record, runId: randomUUID(), actorId: 'bob' }] })).status, 403);
  assert.equal(f.registry.changes(0, 100).changes.length, 0, 'a rejected batch must roll back its preceding valid records');
  const storedToken = String(f.registry.db.prepare('SELECT token_hash FROM tokens WHERE token_id=?').get(alice.credential.tokenId).token_hash);
  assert.equal(storedToken, digest(alice.credential.token)); assert(!JSON.stringify(f.registry.tokens()).includes(alice.credential.token));
  const otherAdmin = new Registry(join(f.dir, 'registry')); otherAdmin.revoke(alice.credential.tokenId); otherAdmin.close();
  await assert.rejects(() => alice.client.sync(), /expired, revoked, or invalid/);
  assert(!existsSync(join(alice.store.dir, 'remotes/team/sync.lock')));
  assert.equal((await bob.client.identity()).actorId, 'bob');
  f.registry.db.prepare('UPDATE tokens SET expires_at=? WHERE token_id=?').run('2000-01-01T00:00:00.000Z', bob.credential.tokenId);
  assert.equal((await f.api(bob.credential, '/v1/me')).status, 401);
  assert.throws(() => registryUrl('http://example.com'), /HTTPS/); assert.throws(() => registryUrl('https://user:secret@example.com'), /credentials/);
});

test('team setup catalogue keeps ownership, immutable revisions, local aliases, and stale-publish detection', async t => {
  const f = await fixture(t); const alice = await f.device('alice', 'alice'); const second = await f.device('alice-laptop', 'alice'); const bob = await f.device('bob', 'bob');
  const baseline = exampleProfile('review', 'work', 'fixture/local'); const changed = exampleProfile('review', 'work', 'fixture/local', true);
  await alice.client.publish(baseline); await bob.client.publish(changed);
  assert.equal((await alice.client.profiles()).length, 2);
  saveProfile(bob.store, changed);
  const pulled = await bob.client.pull('alice/review');
  assert.equal(pulled.alias, 'alice--review'); assert.equal(getProfile(bob.store, pulled.alias).revision, baseline.revision);
  assert.equal(getProfile(bob.store, 'review').revision, changed.revision, 'pull must preserve the receiver\'s own profile');
  await second.client.pull('alice/review', { alias: 'my-review' });
  await alice.client.publish(changed);
  const { revision, ...body } = baseline;
  const third = sealProfile({ ...body, workflow: { ...body.workflow, prompt: 'An explicitly changed review workflow.' } });
  await assert.rejects(() => second.client.publish(third), /changed on another device/);
  assert.equal((await bob.client.pull('alice/review', { revision: baseline.revision })).profile.revision, baseline.revision);
  assert.equal((await bob.client.profiles()).find(p => p.owner === 'alice').revision, changed.revision);
  await assert.rejects(() => bob.client.pull('alice/review', { alias: 'review', revision: baseline.revision }), /already names another setup/);
  assert.throws(() => sealProfile({ ...body, workflow: { ...body.workflow, prompt: alice.credential.token } }), /credential/);
  assert.equal((await alice.client.publish(changed)).published, false, 'identical publish is idempotent');
});

test('incremental sync sends owned metadata, preserves local review content, and excludes demos by default', async t => {
  const f = await fixture(t); const alice = await f.device('alice', 'alice'); const bob = await f.device('bob', 'bob');
  const profile = saveProfile(alice.store, exampleProfile('review', 'work', 'fixture/local'));
  const live = run(alice.store, profile); const demo = run(alice.store, profile, 'demo');
  const runDir = join(alice.store.dir, 'runs', live.runId); mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'review.md'), 'PRIVATE_LOCAL_REVIEW_SENTINEL');
  const connectionPath = join(alice.store.dir, 'remotes/team/connection.json'); const connection = JSON.parse(readFileSync(connectionPath));
  jsonWrite(connectionPath, { ...connection, url: 'http://127.0.0.1:1' }, true);
  await assert.rejects(() => new TeamClient(alice.store, 'team').sync());
  assert.equal(alice.store.records().length, 2); assert(!existsSync(join(alice.store.dir, 'remotes/team/sync.lock')));
  jsonWrite(connectionPath, connection, true);
  const result = await alice.client.sync(); assert.equal(result.uploadedRuns, 1);
  assert.equal(f.registry.profiles().length, 0, 'analytics sync must not implicitly publish setup files');
  assert.equal((await alice.client.sync()).uploadedRuns, 0);
  const downloaded = await bob.client.sync(); assert.equal(downloaded.downloadedRuns, 1);
  assert.equal(bob.store.records()[0].runId, live.runId); assert(!bob.store.records().some(r => r.runId === demo.runId));
  assert(!existsSync(join(bob.store.dir, 'runs', live.runId))); assert(!existsSync(join(bob.store.dir, 'profiles')));
  const feed = await f.api(alice.credential, '/v1/changes?after=0&limit=1');
  assert.equal(feed.value.nextCursor, 1); assert.equal(feed.value.hasMore, false);
  assert(!JSON.stringify(feed.value).includes('PRIVATE_')); assert(!JSON.stringify(feed.value).includes('workflow.prompt'));
  const stored = f.registry.db.prepare('SELECT body FROM runs').all().map(r => String(r.body)).join(''); assert(!stored.includes('PRIVATE_'));
  assert.equal((await alice.client.sync({ includeDemo: true })).uploadedRuns, 1); await bob.client.sync(); assert.equal(bob.store.records().length, 2);
  assert.equal((await f.api(alice.credential, '/v1/runs', { records: [{ ...live, turns: live.turns + 1 }] })).status, 409);
  const reopened = new Registry(join(f.dir, 'registry')); assert.equal(reopened.metadata.teamId, f.registry.metadata.teamId); assert.equal(reopened.changes(0, 100).changes.length, 2); reopened.close();
  assert.equal((await f.api(alice.credential, '/v1/changes?after=999')).status, 409);
  f.registry.putRuns('alice', Array.from({ length: 103 }, () => ({ ...live, runId: randomUUID() })));
  const paginated = await bob.client.sync(); assert.equal(paginated.downloadedRuns, 103); assert.equal(paginated.cursor, 105);
  assert.equal((await bob.client.sync()).downloadedRuns, 0);
  const simultaneous = await Promise.allSettled([bob.client.sync(), bob.client.sync()]);
  assert.equal(simultaneous.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(simultaneous.filter(r => r.status === 'rejected').length, 1);
});

test('offline score edits keep both branches and converge through an explicit assessment', async t => {
  const f = await fixture(t); const a = await f.device('desktop', 'alice'); const b = await f.device('laptop', 'alice'); const bob = await f.device('bob', 'bob');
  const profile = exampleProfile('review', 'work', 'fixture/local'); const record = run(a.store, profile);
  await a.client.sync(); await b.client.sync();
  const original = a.store.score(record.runId, 'alice', score(1)); await a.client.sync(); await b.client.sync();
  const left = a.store.score(record.runId, 'alice', score(2)); const right = b.store.score(record.runId, 'alice', score(3));
  assert.deepEqual(left.parents, [original.eventId]); assert.deepEqual(right.parents, [original.eventId]);
  await a.client.sync(); const conflict = await b.client.sync(); assert.equal(conflict.scoreConflicts.length, 1);
  await a.client.sync(); assert.equal(assessmentHeads(a.store.assessments()).length, 2);
  assert.match(formatReport(a.store.records(), a.store.assessments()), /conflict/);
  const resolved = a.store.score(record.runId, 'alice', score(2)); assert.equal(resolved.parents.length, 2);
  await a.client.sync(); assert.equal((await b.client.sync()).scoreConflicts.length, 0);
  assert.deepEqual(assessmentHeads(b.store.assessments()).map(e => e.eventId), [resolved.eventId]);
  assert.match(formatReport(b.store.records(), b.store.assessments()), /2 \/ 0 \/ 0/);
  assert.equal(a.store.records()[0].outcome, null, 'human edits must not mutate run counters or the original outcome');
  await bob.client.sync(); bob.store.score(record.runId, 'bob', score(4)); await bob.client.sync(); await a.client.sync();
  assert.equal(assessmentHeads(a.store.assessments()).length, 2, 'different reviewers have independent assessments');
  assert.equal((await a.client.sync()).scoreConflicts.length, 0);
  const malicious = { ...resolved, eventId: randomUUID(), actorId: 'alice', parents: [assessmentHeads(bob.store.assessments()).find(e => e.actorId === 'bob').eventId] };
  assert.equal((await f.api(a.credential, '/v1/assessments', { assessments: [malicious] })).status, 409);
  assert.equal((await f.api(bob.credential, '/v1/assessments', { assessments: [resolved] })).status, 403);
});

test('v2 file exchange includes edit history, accepts v1 exports, and binds each scoped store to one team', async t => {
  const f = await fixture(t); const a = await f.device('desktop', 'alice');
  const profile = exampleProfile('review', 'work', 'fixture/local'); const record = run(a.store, profile);
  const other = new Store(join(f.dir, 'file-receiver'), 'work');
  const legacy = join(f.dir, 'v1.json'); jsonWrite(legacy, { schemaVersion: 1, scope: 'work', records: [record] }); assert.equal(other.importAnalytics(legacy), 1);
  a.store.score(record.runId, 'alice', score(1)); const first = join(f.dir, 'first.json'); a.store.exportAnalytics(first); assert.equal(other.importAnalytics(first), 0);
  a.store.score(record.runId, 'alice', score(2)); const second = join(f.dir, 'second.json'); a.store.exportAnalytics(second); assert.equal(other.importAnalytics(second), 0);
  assert.equal(other.assessments().length, 2); assert.equal(assessmentHeads(other.assessments())[0].outcome.validFindings, 2);
  const invalid = JSON.parse(readFileSync(second)); invalid.assessments[0].transcript = 'PRIVATE'; jsonWrite(join(f.dir, 'invalid.json'), invalid);
  assert.throws(() => other.importAnalytics(join(f.dir, 'invalid.json')));
  assert.throws(() => orderAssessments([{ ...other.assessments()[0], parents: [other.assessments()[1].eventId] }, other.assessments()[1]]), /cycle/);
  await assert.rejects(() => connectTeam(new Store(join(f.dir, 'personal'), 'personal'), 'team', f.url, a.credential), /scope/);
  const another = new Registry(join(f.dir, 'another'), { teamName: 'another-team', scope: 'work' }); const serving = await serveRegistry(another, { port: 0 });
  try {
    await assert.rejects(() => connectTeam(a.store, 'other-team', `http://127.0.0.1:${serving.port}`, another.grant('alice')), /already belongs to another team/);
  } finally { await serving.close(); another.close(); }
});
