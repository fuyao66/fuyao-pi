import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BiliProjectEvidence } from '../src/bili-project-evidence.js';
import type { BiliIdentity } from '../src/bili-identity.js';
const local = { id: 'local', stamp: 'local:0', label: 'local' };
const remote = { id: 'remote', stamp: 'remote:1', label: 'remote' };
function snapshot(ids: string[], sessionId = 'proxy'): BiliIdentity {
  return { conversationId: 'pi', sessionId, messages: ids.map((id, i) => ({ rawId: id, ref: `m${String(i).padStart(5, '0')}`, identityHash: id.repeat(64).slice(0, 64) })) };
}

test('proxy evidence leaves old history unknown and attributes only observed append-only intervals', () => {
  const e = new BiliProjectEvidence();
  assert.deepEqual(e.capture(snapshot(['a']), local), [{ rawId: 'a', identityHash: 'a'.repeat(64), projectId: null }]);
  assert.deepEqual(e.capture(snapshot(['a', 'b']), local), [{ rawId: 'b', identityHash: 'b'.repeat(64), projectId: 'local' }]);
  assert.deepEqual(e.capture(snapshot(['a', 'b']), local), []);
  e.observeScope(remote);
  e.observeScope(local); // Even a switch back before the next snapshot breaks continuity.
  assert.deepEqual(e.capture(snapshot(['a', 'b', 'c']), local), [{ rawId: 'c', identityHash: 'c'.repeat(64), projectId: null }]);
  assert.deepEqual(e.capture(snapshot(['a', 'b', 'c', 'd']), local), [{ rawId: 'd', identityHash: 'd'.repeat(64), projectId: 'local' }]);
});

test('missing snapshots, branch rewrites and proxy session changes never inherit project evidence', () => {
  const e = new BiliProjectEvidence();
  e.capture(snapshot([]), local);
  e.unavailable();
  assert.deepEqual(e.capture(snapshot(['a']), local), [{ rawId: 'a', identityHash: 'a'.repeat(64), projectId: null }]);
  assert.deepEqual(e.capture(snapshot(['b']), local), [{ rawId: 'b', identityHash: 'b'.repeat(64), projectId: null }]);
  assert.deepEqual(e.capture(snapshot(['a'], 'another'), local), [{ rawId: 'a', identityHash: 'a'.repeat(64), projectId: null }]);
  assert.deepEqual(e.capture(snapshot(['a', 'c'], 'another'), remote), [{ rawId: 'c', identityHash: 'c'.repeat(64), projectId: null }]);
  assert.deepEqual(e.capture(snapshot(['a', 'c', 'd'], 'another'), remote), [{ rawId: 'd', identityHash: 'd'.repeat(64), projectId: 'remote' }]);
});
