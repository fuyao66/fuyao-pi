import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSqlite, MemoryDb } from '../src/extension.ts';
import { HybridMemory } from '../src/hybrid.ts';
import { sanitizeEmbeddingConfig } from '../src/embeddings.ts';

test('source revisions keep row identity, update FTS/metadata and invalidate only content vectors', async () => {
  await loadSqlite();
  const dir = mkdtempSync(join(tmpdir(), 'memory-revisions-'));
  const path = join(dir, 'db.sqlite');
  const source = join(dir, 'source.acp.json');
  let store = new MemoryDb(path); store.open();
  let block = { blockId: 'b1', summary: 'oldneedle initial result', topic: 'oldtopic', messageIds: ['aaa11111'], startRef: 'm00001', endRef: 'm00002', tier: 1, createdAt: 1, compressedTokens: 10 };
  const save = () => writeFileSync(source, JSON.stringify({ blocks: [block] }));
  const ingest = (force = true) => store.ingestSourceFile(source, { kind: 'pi', project: 'test' }, force);
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
