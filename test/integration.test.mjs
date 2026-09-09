import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDemo, startDemoProvider } from '../dist/demo.js';
import { Store } from '../dist/store.js';
import { getProfile, saveProfile, sealProfile } from '../dist/profiles.js';
import { runProfile } from '../dist/runner.js';
import { packFile } from '../dist/files.js';

test('real Pi SDK completes imported profiles, emits metadata only, and preserves context isolation', { timeout: 90_000 }, async t => {
  const out = mkdtempSync(join(tmpdir(), 'pi-share-e2e-')); t.after(() => rmSync(out, { recursive: true, force: true }));
  const result = await runDemo(out);
  assert.equal(result.records.length, 2); assert(result.records.every(r => r.status === 'completed'));
  assert.equal(result.records[0].contextHash, result.records[1].contextHash);
  assert.notEqual(result.records[0].profileRevision, result.records[1].profileRevision);
  assert.equal(result.records[0].tools.find(t => t.name === 'read').calls, 2);
  assert.equal(result.records[1].tools.find(t => t.name === 'read').calls, 3);
  assert.equal(result.records[0].skillsLoaded.length, 1); assert.equal(result.records[0].mode, 'demo');
  const exported = readFileSync(join(out, 'metadata.json'), 'utf8');
  assert(!exported.includes('whole number')); assert(!exported.includes('PR.diff')); assert(!exported.includes('discount.js'));
  assert(!exported.includes(out)); assert(!exported.includes('messages')); assert(!exported.includes('arguments'));
  const second = new Store(join(out, 'second-machine'), 'work'); const original = new Store(join(out, 'store'), 'work');
  const imported = saveProfile(second, JSON.parse(readFileSync(join(out, 'baseline.profile.json'))));
  assert.equal(second.importAnalytics(join(out, 'metadata.json')), 2);
  const provider = await startDemoProvider();
  try {
    const record = await runProfile({ store: second, profile: imported, packet: join(out, 'packet'), demoUrl: provider.url, authDir: join(out, 'empty-auth'), timeoutSeconds: 20 });
    assert.equal(record.status, 'completed'); assert.equal(record.profileRevision, result.records[0].profileRevision);
    const sameEndpoint = await runProfile({ store: original, profile: imported, packet: join(out, 'packet'), demoUrl: provider.url, authDir: join(out, 'empty-auth'), timeoutSeconds: 20 });
    assert.equal(record.effectiveConfigHash, sameEndpoint.effectiveConfigHash, 'same profile, model endpoint, and context should resolve to the same configuration on another path');
    assert.notEqual(record.deviceId, result.records[0].deviceId);
    const runDir = join(second.dir, 'runs', record.runId);
    assert.match(readFileSync(join(runDir, 'review.md'), 'utf8'), /Scripted demo/);
    assert(!existsSync(join(runDir, 'config/sessions')));
    assert(!readdirSync(runDir).some(f => /transcript|jsonl|trace/.test(f)));

    // Imported executable extensions really run, while ambient workspace extensions are never auto-loaded.
    const { revision, ...body } = getProfile(original, 'baseline');
    const custom = sealProfile({ ...body, name: 'with-extension', resources: { ...body.resources, extensions: ['extensions/probe.ts'] },
      files: [...body.files, packFile('extensions/probe.ts', Buffer.from("export default function(pi) { pi.on('before_agent_start', (e) => ({ systemPrompt: e.systemPrompt + '\\nTrace changed values through callers and callees.' })); }"))],
    });
    const customRun = await runProfile({ store: second, profile: custom, packet: join(out, 'packet'), demoUrl: provider.url, authDir: join(out, 'empty-auth'), timeoutSeconds: 20 });
    assert.equal(customRun.status, 'completed'); assert.equal(customRun.tools.find(t => t.name === 'read').calls, 3);

    const providerExtension = `export default function(pi) { pi.registerProvider('imported-provider', {
      baseUrl: ${JSON.stringify(provider.url)}, api: 'openai-completions', apiKey: 'demo',
      models: [{ id: 'fixture', name: 'Test', reasoning: false, input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }]
    }); }`;
    const customProvider = sealProfile({ ...body, name: 'with-provider', settings: { ...body.settings, defaultProvider: 'imported-provider' },
      resources: { ...body.resources, extensions: ['extensions/provider.ts'] },
      files: [...body.files, packFile('extensions/provider.ts', Buffer.from(providerExtension))],
    });
    const providerRun = await runProfile({ store: second, profile: customProvider, packet: join(out, 'packet'), demoUrl: provider.url, authDir: join(out, 'empty-auth'), timeoutSeconds: 20 });
    assert.equal(providerRun.status, 'completed'); assert.equal(providerRun.models[0].provider, 'imported-provider');
  } finally { await provider.close(); }
});

test('missing model is recorded as infrastructure failure without inventing a review', { timeout: 60_000 }, async t => {
  const out = mkdtempSync(join(tmpdir(), 'pi-share-failure-')); t.after(() => rmSync(out, { recursive: true, force: true }));
  const result = await runDemo(out); const store = new Store(join(out, 'store'), 'work');
  const profile = getProfile(store, 'baseline');
  const record = await runProfile({ store, profile, packet: join(out, 'packet'), modelOverride: 'nonexistent-provider/nonexistent-model', authDir: join(out, 'empty-auth'), timeoutSeconds: 5 });
  assert.equal(record.status, 'error'); assert.equal(record.failureCode, 'setup'); assert.equal(record.models.length, 0); assert.equal(record.outcome, null);
});
