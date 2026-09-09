import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import extension from '../dist/extension.js';
import { startDemoProvider } from '../dist/demo.js';
import { Store } from '../dist/store.js';

test('opt-in extension records real Pi lifecycle activity without exporting interactive content', { timeout: 30_000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'pi-share-extension-'));
  const agentDir = join(out, 'agent'); const cwd = join(out, 'workspace'); const home = join(out, 'store');
  const env = { PI_SHARE_HOME: home, PI_SHARE_SCOPE: 'work', PI_SHARE_ACTOR: 'test-actor', PI_SHARE_PROFILE: 'daily', PI_CODING_AGENT_DIR: agentDir, PI_SHARE_DISABLED: '0' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const settings = { defaultProvider: 'extension-test', defaultModel: 'fixture', defaultThinkingLevel: 'off', defaultTools: ['read'], enableAnalytics: false, enableInstallTelemetry: false };
  mkdirSync(join(agentDir, 'skills/review'), { recursive: true }); mkdirSync(join(cwd, 'repo'), { recursive: true });
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(settings));
  writeFileSync(join(agentDir, 'skills/review/SKILL.md'), '---\nname: review\ndescription: Review code.\n---\nInspect the change.');
  writeFileSync(join(cwd, 'PR.diff'), 'PRIVATE_DIFF_SENTINEL'); writeFileSync(join(cwd, 'repo/discount.js'), 'PRIVATE_CODE_SENTINEL');
  const provider = await startDemoProvider(); let session;
  try {
    const settingsManager = SettingsManager.inMemory(settings);
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
      additionalSkillPaths: [join(agentDir, 'skills')], extensionFactories: [{ name: 'pi-share', factory: extension }],
    });
    await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), modelsStorePath: join(agentDir, 'cache.json'), refreshOnCreate: false });
    modelRuntime.registerProvider('extension-test', { baseUrl: provider.url, api: 'openai-completions', apiKey: 'demo',
      models: [{ id: 'fixture', name: 'Test fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048 }],
    });
    ({ session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, modelRuntime,
      model: modelRuntime.getModel('extension-test', 'fixture'), thinkingLevel: 'off', sessionManager: SessionManager.inMemory(cwd),
    }));
    await session.bindExtensions({ mode: 'print' });
    const store = new Store(home, 'work');
    await session.prompt('/share-stop'); assert.equal(store.records().length, 0);
    await session.prompt('/share-start pr-review');
    await session.prompt('/skill:review PRIVATE_INTERACTIVE_SENTINEL');
    assert.equal(store.records().length, 0, 'measurement should stay in memory until explicitly stopped');
    await session.prompt('/share-stop');
    const [record] = store.records();
    assert(record, 'the extension should save a workflow record');
    assert.equal(record.source, 'extension'); assert.equal(record.status, 'completed'); assert.equal(record.actorId, 'test-actor');
    assert.equal(record.workflowId, 'pr-review'); assert.equal(record.tools[0].calls, 2); assert.equal(record.turns, 3);
    assert.equal(record.skillsLoaded.length, 1); assert.equal(record.models[0].usageCalls, 3);
    const exportPath = join(out, 'metadata.json'); store.exportAnalytics(exportPath);
    const serialized = readFileSync(exportPath, 'utf8');
    assert(!serialized.includes('PRIVATE_')); assert(!serialized.includes('PR.diff')); assert(!serialized.includes(out));
    await session.prompt('UNMEASURED_INTERACTIVE_SENTINEL');
    assert.deepEqual(store.records(), [record], 'activity after stopping must not change the saved workflow');
    assert(!existsSync(join(agentDir, 'sessions')));
  } finally {
    session?.dispose(); await provider.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(out, { recursive: true, force: true });
  }
});
