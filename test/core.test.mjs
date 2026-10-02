import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { captureProfile, exampleProfile, getProfile, saveProfile, sealProfile, validateProfile, materializeProfile, assertPinned } from '../dist/profiles.js';
import { canonical, digest, jsonWrite } from '../dist/files.js';
import { Collector } from '../dist/metrics.js';
import { metricsSchema } from '../dist/schema.js';
import { Store } from '../dist/store.js';
import { freezeContext, validatePacket, copyPacket, restoreReviewGit } from '../dist/context.js';

function temp(t) { const dir = mkdtempSync(join(tmpdir(), 'pi-share-test-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
function put(path, value) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, value); }
function identity(overrides = {}) { return {
  runId: randomUUID(), comparisonId: null, scope: 'work', actorId: 'tester', deviceId: randomUUID(),
  profileName: 'review', profileRevision: digest('profile'), effectiveConfigHash: digest('effective'), contextHash: digest('context'),
  workflowId: 'pr-review', mode: 'live', source: 'runner', piVersion: '0.85.1', toolPolicy: 'profile', ...overrides,
}; }
function assistant(extra = {}) { return { type: 'message_end', message: { role: 'assistant', provider: 'example', model: 'model', stopReason: 'stop',
  content: [{ type: 'text', text: 'PRIVATE_RESPONSE_SENTINEL' }], usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, cost: { total: .01 } }, ...extra,
} }; }

