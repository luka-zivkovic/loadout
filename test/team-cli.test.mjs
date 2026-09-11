import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry, serveRegistry } from '../dist/registry.js';

test('CLI onboards two devices, publishes and installs a team setup, and syncs without exposing credentials', { timeout: 30_000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'pi-share-cli-')); const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const execute = async (...args) => (await promisify(execFile)(process.execPath, [cli, ...args], { timeout: 20_000 })).stdout;
  let registry; let serving;
  try {
    const data = join(out, 'registry'); const aliceCredential = join(out, 'alice.credential.json'); const bobCredential = join(out, 'bob.credential.json');
    const init = await execute('registry', 'init', '--data', data, '--team', 'engineering', '--scope', 'work', '--member', 'alice', '--token-out', aliceCredential);
    const credential = JSON.parse(readFileSync(aliceCredential)); assert(!init.includes(credential.token));
    await execute('registry', 'grant', '--data', data, '--member', 'bob', '--token-out', bobCredential);
    registry = new Registry(data); serving = await serveRegistry(registry, { port: 0 }); const url = `http://127.0.0.1:${serving.port}`;
    const alice = ['--home', join(out, 'alice'), '--scope', 'work']; const bob = ['--home', join(out, 'bob'), '--scope', 'work'];
    await execute('team', 'connect', 'engineering', '--url', url, '--token-file', aliceCredential, ...alice);
    await execute('team', 'connect', 'engineering', '--url', url, '--token-file', bobCredential, ...bob);
    await execute('profile', 'init', 'review', '--model', 'fixture/local', ...alice);
    assert.match(await execute('team', 'publish', 'engineering', 'review', ...alice), /Published/);
    const profiles = JSON.parse(await execute('team', 'profiles', 'engineering', ...bob)); assert.equal(profiles[0].owner, 'alice');
    assert.match(await execute('team', 'pull', 'engineering', 'alice/review', ...bob), /alice--review/);
    const local = JSON.parse(await execute('profile', 'list', ...bob)); assert.equal(local[0].localName, 'alice--review');
    const synced = JSON.parse(await execute('team', 'sync', 'engineering', ...bob)); assert.equal(synced.cursor, 1);
    const status = await execute('team', 'status', 'engineering', ...alice); assert(!status.includes(credential.token));
    const members = JSON.parse(await execute('registry', 'members', '--data', data)); assert.equal(members.length, 2);
    await execute('registry', 'revoke', credential.tokenId, '--data', data);
    await assert.rejects(() => execute('team', 'status', 'engineering', ...alice), /expired, revoked, or invalid/);
  } finally { if (serving) await serving.close(); registry?.close(); rmSync(out, { recursive: true, force: true }); }
});
