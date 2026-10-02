import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseToml } from 'smol-toml';
import { captureSkill, getSkill, saveSkill, installSkill, skillDestination, validateSkill, pinnedSkill } from '../dist/skills.js';
import { addSkillToSetup, captureSetup, getSetup, saveSetup, materializeSetup, sealNativeSetup, validateSetup } from '../dist/setups.js';
import { exampleProfile, listProfiles } from '../dist/profiles.js';
import { Registry, serveRegistry } from '../dist/registry.js';
import { Store } from '../dist/store.js';
import { connectTeam, TeamClient } from '../dist/team-client.js';
import { NativeTelemetry, serveTelemetry, telemetryInstructions } from '../dist/telemetry.js';
import { formatReport } from '../dist/runner.js';
import { metricsSchema } from '../dist/schema.js';
import { packFile } from '../dist/files.js';

const put = (path, body) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body); };
function temp(t) { const dir = mkdtempSync(join(tmpdir(), 'pi-share-assets-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function makeSkill(dir, extra = '') { put(join(dir, 'SKILL.md'), `---\nname: precise-review\ndescription: Review changes for actionable bugs.\n${extra}---\nTrace changed behavior and report evidence.\n`); put(join(dir, 'scripts/check.sh'), '#!/bin/sh\nexit 0\n'); chmodSync(join(dir, 'scripts/check.sh'), 0o755); return captureSkill({ dir, scope: 'work' }); }
function native(dir, harness = 'codex') {
  put(join(dir, harness === 'codex' ? 'config.toml' : 'settings.json'), harness === 'codex' ? 'model="test-model"\nmodel_reasoning_effort="high"\n' : '{"model":"test-model","effortLevel":"high"}');
  return captureSetup({ name: `review-${harness}`, scope: 'work', harness, agentDir: dir, version: '1.2.3' });
}
async function registryFixture(t, dir) {
  const registry = new Registry(join(dir, 'registry'), { teamName: 'team', scope: 'work' }); const serving = await serveRegistry(registry, { port: 0 });
  t.after(async () => { await serving.close(); registry.close(); }); const url = `http://127.0.0.1:${serving.port}`;
  async function client(label, actor) { const store = new Store(join(dir, label), 'work'); const credential = registry.grant(actor); await connectTeam(store, 'team', url, credential); return { store, credential, client: new TeamClient(store, 'team') }; }
  return { registry, url, client };
}
const otlp = (events, harness = 'claude-code') => ({ resourceLogs: [{ resource: { attributes: [{ key: 'service.version', value: { stringValue: '2.1.268' } }] }, scopeLogs: [{ logRecords: events.map((event, i) => ({ timeUnixNano: String(BigInt(Date.now() + i) * 1000000n), attributes: Object.entries({ 'session.id': 'PRIVATE_NATIVE_SESSION', 'event.name': `${harness === 'codex' ? 'codex' : 'claude_code'}.${event.event}`, ...event.attrs }).map(([key, value]) => ({ key, value: { [typeof value === 'number' ? 'doubleValue' : 'stringValue']: value } })) })) }] }] });

test('skills preserve supporting files and executable bits, enforce compatibility, and never replace an installed folder', t => {
  const dir = temp(t); const skill = makeSkill(join(dir, 'skill')); const store = new Store(join(dir, 'store'), 'work');
  saveSkill(store, skill); assert.equal(getSkill(store, skill.name).revision, skill.revision);
  for (const harness of ['pi', 'claude-code', 'codex']) {
    const dest = skillDestination(skill.name, harness, join(dir, harness)); installSkill(skill, harness, dest);
    assert.equal(readFileSync(join(dest, 'SKILL.md'), 'utf8'), readFileSync(join(dir, 'skill/SKILL.md'), 'utf8')); assert(statSync(join(dest, 'scripts/check.sh')).mode & 0o100);
    assert.throws(() => installSkill(skill, harness, dest), /exists/);
  }
  assert.throws(() => validateSkill({ ...skill, description: 'Tampered' }), /metadata|revision/);
  assert.throws(() => validateSkill({ ...skill, files: [packFile('../escape', Buffer.from('oops'))] }), /Unsafe/);
  const only = captureSkill({ dir: join(dir, 'skill'), scope: 'work', compatibleWith: ['claude-code'] }); assert.throws(() => installSkill(only, 'codex', join(dir, 'bad')), /compatibility/); assert(!existsSync(join(dir, 'bad')));
  mkdirSync(join(dir, 'real')); symlinkSync(join(dir, 'real'), join(dir, 'link')); assert.throws(() => installSkill(skill, 'codex', join(dir, 'link/skill')), /symlink/);
  put(join(dir, 'native-skill/SKILL.md'), '---\nname: native\ndescription: Native behavior\ncontext: fork\n---\nDo work.');
  assert.throws(() => captureSkill({ dir: join(dir, 'native-skill'), scope: 'work' }), /--compatible/);
  const portable = captureSkill({ dir: join(dir, 'skill'), scope: 'work', compatibleWith: ['pi', 'claude-code', 'codex', 'cursor', 'opencode'] });
  for (const harness of ['cursor', 'opencode']) {
    const dest = skillDestination(portable.name, harness, join(dir, harness));
    assert.equal(dest, join(dir, harness, '.agents/skills', portable.name));
    installSkill(portable, harness, dest);
    assert.equal(readFileSync(join(dest, 'SKILL.md'), 'utf8'), readFileSync(join(dir, 'skill/SKILL.md'), 'utf8'));
  }
  put(join(dir, 'bad-name/SKILL.md'), '---\nname: Bad_Name\ndescription: Native behavior\n---\nDo work.');
  assert.throws(() => captureSkill({ dir: join(dir, 'bad-name'), scope: 'work', compatibleWith: ['opencode'] }), /lowercase words/);
  put(join(dir, 'long-description/SKILL.md'), `---\nname: long-description\ndescription: ${'a'.repeat(1025)}\n---\nDo work.`);
  assert.throws(() => captureSkill({ dir: join(dir, 'long-description'), scope: 'work', compatibleWith: ['opencode'] }), /1024 characters/);
});

test('the same standalone skill pins into Pi, Claude Code, and Codex without translating native configuration', t => {
  const dir = temp(t); const skill = makeSkill(join(dir, 'skill')); const store = new Store(join(dir, 'store'), 'work');
  const pi = exampleProfile('pi-review', 'work', 'fixture/local');
  const setups = [pi, native(join(dir, 'claude'), 'claude-code'), native(join(dir, 'codex'))];
  for (const original of setups) {
    const setup = addSkillToSetup(original, skill); assert.notEqual(setup.revision, original.revision); assert.equal(setup.skillPins[0].revision, skill.revision);
    assert.equal(pinnedSkill(setup.skillPins[0], setup.files, 'work').revision, skill.revision); saveSetup(store, setup); assert.equal(getSetup(store, setup.name).revision, setup.revision);
    assert.deepEqual(setup.settings, original.settings);
    const copy = structuredClone(setup); copy.skillPins[0].revision = 'a'.repeat(64); assert.throws(() => validateSetup(copy), /revision/);
    const unreferenced = structuredClone(setup); unreferenced.resources.skills = []; assert.throws(() => validateSetup(unreferenced), /missing from setup resources/);
  }
  assert.equal(listProfiles(store).length, 1, 'native setups must not break the Pi-only runtime catalogue');
  put(join(dir, 'skill/scripts/check.sh'), '#!/bin/sh\nexit 1\n'); const updated = captureSkill({ dir: join(dir, 'skill'), scope: 'work' });
  const next = addSkillToSetup(getSetup(store, 'review-codex'), updated); assert.notEqual(next.revision, getSetup(store, 'review-codex').revision);
  assert.equal(getSetup(store, 'review-codex').skillPins[0].revision, skill.revision, 'existing revisions remain pinned');
});

test('native capture excludes credentials, telemetry, memory, task context, and per-project account state', t => {
  const dir = temp(t); const root = join(dir, 'codex'); const project = join(dir, 'repo');
  put(join(root, 'config.toml'), 'model="test-model"\n[otel]\nexporter="none"\n[projects."/PRIVATE/project"]\ntrust_level="trusted"\n[mcp_servers.test]\ncommand="test-server"\nargs=["--api-key","opaque-dummy-value-1234567890"]\n[mcp_servers.test.env]\nTOKEN="PRIVATE_MCP_SECRET"\n');
  put(join(root, 'auth.json'), 'PRIVATE_AUTH'); put(join(root, 'sessions/private.jsonl'), 'PRIVATE_TRACE'); put(join(root, 'memory/MEMORY.md'), 'PRIVATE_MEMORY');
  put(join(root, 'AGENTS.md'), 'Reusable global guidance.'); put(join(project, 'AGENTS.md'), 'PRIVATE_PROJECT_INSTRUCTIONS'); put(join(project, 'code.ts'), 'PRIVATE_CODE');
  const setup = captureSetup({ name: 'safe', scope: 'work', harness: 'codex', agentDir: root, project, version: '1.2.3' });
  assert(!JSON.stringify(setup).includes('PRIVATE_')); assert(!JSON.stringify(setup).includes('opaque-dummy-value')); assert(!JSON.stringify(setup).includes('test-server')); assert.deepEqual(setup.mcpServerNames, ['test']); assert(!('mcp_servers' in setup.settings));
  assert(setup.omittedSettings.includes('otel')); assert(setup.omittedSettings.includes('projects'));
  const dest = join(dir, 'exported'); materializeSetup(setup, dest); assert.equal(parseToml(readFileSync(join(dest, 'config.toml'), 'utf8')).model, 'test-model'); assert(!existsSync(join(dest, 'auth.json'))); assert(!('mcp_servers' in parseToml(readFileSync(join(dest, 'config.toml'), 'utf8'))));
  assert.throws(() => materializeSetup(setup, dest), /exists/);
  const claude = join(dir, 'claude'); put(join(claude, 'settings.json'), '{"model":"test-model","env":{"SECRET":"PRIVATE_SECRET"}}');
  put(join(claude, '.mcp.json'), '{"mcpServers":{"docs":{"type":"http","url":"https://example.invalid/mcp","headers":{"Authorization":"PRIVATE_TOKEN"}}}}');
  const c = captureSetup({ name: 'claude-safe', scope: 'work', harness: 'claude-code', agentDir: claude, version: '1.2.3' }); assert(!JSON.stringify(c).includes('PRIVATE_')); assert(!JSON.stringify(c).includes('example.invalid')); assert.deepEqual(c.mcpServerNames, ['docs']); assert(!('mcpServers' in c));
  const out = join(dir, 'claude-export'); materializeSetup(c, out); assert(!existsSync(join(out, 'mcp.json')));
  assert.throws(() => captureSetup({ name: 'bad', scope: 'work', harness: 'cursor', agentDir: root }), /Invalid option|Invalid value/);
});

test('registry rejects legacy MCP definitions while retaining historical revision validation', t => {
  const dir = temp(t);
  const registry = new Registry(join(dir, 'registry'), { teamName: 'team', scope: 'work' });
  t.after(() => registry.close());
  const safe = native(join(dir, 'codex'));
  const { revision: _revision, mcpServerNames: _names, ...body } = safe;
  const legacy = sealNativeSetup({ ...body, settings: { ...body.settings, mcp_servers: { docs: { command: 'node', args: ['--api-key', 'opaque-dummy-value-1234567890'] } } } });
  assert.equal(validateSetup(legacy).revision, legacy.revision);
  assert.throws(() => registry.publish('alice', legacy, null), /only MCP server names/);
  assert.equal(registry.publish('alice', safe, null).published, true);
});

test('install receipts preserve a shared skill revision when each native harness captures it again', t => {
  const dir = temp(t); const skill = makeSkill(join(dir, 'skill'));
  for (const harness of ['pi', 'claude-code', 'codex']) {
    const root = join(dir, harness); mkdirSync(root);
    put(join(root, harness === 'codex' ? 'config.toml' : 'settings.json'), harness === 'codex' ? 'model="test-model"' : harness === 'pi' ? '{"defaultProvider":"fixture","defaultModel":"local"}' : '{"model":"test-model"}');
    installSkill(skill, harness, join(root, 'skills', skill.name));
    const setup = captureSetup({ name: harness, harness, scope: 'work', agentDir: root, version: 'fixture' });
    assert.equal(setup.skillPins[0].revision, skill.revision); assert(!setup.files.some(f => f.path.endsWith('.pi-share-skill.json')));
  }
});

test('nonstandard native skill metadata does not block setup capture or bypass file and receipt checks', t => {
  const dir = temp(t); const root = join(dir, 'claude'); const skillDir = join(root, 'skills/native-writing');
  const text = '---\nname: native-writing\ndescription: Write prose: improve its clarity.\n---\nKeep the writing precise.\n';
  put(join(root, 'settings.json'), '{"model":"test-model"}'); put(join(skillDir, 'SKILL.md'), text);
  put(join(skillDir, 'references/style.md'), 'Use plain language.');
  assert.throws(() => captureSkill({ dir: skillDir, scope: 'work' }), /valid YAML/);
  const setup = captureSetup({ name: 'native', scope: 'work', harness: 'claude-code', agentDir: root, version: 'fixture' });
  assert.equal(setup.skillPins.length, 0); assert(setup.requirements.some(r => r.includes('without a standalone pin')));
  const dest = join(dir, 'materialized'); materializeSetup(setup, dest);
  assert.equal(readFileSync(join(dest, 'skills/native-writing/SKILL.md'), 'utf8'), text);
  assert.equal(readFileSync(join(dest, 'skills/native-writing/references/style.md'), 'utf8'), 'Use plain language.');
  put(join(skillDir, 'auth.json'), '{"local":"private"}');
  assert.throws(() => captureSetup({ name: 'bad', scope: 'work', harness: 'claude-code', agentDir: root }), /Credential file/);
  rmSync(join(skillDir, 'auth.json')); put(join(skillDir, '.pi-share-skill.json'), '{}');
  assert.throws(() => captureSetup({ name: 'bad', scope: 'work', harness: 'claude-code', agentDir: root }), /valid YAML/);
});

test('skill registry exchange preserves ownership, old revisions, conflicts, and a metadata-only catalogue', async t => {
  const dir = temp(t); const f = await registryFixture(t, dir); const a = await f.client('a', 'alice'); const a2 = await f.client('a2', 'alice'); const b = await f.client('b', 'bob');
  const skill = makeSkill(join(dir, 'skill')); await a.client.publishSkill(skill); await a2.client.pullSkill('alice/precise-review');
  const pulled = await b.client.pullSkill('alice/precise-review'); assert.equal(getSkill(b.store, pulled.alias).revision, skill.revision);
  put(join(dir, 'skill/scripts/check.sh'), '#!/bin/sh\necho changed\n'); const next = captureSkill({ dir: join(dir, 'skill'), scope: 'work' }); await a.client.publishSkill(next);
  await assert.rejects(() => a2.client.publishSkill(skill), /changed on another device/);
  assert.equal((await b.client.pullSkill('alice/precise-review', { revision: skill.revision })).skill.revision, skill.revision);
  await b.client.sync(); assert.equal((await b.client.status()).knownTeamSkills, 1);
  const feed = JSON.stringify(f.registry.changes(0, 100)); assert(!feed.includes('Trace changed behavior')); assert(!feed.includes('base64')); assert(!feed.includes('check.sh'));
  assert.throws(() => f.registry.publishSkill('alice', captureSkill({ dir: join(dir, 'skill'), scope: 'personal' }), null), /scope/);
  const setup = addSkillToSetup(native(join(dir, 'codex')), skill); await a.client.publish(setup); const nativePull = await b.client.pull('alice/review-codex'); assert.equal(nativePull.profile.harness.kind, 'codex');
  assert.equal(f.registry.profiles()[0].skillPins[0].revision, skill.revision);
  const reopened = new Registry(join(dir, 'registry')); assert.equal(reopened.skills()[0].revision, next.revision); reopened.close();
});

test('large skill payloads stay below Cloudflare SQLite row limits and survive reopen', t => {
  const dir = temp(t);
  const skillDir = join(dir, 'large-skill');
  makeSkill(skillDir);
  put(join(skillDir, 'references/large.txt'), 'x'.repeat(1_700_000));
  const skill = captureSkill({ dir: skillDir, scope: 'work' });
  const registryDir = join(dir, 'registry');
  const registry = new Registry(registryDir, { teamName: 'team', scope: 'work' });
  registry.publishSkill('alice', skill, null);
  const chunks = registry.db.prepare("SELECT COUNT(*) AS count,MAX(length(CAST(body AS BLOB))) AS maxBytes FROM artifact_chunks WHERE kind='skill' AND revision=?").get(skill.revision);
  assert(Number(chunks.count) > 1);
  assert(Number(chunks.maxBytes) < 2_000_000);
  assert.equal(registry.skill('alice', skill.name, skill.revision).revision, skill.revision);
  assert(registry.ops.usage().bytes >= 2_000_000);
  registry.close();
  const reopened = new Registry(registryDir);
  assert.equal(reopened.skill('alice', skill.name, skill.revision).revision, skill.revision);
  reopened.close();
});

test('native telemetry keeps counters only, deduplicates exports, and labels missing coverage and unverified completion', t => {
  const dir = temp(t); const setup = native(join(dir, 'claude'), 'claude-code'); const store = new Store(join(dir, 'store'), 'work');
  const collector = new NativeTelemetry(setup, store);
  const payload = otlp([
    { event: 'user_prompt', attrs: { prompt: 'PRIVATE_PROMPT', 'event.sequence': 1 } },
    { event: 'tool_result', attrs: { tool_name: 'Read', success: 'true', duration_ms: 12, tool_input: 'PRIVATE_ARGS', tool_result: 'PRIVATE_OUTPUT', 'event.sequence': 2 } },
    { event: 'api_request', attrs: { model: 'test-model', provider: 'bedrock', input_tokens: 100, output_tokens: 20, cache_read_tokens: 10, cost_usd: 0.02, 'event.sequence': 3 } },
    { event: 'api_request_body', attrs: { body: 'PRIVATE_FULL_TRACE' } },
  ]);
  assert.equal(collector.consume(payload), 3); assert.equal(collector.consume(payload), 0);
  const [record] = collector.records(); assert.equal(record.status, 'recorded'); assert.equal(record.turns, 1); assert.equal(record.tools[0].calls, 1); assert.equal(record.models[0].estimatedCostUsd, .02);
  assert.equal(record.coverage.skills, 'unavailable'); assert.equal(record.coverage.retries, 'unavailable');
  assert.equal(record.models[0].provider, 'bedrock', 'native harness identity must not imply a model provider');
  const stored = JSON.stringify(record); assert(!stored.includes('PRIVATE_')); assert(!stored.includes('tool_input')); assert(!stored.includes('session.id'));
  assert.throws(() => metricsSchema.parse({ ...record, transcript: 'PRIVATE' })); assert.throws(() => metricsSchema.parse({ ...record, coverage: undefined }));
  store.writeMetrics(record); assert.match(formatReport(store.records()), /unknown/); assert.match(formatReport(store.records()), /unverified/);
  const codex = new NativeTelemetry(native(join(dir, 'codex')), store);
  const events = otlp([{ event: 'sse_event', attrs: { 'event.kind': 'response.completed', model: 'codex-model', input_token_count: 50, cached_input_token_count: 10, output_token_count: 7, output: 'PRIVATE_REVIEW' } }], 'codex');
  codex.consume(events); const c = codex.records()[0]; assert.equal(c.models[0].inputTokens, 40); assert.equal(c.models[0].cacheReadTokens, 10); assert.equal(c.models[0].estimatedCostUsd, null); assert.equal(c.coverage.tools, 'unavailable');
  codex.consume(otlp([{ event: 'sse_event', attrs: { 'event.kind': 'response.completed', duration_ms: 1 } }], 'codex'));
  assert.equal(codex.records()[0].models[0].calls, 1, 'stream timing and usage events must not double-count a completion');
  const malformed = new NativeTelemetry(native(join(dir, 'bad-codex')), store);
  malformed.consume(otlp([{ event: 'sse_event', attrs: { 'event.kind': 'response.completed', input_token_count: 50, output_token_count: 7, cached_token_count: 0.5 } }], 'codex'));
  assert.equal(malformed.records()[0].coverage.tokens, 'unavailable', 'invalid token counters cannot poison saved observations');
});

test('loopback collector rejects traces and unauthenticated/browser writes and sync uploads only the saved metadata', async t => {
  const dir = temp(t); const f = await registryFixture(t, dir); const a = await f.client('a', 'alice');
  const collector = new NativeTelemetry(native(join(dir, 'claude'), 'claude-code'), a.store); const server = await serveTelemetry(collector);
  t.after(() => server.close()); const payload = otlp([{ event: 'tool_result', attrs: { tool_name: 'Read', success: 'true', output: 'PRIVATE_TASK' } }]);
  const send = (url, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  assert.equal((await send(server.endpoint)).status, 403);
  const headers = { Authorization: `Bearer ${server.token}` };
  assert.equal((await send(server.endpoint, { ...headers, Origin: 'http://example.invalid' })).status, 403);
  assert.equal((await send(server.endpoint.replace('/logs', '/traces'), headers)).status, 404);
  assert.equal((await send(server.endpoint, headers)).status, 200);
  assert.equal(f.registry.changes(0, 100).changes.length, 0);
  for (const r of collector.records()) a.store.writeMetrics(r);
  assert.equal((await a.client.sync()).uploadedRuns, 1); assert(!JSON.stringify(f.registry.changes(0, 100)).includes('PRIVATE_'));
  assert.match(telemetryInstructions('codex', server.endpoint, server.token), /protocol="json"/);
  assert.match(telemetryInstructions('claude-code', server.endpoint, server.token), /OTEL_LOG_TOOL_DETAILS=0/);
});

test('CLI captures, pins, extracts, materializes, and installs a skill without changing the default harness', t => {
  const dir = temp(t); makeSkill(join(dir, 'skill')); native(join(dir, 'codex'));
  const cli = (...args) => execFileSync(process.execPath, ['dist/cli.js', ...args, '--home', join(dir, 'store'), '--scope', 'work'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  cli('skill', 'capture', join(dir, 'skill')); cli('setup', 'capture', 'review', '--harness', 'codex', '--agent-dir', join(dir, 'codex'), '--harness-version', '1.2.3');
  cli('setup', 'add-skill', 'review', 'precise-review'); const setup = JSON.parse(cli('setup', 'show', 'review')); assert.equal(setup.skillPins[0].name, 'precise-review');
  cli('setup', 'materialize', 'review', '--out', join(dir, 'materialized')); assert(existsSync(join(dir, 'materialized/skills/precise-review/SKILL.md')));
  cli('skill', 'extract', 'review', 'precise-review'); cli('skill', 'install', 'precise-review', '--harness', 'claude-code', '--project', join(dir, 'project'));
  assert(existsSync(join(dir, 'project/.claude/skills/precise-review/SKILL.md'))); assert.equal(JSON.parse(cli('profile', 'list')).length, 0);
  assert.throws(() => cli('run', 'review', '--packet', dir));
});

test('CLI installs declared Cursor and OpenCode skills through the shared Agent Skills path', t => {
  const dir = temp(t); makeSkill(join(dir, 'skill'));
  const cli = (...args) => execFileSync(process.execPath, ['dist/cli.js', ...args, '--home', join(dir, 'store'), '--scope', 'work'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const captured = JSON.parse(cli('skill', 'capture', join(dir, 'skill'), '--compatible', 'cursor,opencode'));
  assert.deepEqual(captured.compatibleWith, ['cursor', 'opencode']);
  for (const harness of ['cursor', 'opencode']) {
    const project = join(dir, harness);
    cli('skill', 'install', 'precise-review', '--harness', harness, '--project', project);
    assert(existsSync(join(project, '.agents/skills/precise-review/SKILL.md')));
  }
  assert.throws(() => cli('setup', 'capture', 'wrong', '--harness', 'cursor', '--agent-dir', dir));
});