test('capture merges project configuration and exports no credentials or session files', t => {
  const dir = temp(t); const agent = join(dir, 'agent'); const project = join(dir, 'repo');
  put(join(agent, 'settings.json'), JSON.stringify({ defaultProvider: 'test', defaultModel: 'one', compaction: { enabled: false, keepRecentTokens: 50 }, trackingId: 'private-id', packages: ['npm:@team/review@1.0.0'] }));
  put(join(agent, 'auth.json'), 'PRIVATE_CREDENTIAL_SENTINEL'); put(join(agent, 'sessions', 'private.jsonl'), 'PRIVATE_SESSION_SENTINEL');
  put(join(agent, 'AGENTS.md'), 'Review cautiously.'); put(join(agent, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review code.\n---\nBe precise.');
  put(join(agent, 'extensions', 'example.ts'), 'export default function extension(pi) {}');
  put(join(agent, 'skills/review/scripts/check.sh'), '#!/bin/sh\nexit 0\n'); chmodSync(join(agent, 'skills/review/scripts/check.sh'), 0o755);
  put(join(project, '.pi', 'settings.json'), JSON.stringify({ defaultModel: 'two', compaction: { keepRecentTokens: 80 }, packages: ['npm:@team/review@2.0.0'] }));
  const profile = captureProfile({ name: 'mine', scope: 'work', agentDir: agent, project });
  assert.equal(profile.settings.defaultModel, 'two'); assert.deepEqual(profile.settings.compaction, { enabled: false, keepRecentTokens: 80 });
  assert(profile.omittedSettings.includes('trackingId')); assert.deepEqual(profile.resources.extensions, ['global/extensions/example.ts']);
  assert.deepEqual(profile.packages, ['npm:@team/review@2.0.0']);
  const serialized = JSON.stringify(profile); assert(!serialized.includes('PRIVATE_')); assert(!serialized.includes('private-id'));
  assert.equal(validateProfile(profile).revision, profile.revision);
  const store = new Store(join(dir, 'store'), 'work'); saveProfile(store, profile);
  assert.equal(getProfile(store, 'mine').revision, profile.revision);
  const secondDevice = new Store(join(dir, 'second'), 'work'); saveProfile(secondDevice, JSON.parse(serialized));
  const restored = getProfile(secondDevice, 'mine'); materializeProfile(restored, join(dir, 'restored'));
  assert.equal(readFileSync(join(dir, 'restored/global/AGENTS.md'), 'utf8'), 'Review cautiously.');
  assert(statSync(join(dir, 'restored/global/skills/review/scripts/check.sh')).mode & 0o100);
  assert(!existsSync(join(dir, 'restored/auth.json')));
});

test('Pi built-in extension overrides survive one-time setup capture', t => {
  const dir = temp(t); const agent = join(dir, 'agent'); const project = join(dir, 'repo');
  put(join(agent, 'settings.json'), JSON.stringify({
    defaultProvider: 'test', defaultModel: 'one',
    extensions: ['-builtin:mcp', '+builtin:codemode'],
  }));
  const global = captureProfile({ name: 'global', scope: 'work', agentDir: agent });
  assert.deepEqual(global.settings.extensions, ['+builtin:codemode', '-builtin:mcp']);
  assert.deepEqual(global.resources.extensions, []);
  assert.equal(validateProfile(global).revision, global.revision);
  put(join(project, '.pi', 'settings.json'), JSON.stringify({
    extensions: ['+builtin:mcp', '-builtin:tool-search'],
  }));
  const layered = captureProfile({ name: 'layered', scope: 'work', agentDir: agent, project });
  assert.deepEqual(layered.settings.extensions, ['+builtin:codemode', '+builtin:mcp', '-builtin:tool-search']);
  put(join(project, '.pi', 'settings.json'), JSON.stringify({
    extensions: ['-builtin:not-real'],
  }));
  assert.throws(() => captureProfile({ name: 'invalid', scope: 'work', agentDir: agent, project }), /Unknown Pi built-in extension/);
});

test('portable profiles reject unpinned packages, tampering, traversal, symlinks and embedded credentials', t => {
  const dir = temp(t); const good = exampleProfile('review', 'work', 'example/model');
  assert.throws(() => assertPinned('npm:some-package'), /exact npm version/);
  assert.doesNotThrow(() => assertPinned('npm:@org/tool@1.2.3'));
  assert.doesNotThrow(() => assertPinned(`git:github.com/org/tool@${'a'.repeat(40)}`));
  assert.throws(() => validateProfile({ ...good, name: 'changed' }), /revision/);
  const { revision, ...body } = good;
  assert.throws(() => sealProfile({ ...body, files: [{ ...body.files[0], path: '../../escape' }] }), /Unsafe/);
  assert.throws(() => sealProfile({ ...body, files: [...body.files, { ...body.files[0], path: body.files[0].path.toUpperCase() }] }), /colliding/);
  const secret = Buffer.from('sk-' + 'a'.repeat(30));
  assert.throws(() => sealProfile({ ...body, files: [{ path: 'AGENTS.md', data: secret.toString('base64'), sha256: digest(secret) }] }), /credential/);
  put(join(dir, 'agent/settings.json'), JSON.stringify({ defaultProvider: 'example', defaultModel: 'model' }));
  put(join(dir, 'outside.md'), 'private'); mkdirSync(join(dir, 'agent/skills'), { recursive: true });
  symlinkSync(join(dir, 'outside.md'), join(dir, 'agent/skills/link.md'));
  assert.throws(() => captureProfile({ name: 'bad', scope: 'work', agentDir: join(dir, 'agent') }), /Symlinks/);
});

test('collector discards raw event content and counts only successful skill reads as loaded', t => {
  const dir = temp(t); const skill = join(dir, 'review/SKILL.md'); put(skill, 'Review'); const hash = digest('Review');
  const c = new Collector(identity(), dir, [{ path: skill, name: 'review', hash }]);
  c.observe({ type: 'turn_start' });
  c.observe({ type: 'tool_execution_start', toolName: 'read', toolCallId: 'one', args: { path: skill, secret: 'PRIVATE_ARGS_SENTINEL' } });
  c.observe({ type: 'tool_execution_end', toolName: 'read', toolCallId: 'one', isError: true, result: 'PRIVATE_OUTPUT_SENTINEL' });
  assert.deepEqual(c.finish().skillsLoaded, []);
  c.observe({ type: 'tool_execution_start', toolName: 'read', toolCallId: 'two', args: { path: skill } });
  c.observe({ type: 'tool_execution_end', toolName: 'read', toolCallId: 'two', isError: false, result: 'PRIVATE_OUTPUT_SENTINEL' });
  const message = assistant(); c.observe(message, 'high'); c.observe(message, 'high');
  const record = c.finish(); assert.equal(record.turns, 1); assert.equal(record.models[0].calls, 1);
  assert.equal(record.models[0].estimatedCostUsd, .01); assert.equal(record.models[0].cacheReadTokens, 3);
  assert.deepEqual(record.skillsLoaded, [hash]); assert.equal(record.skillCatalog[0].name, 'review');
  assert.equal(record.tools[0].calls, 2); assert.equal(record.tools[0].errors, 1);
  const text = JSON.stringify(record); assert(!text.includes('PRIVATE_')); assert(!text.includes(dir)); assert(!text.includes('toolCallId'));
  assert.throws(() => metricsSchema.parse({ ...record, transcript: 'anything' }));
});

test('unknown cost stays unknown, and a successful retry can complete', () => {
  const c = new Collector(identity(), '.'); c.observe(assistant({ usage: undefined, stopReason: 'error' }));
  c.observe({ type: 'auto_retry_start' }); c.observe(assistant());
  const record = c.finish(); assert.equal(record.status, 'completed'); assert.equal(record.retries, 1);
  assert.equal(record.models[0].calls, 2); assert.equal(record.models[0].usageCalls, 1); assert.equal(record.models[0].estimatedCostUsd, null);
  assert.equal(c.finish('aborted').failureCode, 'aborted'); assert.equal(c.finish('timeout').failureCode, 'timeout');
});

test('analytics exchange validates every field and scope and detects conflicting duplicate IDs', t => {
  const dir = temp(t); const a = new Store(join(dir, 'a'), 'work'); const b = new Store(join(dir, 'b'), 'work');
  const record = new Collector(identity(), dir).finish(); a.writeMetrics(record); const file = join(dir, 'export.json');
  a.exportAnalytics(file); assert.equal(b.importAnalytics(file), 1); assert.equal(b.importAnalytics(file), 0);
  assert.throws(() => new Store(join(dir, 'private'), 'personal').importAnalytics(file), /mix/);
  const invalid = JSON.parse(readFileSync(file)); invalid.records[0].transcript = 'PRIVATE'; jsonWrite(join(dir, 'invalid.json'), invalid);
  assert.throws(() => b.importAnalytics(join(dir, 'invalid.json')));
  const conflict = JSON.parse(readFileSync(file)); conflict.records[0].turns++; jsonWrite(join(dir, 'conflict.json'), conflict);
  assert.throws(() => b.importAnalytics(join(dir, 'conflict.json')), /Conflicting/);
});

test('frozen context contains exact committed blobs, ignores uncommitted edits, and supports Git review', t => {
  const dir = temp(t); const repo = join(dir, 'repo'); mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  put(join(repo, 'code.js'), 'before'); put(join(repo, 'important.txt'), 'retained'); put(join(repo, '.gitattributes'), 'important.txt export-ignore\n');
  git('add', '.'); git('commit', '-qm', 'base'); put(join(repo, 'code.js'), 'after'); git('add', '.'); git('commit', '-qm', 'head');
  put(join(repo, 'code.js'), 'UNCOMMITTED'); put(join(repo, 'private.txt'), 'UNTRACKED');
  const packetDir = join(dir, 'packet'); const packet = freezeContext({ repo, base: 'HEAD~1', head: 'HEAD', out: packetDir });
  assert.equal(readFileSync(join(packetDir, 'repo/code.js'), 'utf8'), 'after');
  assert.equal(readFileSync(join(packetDir, 'repo/important.txt'), 'utf8'), 'retained'); assert(!existsSync(join(packetDir, 'repo/private.txt')));
  const clone = join(dir, 'run'); copyPacket(packetDir, clone); restoreReviewGit(clone, packet);
  assert.match(execFileSync('git', ['-C', join(clone, 'repo'), 'diff', 'base..HEAD'], { encoding: 'utf8' }), /after/);
  assert.equal(validatePacket(clone).contextHash, packet.contextHash);
  put(join(clone, 'repo/code.js'), 'changed'); assert.throws(() => validatePacket(clone), /changed/);
  assert.equal(validatePacket(packetDir).contextHash, packet.contextHash);
});
