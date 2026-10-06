import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureForTests, loadSqlite, getDb, listSourceFiles, buildSourcePolicy, formatResults } from '../src/extension.ts';
import { SourceCache } from '../src/source-cache.ts';
import { SourcePolicy } from '../src/source-policy.ts';
import { HybridMemory } from '../src/hybrid.ts';
import { sanitizeEmbeddingConfig } from '../src/embeddings.ts';
import { summarySnippet } from '../src/snippets.ts';

test('relative source prefixes cannot traverse root or follow symlink directories', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-path-'));
  try {
    const root = join(dir, 'root'), outside = join(dir, 'outside');
    mkdirSync(root); mkdirSync(outside); mkdirSync(join(root, 'real'));
    writeFileSync(join(outside, 'b.acp.json'), '{}'); writeFileSync(join(root, 'real', 'a.acp.json'), '{}');
    symlinkSync(outside, join(root, 'linked'), 'dir');
    symlinkSync(outside, join(dir, 'linked-root'), 'dir');
    const linkedRoot = await listSourceFiles({ id: 'test', root: join(dir, 'linked-root'), pattern: '*.acp.json' });
    assert.equal(linkedRoot.files.length, 0); assert.ok(linkedRoot.errors.length);
    const linkedCache = await new SourceCache().read('symlink', join(dir, 'linked-root', 'b.acp.json'),
      () => ({ state: 'loaded', blocks: new Map() }));
    assert.equal(linkedCache.state, 'missing/unreadable');
    for (const pattern of ['linked/*.acp.json', '../outside/*.acp.json', '/outside/*.acp.json']) {
      const result = await listSourceFiles({ id: 'test', root, pattern });
      assert.equal(result.files.length, 0); assert.ok(result.errors.length);
    }
    assert.equal((await listSourceFiles({ id: 'test', root, pattern: '**/*.acp.json' })).files.length, 1);
    assert.equal((await listSourceFiles({ id: 'test', root, pattern: 'real/*.acp.json' })).files.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('unknown sidecar schema never advances watermark or authorizes retained history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-schema-'));
  configureForTests({ dbPath: join(dir, 'db'), sourcesPath: join(dir, 'sources'), logPath: join(dir, 'log') });
  await loadSqlite(); const store = getDb(); store.open();
  try {
    const source = join(dir, 'a.acp.json');
    writeFileSync(join(dir, 'sources'), JSON.stringify({ id: 'fixture', root: dir, pattern: '*.acp.json', adapter: 'pi-sidecar', enabled: true }));
    const blocks = [{ blockId: 'b1', summary: 'legacy needle' }];
    writeFileSync(source, JSON.stringify({ blocks }));
    assert.equal((await store.ingestSourceFile(source, { kind: 'pi' }, true)).inserted, 1);
    const old = store.db.prepare('SELECT * FROM source_watermarks').get();
    writeFileSync(source, JSON.stringify({ schemaVersion: 2, blocks }));
    assert.equal((await store.ingestSourceFile(source, { kind: 'pi' }, true)).ok, false);
    assert.deepEqual(store.db.prepare('SELECT * FROM source_watermarks').get(), old);
    assert.equal((await buildSourcePolicy()).allowedIds.length, 0);
    writeFileSync(source, JSON.stringify({ schemaVersion: 1, blocks }));
    assert.equal((await store.ingestSourceFile(source, { kind: 'pi' }, true)).ok, true);
    assert.equal((await buildSourcePolicy()).allowedIds.length, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('parsed source cache refreshes atomic replacements and missing files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-cache-'));
  try {
    const file = join(dir, 'source'); writeFileSync(file, '{}');
    const cache = new SourceCache(); let parses = 0;
    const parse = () => { parses++; return { state: 'loaded' as const, blocks: new Map() }; };
    await cache.read('s', file, parse); await cache.read('s', file, parse); assert.equal(parses, 1);
    writeFileSync(file + '.tmp', '{}'); renameSync(file + '.tmp', file);
    await cache.read('s', file, parse); assert.equal(parses, 2);
    rmSync(file); assert.equal((await cache.read('s', file, parse)).state, 'missing/unreadable');
    writeFileSync(file, '{}'); await cache.read('s', file, parse); assert.equal(parses, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('matched evidence near summary tail reaches bounded result, unicode remains intact', () => {
  const summary = 'unrelated '.repeat(200) + '最终决定：方案甲不能用，因为成本高。';
  const snippet = summarySnippet(summary, '方案甲');
  assert.ok(snippet.includes('因为成本高')); assert.ok(snippet.startsWith('…')); assert.ok(snippet.length <= 602);
  assert.ok(formatResults({ mode: 'fts', rows: [{ summary, blockId: 'b1' }] }, '方案甲').includes('因为成本高'));
  assert.ok(!summarySnippet('😀'.repeat(700) + 'needle', 'needle').includes('\ufffd'));
});

test('query upload requires scoped valid vectors, coverage reflects authorized window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-gate-'));
  configureForTests({ dbPath: join(dir, 'db'), logPath: join(dir, 'log') }); await loadSqlite();
  const store = getDb(); store.open();
  try {
    const file = join(dir, 'a.acp.json'); writeFileSync(file, JSON.stringify({ blocks: [1, 2, 3].map(i => ({ blockId: 'b' + i, summary: 'sharedneedle ' + i })) }));
    await store.ingestSourceFile(file, { kind: 'pi', project: 'fixture' }, true);
    const rows = store.db.prepare('SELECT id,source_file AS sourceFile,kind,block_id AS blockId,summary,topic,msg_ids AS msgIds,ref_start AS refStart,ref_end AS refEnd FROM blocks').all();
    const config = sanitizeEmbeddingConfig({ enabled: true, dimensions: 2, baseUrl: 'https://example.invalid/v1', maxBlocks: 2 });
    let calls = 0; const client = { embed: async (inputs: string[]) => { calls++; return inputs.map(() => [1, 0]); } };
    const hybrid = new HybridMemory(store, config, x => x, client as any);
    await hybrid.backfill(20); calls = 0;
    for (const ids of [[], [rows[2].id]]) {
      const output = await hybrid.search('sharedneedle', { allowedIds: ids, authorizedRows: rows });
      assert.equal(output.mode, 'lexical-fallback'); assert.equal(calls, 0);
    }
    const output = await hybrid.search('sharedneedle', { allowedIds: rows.map(r => r.id), authorizedRows: rows });
    assert.equal(calls, 1); assert.deepEqual(output.coverage, { total: 3, scanned: 2, indexed: 2, pending: 0, unscanned: 1, truncated: 0, capped: true });
    store.db.exec('UPDATE memory_vectors SET vector=zeroblob(8)'); calls = 0;
    await hybrid.search('sharedneedle', { allowedIds: rows.map(r => r.id), authorizedRows: rows }); assert.equal(calls, 0);
    // Revoke scope in the pre-dispatch refresh, even when callers pass an older snapshot.
    await hybrid.backfill(20); calls = 0;
    const revoked = await hybrid.search('sharedneedle', { allowedIds: rows.map(r => r.id), authorizedRows: rows,
      refreshPolicy: async () => ({ allowedIds: [], authorizedRows: [] }) });
    assert.equal(calls, 0); assert.equal(revoked.rows.length, 0);
    assert.equal(revoked.coverage?.total, 0);
    hybrid.abort();
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('indexed policy preserves revision validation before limit and FTS-driven plan at 1000 rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-performance-'));
  configureForTests({ dbPath: join(dir, 'db'), logPath: join(dir, 'log') }); await loadSqlite(); const store = getDb(); store.open();
  try {
    const file = join(dir, 'a.acp.json'); writeFileSync(file, JSON.stringify({ blocks: Array.from({ length: 1000 }, (_, i) => ({ blockId: 'b' + i, summary: 'sharedneedle synthetic record ' + i })) }));
    await store.ingestSourceFile(file, { kind: 'pi' }, true);
    const rows = store.db.prepare('SELECT id,source_file AS sourceFile,kind,block_id AS blockId,summary,topic,msg_ids AS msgIds,ref_start AS refStart,ref_end AS refEnd FROM blocks').all();
    const policy = new SourcePolicy(rows, new Map([[JSON.stringify([file, 'pi']), { state: 'loaded', blocks: new Map(rows.map(r => [r.blockId, r])) }]]));
    const opts = { allowedIds: policy.allowedIds, authorizedRows: policy.authorizedRows, limit: 6 };
    const plan = store.explainSearch('sharedneedle', opts).map(r => r.detail).join('\n');
    assert.match(plan, /VIRTUAL TABLE INDEX/); assert.match(plan, /SEARCH policy (?:EXISTS )?USING INTEGER PRIMARY KEY/); assert.ok(!plan.includes('json_each'));
    const start = performance.now(); assert.equal(store.search('sharedneedle', opts).rows.length, 6);
    console.log(`indexed authorized FTS 1000 rows: ${Math.round(performance.now() - start)} ms`);
    const hybrid = new HybridMemory(store, sanitizeEmbeddingConfig({ enabled: true, dimensions: 2,
      baseUrl: 'https://example.invalid/v1' }), x => x,
      { embed: async (inputs: string[]) => inputs.map(() => [1, 0]) } as any);
    // No vectors and permission withdrawal during the gate yield must fail closed.
    let refreshes = 0;
    const withdrawn = await hybrid.search('sharedneedle', { ...opts, refreshPolicy: async () =>
      ++refreshes === 1 ? { allowedIds: policy.allowedIds, authorizedRows: policy.authorizedRows }
        : { allowedIds: [], authorizedRows: [] } });
    assert.equal(refreshes, 2); assert.equal(withdrawn.rows.length, 0); assert.equal(withdrawn.coverage?.total, 0);
    await hybrid.backfill(100);
    // Search yields while scoring; a second synchronous policy query must not fail to
    // drop its TEMP relation, and it must not count TEMP inserts as a store mutation.
    const search = hybrid.search('sharedneedle', opts);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(store.search('sharedneedle', opts).rows.length, 6);
    const searched = await search;
    assert.equal(searched.mode, 'hybrid'); assert.equal(searched.coverage?.total, 1000);
    assert.equal(store.db.prepare("SELECT count(*) n FROM sqlite_temp_master WHERE name LIKE 'memory_policy_%'").get()!.n, 0);
    hybrid.abort();
    store.db.prepare('UPDATE blocks SET summary=? WHERE id=?').run('sharedneedle changed', rows[0].id);
    assert.ok(!store.search('sharedneedle', { ...opts, limit: 20 }).rows.some(r => r.id === rows[0].id));
    assert.equal(store.db.prepare("SELECT count(*) n FROM sqlite_temp_master WHERE name LIKE 'memory_policy_%'").get()!.n, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
