// Opt-in synthetic benchmark. No production files/config, provider calls or rebuilds.
// Run: node --import tsx scripts/benchmark-bili-memory.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { BiliSessionLocator } from '../packages/bili-memory/src/bili-identity.ts';
import { readSourceFile } from '../packages/bili-memory/src/source-files.ts';
import { MemoryDb, loadSqlite, configureForTests } from '../packages/bili-memory/src/extension.ts';
import { HybridMemory } from '../packages/bili-memory/src/hybrid.ts';
import { sanitizeEmbeddingConfig, prepareText, encodeVector } from '../packages/bili-memory/src/embeddings.ts';

process.env.FUYAO_MEMORY_EMBEDDING_DISABLED = '1';
const root = mkdtempSync(join(tmpdir(), 'bm-native-benchmark-'));
const rounded = n => Math.round(n * 10) / 10;
const report = { synthetic: true, externalCalls: 0, node: process.version };
let store;
try {
  // Same corpus shape as the architecture review, but a persistent locator now
  // validates unchanged file metadata without rereading multi-MiB raw histories.
  let reads = 0, bytes = 0;
  const locator = new BiliSessionLocator(128, 32 * 1024 * 1024, 128 * 1024 * 1024, async (file, max) => {
    const result = await readSourceFile(file, max); reads++; bytes += Buffer.byteLength(result.body); return result;
  });
  const files = Array.from({ length: 33 }, (_, i) => join(root, `session-${i}.json`));
  files.forEach((file, i) => writeFileSync(file, JSON.stringify({ version: 3, id: `s${i}`, payload: { version: 3, id: `s${i}`, state: { blocks: [] }, rawFixture: 'x'.repeat(2 * 1024 * 1024) } })));
  let start = performance.now();
  assert.equal((await locator.locate({ files, complete: true }, 's0')).file, files[0]);
  const coldMs = performance.now() - start, coldBytes = bytes, coldReads = reads;
  start = performance.now();
  for (let i = 0; i < 3; i++) assert.ok(await locator.locate({ files, complete: true }, 's0'));
  assert.equal(reads, coldReads); assert.equal(bytes, coldBytes);
  report.locator = { files: 33, coldBytes, coldMs: rounded(coldMs), threeHotMs: rounded(performance.now() - start), hotReadBytes: bytes - coldBytes };

  configureForTests({ logPath: join(root, 'memory.log') }); await loadSqlite();
  store = new MemoryDb(join(root, 'index.sqlite')); store.open();
  store.db.exec("INSERT INTO sources(source_file,kind,project) VALUES('synthetic','bili','fixture');");
  const add = store.db.prepare("INSERT INTO blocks(source_file,kind,block_id,summary,topic) VALUES('synthetic','bili',?,?,'fixture')");
  store.db.exec('BEGIN');
  for (let i = 0; i < 1000; i++) add.run(`b${i}`, `keyword project evidence group-${Math.floor(i / 2)}. ` + 'bounded synthetic history '.repeat(30));
  store.db.exec('COMMIT');
  const policyRows = () => store.db.prepare(`SELECT id,source_file AS sourceFile,kind,block_id AS blockId,summary,topic,msg_ids AS msgIds,ref_start AS refStart,ref_end AS refEnd FROM blocks`).all();
  const allowed = policyRows(), ids = allowed.map(row => row.id);
  const timings = [];
  for (let i = 0; i < 5; i++) {
    start = performance.now(); const hit = store.search('keyword', { allowedIds: ids, authorizedRows: allowed, limit: 20 });
    timings.push(performance.now() - start); assert.equal(hit.rows.length, 20);
    assert.equal(new Set(hit.rows.map(row => row.summary)).size, 20);
  }
  report.authorizedLexical = { rows: 1000, repeatedMs: timings.map(rounded), medianMs: rounded([...timings].sort((a,b) => a-b)[2]), includesIndexedAuthorizationAndDedup: true };
  store.close();

  store = new MemoryDb(join(root, 'vectors.sqlite')); store.open();
  store.db.exec("INSERT INTO sources(source_file,kind,project) VALUES('synthetic','bili','fixture');");
  const config = sanitizeEmbeddingConfig({ enabled: true, baseUrl: 'https://example.invalid/v1', dimensions: 3072, maxBlocks: 10000 });
  let mockCalls = 0;
  const query = Array.from({ length: 3072 }, (_, i) => i === 0 ? 1 : 0);
  const worker = new HybridMemory(store, config, x => x, { embed: async xs => { mockCalls++; return xs.map(() => query); } });
  const addBlock = store.db.prepare("INSERT INTO blocks(source_file,kind,block_id,summary,topic) VALUES('synthetic','bili',?,?,'fixture')");
  const addVector = store.db.prepare('INSERT INTO memory_vectors VALUES(?,?,?,?,?,0)');
  const vector = encodeVector(query);
  store.db.exec('BEGIN');
  for (let i = 0; i < 10000; i++) {
    const summary = `Synthetic semantic evidence ${i}: no keyword match for the probe.`;
    const id = Number(addBlock.run(`b${i}`, summary).lastInsertRowid);
    addVector.run(id, worker.ns, prepareText(`fixture\n${summary}`, config, x => x).hash, 3072, vector);
  }
  store.db.exec('COMMIT');
  const rows = policyRows(), allIds = rows.map(row => row.id);
  let ticks = 0; const timer = setInterval(() => ticks++, 0);
  const rssBefore = process.memoryUsage().rss;
  start = performance.now();
  const pending = worker.search('concept-not-in-source', { refreshPolicy: async () => ({ allowedIds: allIds, authorizedRows: rows }) });
  const beforeFirstAwaitMs = performance.now() - start;
  const hit = await pending; clearInterval(timer);
  const totalMs = performance.now() - start;
  assert.equal(hit.mode, 'hybrid'); assert.equal(hit.coverage.indexed, 10000); assert.equal(mockCalls, 1); assert.equal(hit.rows.length, 6);
  report.semantic = { rows: 10000, dimensions: 3072, totalMs: rounded(totalMs), beforeFirstAwaitMs: rounded(beforeFirstAwaitMs), rssGrowthMiB: rounded((process.memoryUsage().rss - rssBefore) / 1024 / 1024), timerTicks: ticks, includesPolicyRefreshAndFinalValidation: true };
  start = performance.now(); worker.status();
  report.synchronousManagementStatusMs = rounded(performance.now() - start);
  console.log(JSON.stringify(report, null, 2));
} finally { store?.close(); rmSync(root, { recursive: true, force: true }); }
