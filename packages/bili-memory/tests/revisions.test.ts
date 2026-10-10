import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSqlite, MemoryDb } from '../src/extension.ts';
import { HybridMemory } from '../src/hybrid.ts';
import { sanitizeEmbeddingConfig } from '../src/embeddings.ts';
import { recordMessageProjects, recordBiliMessageProjects, projectScope, scopeAllowedIds } from '../src/project-scope.ts';

test('Billion Context v3 preserves attribution refs and rejects unknown versions without advancing watermarks', async () => {
  await loadSqlite();
  const dir = mkdtempSync(join(tmpdir(), 'memory-bili-contract-'));
  const file = join(dir, 'session.json');
  const store = new MemoryDb(join(dir, 'memory.sqlite')); store.open();
  const scope = projectScope(dir);
  const block = { blockId: 'b1', runId: 'r1', tier: 1, topic: 'fixture', summary: 'Bili contract fixture evidence',
    effectiveMessageIds: ['h_message_a', 'h_message_b'], startRef: 'm00002', endRef: 'm00003', createdAt: 1 };
  const envelope = { version: 3, id: 'session', payload: { version: 3, id: 'session', state: { blocks: [block] } } };
  const ingest = () => store.ingestSourceFile(file, { kind: 'bili', project: 'fixture' }, true);
  try {
    writeFileSync(file, JSON.stringify(envelope));
    assert.equal((await ingest()).inserted, 1);
    const first = store.db.prepare('SELECT * FROM blocks').get();
    assert.deepEqual(JSON.parse(first.msg_ids), block.effectiveMessageIds);
    assert.deepEqual(scopeAllowedIds(store.db, [first.id], scope, false), [], 'refs alone are not workspace evidence');
    recordMessageProjects(store.db, file, block.effectiveMessageIds, scope.id);
    await ingest();
    assert.deepEqual(scopeAllowedIds(store.db, [first.id], scope, false), [], 'stale raw IDs alone never prove a native revision');
    recordBiliMessageProjects(store.db, file, block.effectiveMessageIds.map(rawId => ({rawId, identityHash: 'a'.repeat(64), projectId: scope.id})), block.effectiveMessageIds.map(rawId => ({rawId, identityHash: 'a'.repeat(64)})));
    assert.deepEqual(scopeAllowedIds(store.db, [first.id], scope, false), [first.id]);
    const watermark = store.db.prepare('SELECT * FROM source_watermarks').get();
    for (const bad of [
      { ...envelope, version: 4 },
      { ...envelope, payload: { ...envelope.payload, version: 4 } },
      { ...envelope, payload: { ...envelope.payload, id: 'different' } },
      { ...envelope, id: '' },
    ]) {
      writeFileSync(file, JSON.stringify(bad));
      assert.equal((await ingest()).ok, false);
      assert.deepEqual(store.db.prepare('SELECT * FROM source_watermarks').get(), watermark);
      assert.equal(store.db.prepare('SELECT summary FROM blocks').get().summary, block.summary);
    }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('source revisions keep row identity, update FTS/metadata and invalidate only content vectors', async () => {
  await loadSqlite();
  const dir = mkdtempSync(join(tmpdir(), 'memory-revisions-'));
  const path = join(dir, 'db.sqlite');
  const source = join(dir, 'source.json');
  let store = new MemoryDb(path); store.open();
  let block = { blockId: 'b1', summary: 'oldneedle initial result', topic: 'oldtopic', messageIds: ['aaa11111'], startRef: 'm00001', endRef: 'm00002', tier: 1, createdAt: 1, compressedTokens: 10 };
  const save = () => writeFileSync(source, JSON.stringify({ version: 3, id: 'revision-fixture', payload: { version: 3, id: 'revision-fixture', state: { blocks: [block] } } }));
  const ingest = (force = true) => store.ingestSourceFile(source, { kind: 'bili', project: 'test' }, force);
  const config = sanitizeEmbeddingConfig({ enabled: true, dimensions: 2, baseUrl: 'https://example.invalid/v1' });
  const client = { embed: async (texts: string[]) => texts.map(() => [1, 0]) };
  let events = 0;
  store.onStored = (_rows, count) => { events += count; };
  try {
    save(); assert.equal((await ingest()).inserted, 1);
    const original = store.db.prepare('SELECT * FROM blocks').get();
    const hybrid = new HybridMemory(store, config, x => x, client as any);
    assert.equal((await hybrid.backfill()).stored, 1);
    block = { ...block, summary: 'newneedle corrected result', topic: 'newtopic', messageIds: ['bbb22222'], startRef: 'm00003', tier: 2, compressedTokens: 20 };
    save(); assert.equal((await ingest()).refreshed, 1);
    const revised = store.db.prepare('SELECT * FROM blocks').get();
    assert.equal(revised.id, original.id); assert.equal(revised.summary, block.summary);
    assert.equal(revised.topic, block.topic); assert.equal(revised.tier, 2);
    assert.equal(revised.compressed_tokens, 20); assert.equal(revised.ref_start, 'm00003');
    assert.deepEqual(JSON.parse(revised.msg_ids), ['bbb22222']);
    assert.equal(store.search('oldneedle').rows.length, 0); assert.equal(store.search('oldtopic').rows.length, 0);
    assert.equal(store.search('newneedle').rows.length, 1); assert.equal(store.search('newtopic').rows.length, 1);
    assert.equal(hybrid.status().indexed, 0); assert.equal((await hybrid.backfill()).stored, 1);
    block.messageIds = ['ccc33333']; save(); assert.equal((await ingest()).refreshed, 1);
    assert.equal(hybrid.status().indexed, 1); assert.equal((await hybrid.backfill()).uploaded, 0);
    assert.equal((await ingest()).refreshed, 0); assert.equal(events, 3);
    // Simulate an old install reopening before constructing HybridMemory.
    store.db.exec("DROP TRIGGER memory_vectors_update; DELETE FROM memory_migrations WHERE name='summary-revisions-v1'");
    store.close(); store = new MemoryDb(path); store.open();
    assert.equal(store.db.prepare('SELECT last_size FROM source_watermarks').get().last_size, 0);
    block.summary = 'migratedneedle new content'; save(); assert.equal((await ingest(false)).refreshed, 1);
    assert.equal(store.db.prepare('SELECT count(*) n FROM memory_vectors').get().n, 0);
    const watermark = store.db.prepare('SELECT last_size FROM source_watermarks').get().last_size;
    store.close(); store = new MemoryDb(path); store.open();
    assert.equal(store.db.prepare('SELECT last_size FROM source_watermarks').get().last_size, watermark);
    // Rollback must roll back indexes and must not notify observers.
    let rollbackEvents = 0;
    store.onStored = () => { rollbackEvents++; };
    store.db.exec("CREATE TRIGGER reject_revision BEFORE UPDATE ON blocks BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    block.summary = 'rollbackneedle'; save(); assert.equal((await ingest()).ok, false);
    assert.equal(rollbackEvents, 0);
    assert.equal(store.search('rollbackneedle').rows.length, 0); assert.equal(store.search('migratedneedle').rows.length, 1);
    store.db.exec('DROP TRIGGER reject_revision');
    store.prune(0); save(); assert.equal((await ingest()).inserted, 0);
    assert.equal(store.db.prepare('SELECT count(*) n FROM blocks').get().n, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
