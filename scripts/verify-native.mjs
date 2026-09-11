// Optional local smoke check. Installed CLIs talk only to a scripted loopback model.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { stringify } from 'smol-toml';
import { Store } from '../dist/store.js';
import { captureSetup } from '../dist/setups.js';
import { NativeTelemetry, serveTelemetry } from '../dist/telemetry.js';

const harness = process.argv[2];
if (!['codex', 'claude-code'].includes(harness)) throw new Error('Usage: node scripts/verify-native.mjs codex|claude-code');
const root = mkdtempSync(join(tmpdir(), 'pi-share-native-smoke-')); const config = join(root, 'config'); const project = join(root, 'project'); mkdirSync(config); mkdirSync(project);
const requests = [];
const model = createServer(async (req, res) => {
  requests.push(req.url); for await (const chunk of req) { /* Discard the locally generated request. */ }
  const reply = harness === 'codex' ? {
    id: 'resp_local_fixture', object: 'response', created_at: Math.floor(Date.now()/1000), model: 'gpt-5.5', status: 'completed',
    output: [{ id: 'msg_local_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }],
    usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  } : { id: 'msg_local_fixture', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 12, output_tokens: 2 } };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const emit = (type, body) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
  if (harness === 'codex') {
    emit('response.created', { response: { ...reply, status: 'in_progress', output: [] } });
    emit('response.output_item.added', { output_index: 0, item: { ...reply.output[0], status: 'in_progress', content: [] } });
    emit('response.content_part.added', { item_id: reply.output[0].id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    emit('response.output_text.delta', { item_id: reply.output[0].id, output_index: 0, content_index: 0, delta: 'OK' });
    emit('response.output_item.done', { output_index: 0, item: reply.output[0] }); emit('response.completed', { response: reply });
  } else {
    emit('message_start', { message: { ...reply, content: [], stop_reason: null } });
    emit('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }); emit('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK' } }); emit('content_block_stop', { index: 0 });
    emit('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } }); emit('message_stop', {});
  }
  res.end();
});
model.listen(0, '127.0.0.1'); await once(model, 'listening'); const modelUrl = `http://127.0.0.1:${model.address().port}`;
writeFileSync(join(config, harness === 'codex' ? 'config.toml' : 'settings.json'), harness === 'codex' ? 'model="gpt-5.5"\n' : '{"model":"claude-sonnet-4-6"}');
const setup = captureSetup({ name: 'local-smoke', scope: 'work', harness, agentDir: config, version: 'fixture' });
const collector = new NativeTelemetry(setup, new Store(join(root, 'store'), 'work')); const fields = new Set(); const originalConsume = collector.consume.bind(collector);
collector.consume = raw => { for (const r of raw.resourceLogs ?? []) for (const s of r.scopeLogs ?? []) for (const l of s.logRecords ?? []) for (const a of l.attributes ?? []) fields.add(a.key); return originalConsume(raw); };
const telemetry = await serveTelemetry(collector);
const env = { ...process.env, CODEX_HOME: config, CLAUDE_CONFIG_DIR: config, OPENAI_API_KEY: 'local-fixture-only', ANTHROPIC_API_KEY: 'local-fixture-only', ANTHROPIC_AUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_BASE_URL: modelUrl,
  CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'none', OTEL_TRACES_EXPORTER: 'none', OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json', OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: telemetry.endpoint, OTEL_EXPORTER_OTLP_LOGS_HEADERS: `Authorization=Bearer ${telemetry.token}`, OTEL_LOG_USER_PROMPTS: '0', OTEL_LOG_TOOL_DETAILS: '0', OTEL_LOG_RAW_API_BODIES: '0', OTEL_LOG_ASSISTANT_RESPONSES: '0', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_SIMPLE: '1', DISABLE_AUTOUPDATER: '1' };
let args;
if (harness === 'codex') {
  writeFileSync(join(config, 'config.toml'), stringify({ model: 'gpt-5.5', model_provider: 'fixture', check_for_update_on_startup: false, analytics: { enabled: false }, features: { remote_plugin: false },
    model_providers: { fixture: { name: 'Local fixture', base_url: `${modelUrl}/v1`, wire_api: 'responses', requires_openai_auth: false } },
    otel: { log_user_prompt: false, trace_exporter: 'none', exporter: { 'otlp-http': { endpoint: telemetry.endpoint, protocol: 'json', headers: { Authorization: `Bearer ${telemetry.token}` } } } } }));
  args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', 'Reply OK.'];
} else args = ['--bare', '-p', '--model', 'claude-sonnet-4-6', 'Reply OK.'];
try {
  const child = spawn(harness === 'codex' ? 'codex' : 'claude', args, { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] }); let error = ''; child.stderr.on('data', d => { error = (error + d).slice(-5000); }); child.stdout.resume();
  const timer = setTimeout(() => child.kill('SIGKILL'), 25000); const [code] = await once(child, 'exit'); clearTimeout(timer);
  const records = collector.records(); console.log(JSON.stringify({ harness, exitCode: code, requests, records: records.map(r => ({ harness: r.harness, coverage: r.coverage, models: r.models, turns: r.turns })), observedFieldNames: [...fields].sort(), ...(code !== 0 ? { error } : {}) }, null, 2));
  const usage = records.flatMap(r => r.models);
  if (code !== 0 || usage.length !== 1 || usage[0].calls !== 1 || usage[0].usageCalls !== 1 || usage[0].inputTokens !== 12 || usage[0].outputTokens !== 2) process.exitCode = 1;
} finally { await telemetry.close(); model.close(); model.closeAllConnections(); rmSync(root, { recursive: true, force: true }); }
