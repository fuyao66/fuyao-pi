import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBiliIdentity, findBiliSessionFile } from '../src/bili-identity.js';

const message = { rawId: 'h_one', ref: 'm00001', identityHash: 'a'.repeat(64) };
const snapshot = { ok: true, protocolVersion: 1, status: 'exact', conversationId: 'pi-session', sessionId: 'proxy-session', orderedMessages: [message] };

test('proxy identity requires exact conversation and unique bidirectional references', () => {
  assert.equal(parseBiliIdentity(snapshot, 'pi-session')?.sessionId, 'proxy-session');
  for (const bad of [ { ...snapshot, status: 'estimated' }, { ...snapshot, protocolVersion: 2 },
    { ...snapshot, conversationId: 'another-session' }, { ...snapshot, orderedMessages: [message, message] },
    { ...snapshot, orderedMessages: [{ ...message, identityHash: 'invalid' }] } ]) {
    assert.equal(parseBiliIdentity(bad, 'pi-session'), null);
  }
  assert.equal(parseBiliIdentity(snapshot, ''), null);
});

test('persistence identity resolves only an unambiguous allow-listed v3 file, never filename or cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-identity-'));
  const a = join(dir, 'first.json'), b = join(dir, 'second.json'), link = join(dir, 'linked.json');
  const doc = { version: 3, id: 'proxy-session', payload: { version: 3, id: 'proxy-session', state: { blocks: [] } } };
  try {
    await writeFile(a, JSON.stringify(doc));
    await writeFile(b, JSON.stringify({ ...doc, version: 4 }));
    assert.equal(await findBiliSessionFile([a, b], 'proxy-session'), a);
    assert.equal(await findBiliSessionFile([a, a], 'proxy-session'), a);
    assert.equal(await findBiliSessionFile([b], 'proxy-session'), null);
    assert.equal(await findBiliSessionFile([a], 'pi-session'), null);
    await symlink(a, link);
    assert.equal(await findBiliSessionFile([link], 'proxy-session'), null);
    await writeFile(b, JSON.stringify(doc));
    assert.equal(await findBiliSessionFile([a, b], 'proxy-session'), null);
    await writeFile(a, 'invalid');
    assert.equal(await findBiliSessionFile([a], 'proxy-session'), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
