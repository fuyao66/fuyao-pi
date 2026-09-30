import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HybridMemory, fuse } from "../src/hybrid.ts";
import { EmbeddingClient, sanitizeEmbeddingConfig, namespace, prepareText, encodeVector, decodeVector } from "../src/embeddings.ts";
import { formatResults, redactSecrets, withoutPaths } from "../src/extension.ts";

const config = sanitizeEmbeddingConfig({ enabled: true, baseUrl: "https://example.invalid/v1", dimensions: 2, minSimilarity: 0.2 });
const redact = (text: string) => withoutPaths(redactSecrets(text).text);
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE sources(source_file TEXT PRIMARY KEY, project TEXT, cwd TEXT);
    CREATE TABLE blocks(id INTEGER PRIMARY KEY AUTOINCREMENT,source_file TEXT,kind TEXT,block_id TEXT,tier INTEGER,topic TEXT,ref_start TEXT,ref_end TEXT,compressed_tokens INTEGER,created_at INTEGER,summary TEXT);
    INSERT INTO sources VALUES('a','ProjA','/home/dev/ProjA'),('b','ProjB','/home/dev/ProjB');
    INSERT INTO blocks(source_file,kind,block_id,summary) VALUES
    ('a','pi','b1','Advisor snapshots preserve compressed context'),('a','pi','b2','terminal theme appearance'),('b','pi','b1','Remote shell tools');`);
  const store = { db, closed: false, search(query: string, opts: any = {}) {
    return { mode: "fts", rows: db.prepare(`SELECT b.id, b.source_file AS sourceFile, b.block_id AS blockId, b.topic, b.summary, s.project FROM blocks b JOIN sources s ON s.source_file=b.source_file WHERE b.summary LIKE ? ${opts.project ? "AND s.project=?" : ""} ORDER BY b.id`).all(`%${query}%`, ...(opts.project ? [opts.project] : [])) };
  }};
  const sent: string[][] = [];
  const client = { async embed(input: string[]) { sent.push(input); return input.map(text => text.includes("theme") ? [0, 1] : [1, 0]); } };
  const hybrid = new HybridMemory(store, config, redact, client as any);
  return { store, hybrid, sent, close: () => { store.closed = true; db.close(); } };
}

test("semantic-only retrieval, lexical exact matches, project filters and incremental backfill", async () => {
  const f = fixture();
  try {
    assert.equal((await f.hybrid.search("different wording")).mode, "lexical-fallback");
    assert.equal(f.sent.length, 0, "no vectors means no outbound query");
    assert.equal((await f.hybrid.backfill(1)).stored, 1);
    assert.equal(f.hybrid.status().indexed, 1);
    assert.equal((await f.hybrid.backfill(10)).stored, 2);
    assert.equal((await f.hybrid.backfill()).uploaded, 0);
    const semantic = await f.hybrid.search("different wording", { project: "ProjA" });
    assert.equal(semantic.mode, "hybrid");
    assert.equal(semantic.rows[0].blockId, "b1");
    assert.ok(semantic.rows.every(row => row.project === "ProjA"));
    assert.equal((await f.hybrid.search("theme", { project: "ProjA" })).rows[0].blockId, "b2");
    assert.equal((await f.hybrid.search("Remote", { project: "ProjB" })).rows[0].project, "ProjB");
    const changed = new HybridMemory(f.store, { ...config, model: "other" }, redact, { embed() { throw new Error("must not call"); } } as any);
    assert.equal(changed.status().indexed, 0);
    assert.equal((await changed.search("Advisor")).mode, "lexical-fallback");
  } finally { f.close(); }
});

test("disabled feature never calls network; provider failure falls back; empty query", async () => {
  const f = fixture();
  try {
    await f.hybrid.backfill();
    const failing = { embed() { throw new Error("SECRET_PROVIDER_DETAIL"); } };
    const disabled = new HybridMemory(f.store, { ...config, enabled: false }, redact, failing as any);
    assert.equal((await disabled.search("Advisor")).mode, "fts");
    const failure = new HybridMemory(f.store, config, redact, failing as any);
    const result = await failure.search("Advisor");
    assert.equal(result.mode, "lexical-fallback");
    assert.equal(result.rows.length, 1);
    assert.ok(!JSON.stringify(result).includes("SECRET_PROVIDER_DETAIL"));
    assert.equal((await failure.search("   ")).mode, "empty");
  } finally { f.close(); }
});

test("redaction and deterministic UTF8 truncation happen before outbound input", async () => {
  const f = fixture();
  try {
    f.store.db.prepare("UPDATE blocks SET topic=?,summary=? WHERE id=1").run("API key: sk-" + "x".repeat(40), "password=secret123 https://private.invalid/path /home/private/client/file.txt C:\\private\\client\\secret.txt benignmarker");
    await f.hybrid.backfill(1);
    assert.ok(!f.sent[0][0].includes("secret123"));
    assert.ok(!f.sent[0][0].includes("private.invalid"));
    assert.ok(!f.sent[0][0].includes("/home/private"));
    assert.ok(!f.sent[0][0].includes("C:\\private"));
    assert.ok(f.sent[0][0].includes("[REDACTED]"));
    await f.hybrid.search("password=secret123");
    assert.ok(!f.sent.at(-1)![0].includes("secret123"));
    const input = prepareText("语义".repeat(200), { ...config, maxInputBytes: 128 }, redact);
    assert.equal(input.truncated, true); assert.ok(!input.text.includes("\ufffd")); assert.ok(Buffer.byteLength(input.text) <= 128);
    assert.notEqual(namespace(config), namespace({ ...config, revision: "2" }));
    assert.notEqual(namespace(config), namespace({ ...config, maxInputBytes: 128 }));
  } finally { f.close(); }
});

test("prune trigger and in-flight backfill cannot resurrect a removed block", async () => {
  const f = fixture();
  try {
    await f.hybrid.backfill();
    f.store.db.exec("DELETE FROM blocks WHERE id=1");
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM memory_vectors WHERE block_id=1").get()!.n, 0);
    f.store.db.exec("DELETE FROM memory_vectors");
    let release!: (vectors: number[][]) => void;
    const delayed = new HybridMemory(f.store, config, redact, { embed: () => new Promise(r => { release = r; }) } as any);
    const work = delayed.backfill(1);
    f.store.db.exec("DELETE FROM blocks WHERE id=2");
    release([[0, 1]]);
    const result = await work;
    assert.equal(result.stored, 0); assert.equal(result.skipped, 1);
    assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM memory_vectors").get()!.n, 0);
  } finally { f.close(); }
});

test("later backfill batches never upload deleted or changed snapshot text", async () => {
  for (const change of ["delete", "update"]) {
    const f = fixture();
    try {
      f.store.db.exec("DELETE FROM blocks");
      const add = f.store.db.prepare("INSERT INTO blocks(source_file,block_id,summary) VALUES('a',?,?)");
      for (let i = 0; i < 9; i++) add.run(`batch-${i}`, `snapshot-${i}`);
      const last = f.store.db.prepare("SELECT max(id) AS id FROM blocks").get()!.id;
      let release!: (vectors: number[][]) => void;
      const sent: string[][] = [];
      const delayed = new HybridMemory(f.store, config, redact, { embed: (texts: string[]) => {
        sent.push(texts);
        return sent.length === 1 ? new Promise(r => { release = r; }) : Promise.resolve(texts.map(() => [1, 0]));
      } } as any);
      const work = delayed.backfill(9);
      if (change === "delete") f.store.db.prepare("DELETE FROM blocks WHERE id=?").run(last);
      else f.store.db.prepare("UPDATE blocks SET summary='updated text' WHERE id=?").run(last);
      release(Array.from({ length: 8 }, () => [1, 0]));
      const result = await work;
      assert.equal(sent.length, 1); assert.equal(result.uploaded, 8); assert.equal(result.skipped, 1);
      assert.ok(!JSON.stringify(sent).includes("snapshot-8"));
    } finally { f.close(); }
  }
});

test("shared database lease excludes a second worker and manual/automatic overlap", async () => {
  const f = fixture();
  try {
    let release!: (vectors: number[][]) => void;
    const first = new HybridMemory(f.store, config, redact, { embed: () => new Promise(r => { release = r; }) } as any);
    const second = new HybridMemory(f.store, config, redact, { embed: async (x: string[]) => x.map(() => [1, 0]) } as any);
    const work = first.backfill(1);
    await assert.rejects(first.backfill(1), /already running/);
    await assert.rejects(second.backfill(1), /another Pi process/);
    release([[1, 0]]); await work;
    assert.equal((await second.backfill(1)).stored, 1);
    f.store.db.prepare("INSERT INTO memory_embedding_lease VALUES(1,'dead-worker',?)").run(Date.now() - 1);
    assert.equal((await second.backfill(1)).stored, 1);
  } finally { f.close(); }
});

test("lease excludes a second connection, renews and recovers an expired owner", async () => {
  const dir=mkdtempSync(join(tmpdir(),'memory-lease-'));
  const a=new DatabaseSync(join(dir,'shared.db')); const b=new DatabaseSync(join(dir,'shared.db'));
  try {
    a.exec("CREATE TABLE sources(source_file TEXT PRIMARY KEY,project TEXT,cwd TEXT); CREATE TABLE blocks(id INTEGER PRIMARY KEY,source_file TEXT,kind TEXT,block_id TEXT,tier INTEGER,topic TEXT,ref_start TEXT,ref_end TEXT,compressed_tokens INTEGER,created_at INTEGER,summary TEXT); INSERT INTO sources VALUES('a','test','test'); INSERT INTO blocks(id,source_file,block_id,summary) VALUES(1,'a','b1','synthetic');");
    const store=(db: DatabaseSync)=>({db,closed:false,search:()=>({mode:'fts',rows:[]})});
    let release!: (vectors:number[][])=>void;
    const first=new HybridMemory(store(a),config,redact,{embed:()=>new Promise(r=>{release=r;})} as any);
    const second=new HybridMemory(store(b),config,redact,{embed:async()=>[[1,0]]} as any);
    const work=first.backfill(1);
    await assert.rejects(second.backfill(1),/another Pi process/);
    a.prepare('UPDATE memory_embedding_lease SET expires_at=?').run(Date.now()+10);
    release([[1,0]]); await work; assert.equal(second.status().indexed,1);
    a.exec("DELETE FROM memory_vectors; INSERT INTO memory_embedding_lease VALUES(1,'crashed',0);");
    assert.equal((await second.backfill(1)).stored,1);
  } finally {a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});

test("empty prepared prefixes don't poison valid rows; revoked sources don't upload in later batches", async () => {
  const f = fixture();
  try {
    f.store.db.prepare("UPDATE blocks SET summary=? WHERE id=1").run(' '.repeat(7000)+'valid tail');
    assert.equal((await f.hybrid.backfill(3)).stored, 2);
    assert.equal((await f.hybrid.backfill(3)).uploaded, 0);
    f.store.db.exec('DELETE FROM memory_vectors');
    let checks=0;
    const result=await f.hybrid.backfill(20,async()=>++checks===1 ? () => true : row => row.project==='ProjB');
    assert.equal(result.uploaded,1); assert.equal(result.stored,1);
    assert.ok(f.sent.at(-1)!.every(x=>x.includes('Remote')));
  } finally { f.close(); }
});

test("shutdown invalidates outstanding backfill without reopening store", async () => {
  const f = fixture();
  let release!: (vectors: number[][]) => void;
  const delayed = new HybridMemory(f.store, config, redact, { embed: () => new Promise(r => { release = r; }) } as any);
  const work = delayed.backfill(1);
  delayed.abort(); f.close(); release([[1, 0]]);
  await assert.rejects(work, /expired/);
});

test("search revalidates project and content after HTTP and never returns shutdown/pruned snapshots", async () => {
  for (const action of ["project", "content", "prune", "shutdown"]) {
    const f = fixture();
    let closed = false;
    try {
      await f.hybrid.backfill();
      let release!: (vectors: number[][]) => void;
      const delayed = new HybridMemory(f.store, config, redact, { embed: () => new Promise(r => { release = r; }) } as any);
      const work = delayed.search("different wording", { project: "ProjA" });
      if (action === "project") f.store.db.exec("UPDATE sources SET project='Changed' WHERE source_file='a'");
      if (action === "content") f.store.db.exec("UPDATE blocks SET summary='changed' WHERE source_file='a'");
      if (action === "prune") f.store.db.exec("DELETE FROM blocks WHERE source_file='a'");
      if (action === "shutdown") { delayed.abort(); f.close(); closed = true; }
      release([[1, 0]]);
      assert.deepEqual((await work).rows, [], action);
    } finally { if (!closed) f.close(); }
  }
});

test("chunked search yields, bounds concurrent queries and survives shutdown during scoring", async () => {
  const f = fixture();
  let closed = false;
  try {
    const add = f.store.db.prepare("INSERT INTO blocks(source_file,block_id,summary) VALUES('a',?,?)");
    for (let i = 0; i < 80; i++) add.run(`extra-${i}`, `synthetic summary ${i}`);
    await f.hybrid.backfill(100);
    let calls = 0;
    const chunked = new HybridMemory(f.store, config, redact, { embed: async () => { calls++; return [[1, 0]]; } } as any);
    let ticked = false;
    setImmediate(() => { ticked = true; });
    const first = chunked.search("synthetic");
    const second = await chunked.search("Advisor");
    assert.equal(second.mode, "lexical-fallback"); assert.ok(second.reason.includes("busy"));
    assert.equal((await first).mode, "hybrid"); assert.equal(calls, 1); assert.equal(ticked, true);
    setImmediate(() => { chunked.abort(); f.close(); closed = true; });
    assert.deepEqual((await chunked.search("synthetic")).rows, []);
  } finally { if (!closed) f.close(); }
});

test("caller cancellation is empty before dispatch, during HTTP and during scoring", async () => {
  for (const phase of ["before", "http", "scoring"]) {
    const f = fixture();
    try {
      const add = f.store.db.prepare("INSERT INTO blocks(source_file,block_id,summary) VALUES('a',?,?)");
      for (let i = 0; i < 40; i++) add.run(`cancel-${i}`, `Advisor summary ${i}`);
      await f.hybrid.backfill(100);
      const controller = new AbortController();
      let release!: (vectors: number[][]) => void;
      let calls = 0;
      const memory = new HybridMemory(f.store, config, redact, { embed: () => {
        calls++;
        return phase === "http" ? new Promise(r => { release = r; }) : Promise.resolve([[1, 0]]);
      } } as any);
      if (phase === "before") controller.abort();
      if (phase === "scoring") setImmediate(() => controller.abort());
      const work = memory.search("Advisor", {}, controller.signal);
      if (phase === "http") { controller.abort(); release([[1, 0]]); }
      const result = await work;
      assert.equal(result.mode, "cancelled"); assert.deepEqual(result.rows, []);
      assert.equal(calls, phase === "before" ? 0 : 1);
    } finally { f.close(); }
  }
});

test("coverage is omitted if pruning changes the store during a scoring yield", async () => {
  const f = fixture();
  try {
    const add = f.store.db.prepare("INSERT INTO blocks(source_file,block_id,summary) VALUES('a',?,?)");
    for (let i = 0; i < 40; i++) add.run(`prune-${i}`, `summary ${i}`);
    await f.hybrid.backfill(100);
    setImmediate(() => f.store.db.exec("DELETE FROM blocks"));
    const result = await f.hybrid.search("different wording");
    assert.deepEqual(result.rows, []); assert.equal(result.coverage, undefined);
    assert.ok(result.reason.includes("coverage omitted"));
  } finally { f.close(); }
});

test("zero hits retain coverage and fallback diagnostics", () => {
  const text = formatResults({ rows: [], mode: "lexical-fallback", coverage: { indexed: 0, total: 4, truncated: 0 }, reason: "No vectors" });
  assert.ok(text.includes("0/4")); assert.ok(text.includes("No vectors"));
});

test("vectors roundtrip, bad vectors rejected, RRF rewards dual hits", () => {
  assert.deepEqual(decodeVector(encodeVector([1, 0]), 2), [1, 0]);
  assert.throws(() => decodeVector(Buffer.alloc(8), 2));
  assert.throws(() => decodeVector(Buffer.alloc(4), 2));
  assert.deepEqual(fuse([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], 2).map(x => x.id), [2, 1]);
});

test("client enforces indexes/dimensions/nonzero/finite vectors and sanitizes provider errors", async () => {
  process.env.FUYAO_MEMORY_EMBEDDING_KEY = "synthetic-test-key";
  const valid = { data: [{ index: 0, embedding: [3, 4] }] };
  try {
    let request: RequestInit | undefined;
    const client = new EmbeddingClient(config, (async (_url, init) => { request = init; return Response.json(valid); }) as typeof fetch);
    assert.deepEqual(await client.embed(["synthetic"]), [[0.6, 0.8]]);
    assert.equal(request!.redirect, "error");
    for (const data of [[], [{ index: 1, embedding: [1, 0] }], [{ index: 0, embedding: [0, 0] }], [{ index: 0, embedding: [1] }], [{ index: 0, embedding: [null, 1] }]]) {
      const bad = new EmbeddingClient(config, (async () => Response.json({ data })) as typeof fetch);
      await assert.rejects(bad.embed(["synthetic"]), /^Error: Embedding request failed$/);
    }
    const duplicate = new EmbeddingClient(config, (async () => Response.json({ data: [valid.data[0], valid.data[0]] })) as typeof fetch);
    await assert.rejects(duplicate.embed(["a", "b"]), /failed/);
    const failed = new EmbeddingClient(config, (async () => new Response("PRIVATE_ERROR", { status: 401 })) as typeof fetch);
    await assert.rejects(failed.embed(["synthetic"]), /^Error: Embedding request failed$/);
    const timeout = new EmbeddingClient({ ...config, timeoutMs: 100 }, (async (_url, init) => new Promise((_r, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("PRIVATE_TIMEOUT")), { once: true });
    })) as typeof fetch);
    const keepAlive = setTimeout(() => {}, 2000);
    try { await assert.rejects(timeout.embed(["synthetic"]), /timed out/); } finally { clearTimeout(keepAlive); }
    const abort = new AbortController(); abort.abort();
    const cancelled = new EmbeddingClient(config, (async () => { throw new Error("must not dispatch"); }) as typeof fetch);
    await assert.rejects(cancelled.embed(["synthetic"], abort.signal), /cancelled/);
    assert.equal(sanitizeEmbeddingConfig({ enabled: true, baseUrl: "http://example.invalid" }).enabled, false);
    assert.equal(sanitizeEmbeddingConfig({ enabled: true, baseUrl: "https://user:password@example.invalid" }).enabled, false);
  } finally { delete process.env.FUYAO_MEMORY_EMBEDDING_KEY; }
});
