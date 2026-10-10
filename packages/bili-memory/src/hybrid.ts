import { sqlAuthorization, storeChanges } from './source-policy.js';
import { randomUUID } from "node:crypto";
import type { MemoryRecord } from "./activity.js";
import { hash, EmbeddingClient, type EmbeddingConfig, namespace, prepareText, encodeVector, cosineBlob } from "./embeddings.js";

interface Store { db: any; closed: boolean; search(query: string, opts?: any): { mode: string; rows: any[] } }
export function ensureVectorSchema(store: Store): void {
  if (!store.db || store.closed) throw new Error("Memory store closed");
  store.db.exec(`CREATE TABLE IF NOT EXISTS memory_vectors (
    block_id INTEGER NOT NULL, namespace TEXT NOT NULL, input_hash TEXT NOT NULL,
    dimensions INTEGER NOT NULL, vector BLOB NOT NULL, truncated INTEGER NOT NULL,
    PRIMARY KEY(block_id, namespace), CHECK(length(vector) = dimensions * 4)
  );
  CREATE TABLE IF NOT EXISTS memory_embedding_lease (
    id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TRIGGER IF NOT EXISTS memory_vectors_update AFTER UPDATE OF summary,topic ON blocks
    WHEN old.summary IS NOT new.summary OR old.topic IS NOT new.topic BEGIN
    DELETE FROM memory_vectors WHERE block_id=old.id;
  END;
  CREATE TRIGGER IF NOT EXISTS memory_vectors_delete AFTER DELETE ON blocks BEGIN
    DELETE FROM memory_vectors WHERE block_id = old.id;
  END;`);
}
const columns = `b.id, b.source_file AS sourceFile, b.kind, b.block_id AS blockId, b.tier, b.topic,
  b.ref_start AS refStart, b.ref_end AS refEnd, b.compressed_tokens AS tokens,
  b.created_at AS createdAt, b.summary, s.project, s.cwd`;
export function fuse(lexical: any[], semantic: any[], limit: number): any[] {
  const candidates = new Map<number, { row: any; score: number }>();
  for (const list of [lexical, semantic]) list.forEach((row, index) => {
    const previous = candidates.get(row.id);
    candidates.set(row.id, { row: previous?.row ?? row, score: (previous?.score ?? 0) + 1 / (60 + index + 1) });
  });
  return [...candidates.values()].sort((a, b) => b.score - a.score || a.row.id - b.row.id).slice(0, limit).map(x => x.row);
}

export class HybridMemory {
  readonly ns: string;
  private readonly owner = randomUUID();
  private busy = false;
  private searching = false;
  private controller = new AbortController();
  constructor(private store: Store, readonly config: EmbeddingConfig, private redact: (s: string) => string,
    private client = new EmbeddingClient(config), private current: () => boolean = () => !store.closed,
    private onStored: (records: MemoryRecord[]) => void = () => {}) {
    this.ns = namespace(config);
    ensureVectorSchema(store);
  }
  abort(): void { this.controller.abort(); this.releaseLease(); }
  private releaseLease(): void {
    if (!this.store.closed && this.store.db) {
      try { this.store.db.prepare("DELETE FROM memory_embedding_lease WHERE id=1 AND owner=?").run(this.owner); } catch { /* Closed store. */ }
    }
  }
  private acquireLease(): void {
    if (!this.valid()) throw new Error("Memory embedding operation expired");
    const now = Date.now();
    this.store.db.prepare(`INSERT INTO memory_embedding_lease VALUES(1,?,?)
      ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
      WHERE memory_embedding_lease.expires_at<=? OR memory_embedding_lease.owner=?`)
      .run(this.owner, now + 120000, now, this.owner);
    if (this.store.db.prepare("SELECT owner FROM memory_embedding_lease WHERE id=1").get()?.owner !== this.owner)
      throw new Error("Embedding backfill busy in another Pi process");
  }
  private valid(): boolean { return !this.controller.signal.aborted && this.current() && !this.store.closed && !!this.store.db; }
  private input(row: any) { return prepareText(`${row.topic ?? ""}\n${row.summary}`, this.config, this.redact); }
  private *rows(project?: string, allowedIds?: number[], authorizedRows?: any[]): Generator<any> {
    if (!this.valid()) throw new Error("Memory embedding operation expired");
    const policy = sqlAuthorization(this.store.db, allowedIds, authorizedRows);
    try {
      // Finish each SQLite statement before yielding: an active cursor would prevent
      // another operation from dropping its own TEMP policy table on this connection.
      const statement = this.store.db.prepare(`SELECT ${columns}, ${this.hasReferences() ? 'b.msg_ids' : 'NULL'} AS msgIds,
        v.input_hash AS inputHash, v.dimensions, v.vector, v.truncated
        FROM blocks b JOIN sources s ON s.source_file=b.source_file
        LEFT JOIN memory_vectors v ON v.block_id=b.id AND v.namespace=?
        WHERE b.id>? ${project ? 'AND s.project=?' : ''} AND ${policy.sql}
        ORDER BY b.id LIMIT ?`);
      let after = 0, remaining = this.config.maxBlocks;
      while (remaining > 0) {
        const batch = statement.all(this.ns, after, ...(project ? [project] : []), Math.min(32, remaining));
        if (!batch.length) break;
        remaining -= batch.length;
        after = batch[batch.length - 1].id;
        yield* batch;
      }
    } finally { policy.dispose(); }
  }
  private hasReferences(): boolean { return this.store.db.prepare('PRAGMA table_info(blocks)').all().some((c: any) => c.name === 'msg_ids'); }
  vectorState(id: number): "missing" | "stale" | "ready" | "truncated" {
    if (!this.valid()) return "missing";
    const row = this.store.db.prepare(`SELECT b.topic,b.summary,v.input_hash AS inputHash,v.dimensions,v.vector,v.truncated
      FROM blocks b LEFT JOIN memory_vectors v ON v.block_id=b.id AND v.namespace=? WHERE b.id=?`).get(this.ns,id);
    if (!row?.vector) return "missing";
    if (row.inputHash !== this.input(row).hash || row.dimensions !== this.config.dimensions) return "stale";
    try { cosineBlob(row.vector,this.config.dimensions); return row.truncated ? "truncated" : "ready"; }
    catch { return "stale"; }
  }
  status(project?: string) {
    const total = this.store.db.prepare(`SELECT count(*) AS n FROM blocks b JOIN sources s ON s.source_file=b.source_file ${project ? "WHERE s.project=?" : ""}`).get(...(project ? [project] : [])).n;
    let indexed = 0, truncated = 0, scanned = 0;
    for (const row of this.rows(project)) {
      scanned++;
      if (row.vector && row.inputHash === this.input(row).hash && row.dimensions === this.config.dimensions) {
        try { cosineBlob(row.vector, this.config.dimensions); indexed++; truncated += row.truncated ? 1 : 0; } catch { /* Treat invalid rows as pending. */ }
      }
    }
    return { total, scanned, indexed, pending: scanned - indexed, truncated, capped: total > scanned };
  }
  private scopedTotal(opts: { project?: string; allowedIds?: number[]; authorizedRows?: any[] }): number {
    const policy = sqlAuthorization(this.store.db, opts.allowedIds, opts.authorizedRows);
    try { return this.store.db.prepare(`SELECT count(*) AS n FROM blocks b JOIN sources s ON s.source_file=b.source_file
      WHERE ${policy.sql} ${opts.project ? 'AND s.project=?' : ''}`).get(...(opts.project ? [opts.project] : [])).n; }
    finally { policy.dispose(); }
  }
  private scopedStatus(opts: { project?: string; allowedIds?: number[]; authorizedRows?: any[] }) {
    const total = this.scopedTotal(opts);
    let scanned = 0, indexed = 0, truncated = 0;
    for (const row of this.rows(opts.project, opts.allowedIds, opts.authorizedRows)) {
      scanned++;
      if (row.vector && row.dimensions === this.config.dimensions && row.inputHash === this.input(row).hash) {
        try { cosineBlob(row.vector, this.config.dimensions); indexed++; truncated += row.truncated ? 1 : 0; } catch { /* Invalid. */ }
      }
    }
    return { total, scanned, indexed, pending: scanned - indexed, unscanned: total - scanned, truncated, capped: total > scanned };
  }
  async backfill(limit = 20, permissions?: () => Promise<((row: any) => boolean) & { allowedIds?: number[] }>): Promise<{ uploaded: number; stored: number; skipped: number; status: ReturnType<HybridMemory["status"]> }> {
    if (!this.config.enabled) throw new Error("Embedding disabled");
    if (this.busy) throw new Error("Embedding backfill already running");
    this.busy = true;
    let uploaded = 0, stored = 0, skipped = 0;
    try {
      this.acquireLease();
      let eligible: ((row: any) => boolean) & { allowedIds?: number[] } = permissions ? await permissions() : () => true;
      this.acquireLease();
      const pending: any[] = [];
      const cap = Math.max(1, Math.min(100, Math.floor(limit)));
      for (const row of this.rows(undefined, eligible.allowedIds)) {
        if (!eligible(row) || !this.input(row).text.trim()) { skipped++; continue; }
        let valid = false;
        if (row.vector && row.inputHash === this.input(row).hash && row.dimensions === this.config.dimensions) {
          try { cosineBlob(row.vector, this.config.dimensions); valid = true; } catch { /* Rebuild. */ }
        }
        if (!valid) pending.push({ ...row, vector: undefined });
        if (pending.length >= cap) break;
      }
      for (let i = 0; i < pending.length; i += 8) {
        if (permissions) eligible = await permissions();
        this.acquireLease();
        const batch = pending.slice(i, i + 8).flatMap(row => {
          // A previous request yielded to prune/ingestion. Revalidate BEFORE upload,
          // not merely before persistence, so later batches never send stale text.
          const present = this.store.db.prepare("SELECT id,topic,summary FROM blocks WHERE id=? AND source_file=? AND block_id=?").get(row.id, row.sourceFile, row.blockId);
          if (!eligible(row) || !present || this.input(present).hash !== this.input(row).hash) { skipped++; return []; }
          return [row];
        });
        if (!batch.length) continue;
        const inputs = batch.map(row => this.input(row));
        const vectors = await this.client.embed(inputs.map(x => x.text), this.controller.signal);
        uploaded += batch.length;
        if (permissions) eligible = await permissions();
        this.acquireLease();
        // No async work inside this transaction. Recheck existence/content after HTTP.
        const committed: MemoryRecord[] = [];
        this.store.db.exec("BEGIN IMMEDIATE");
        try {
          batch.forEach((row, j) => {
            const present = this.store.db.prepare("SELECT id,topic,summary FROM blocks WHERE id=? AND source_file=? AND block_id=?").get(row.id, row.sourceFile, row.blockId);
            if (!eligible(row) || !present || this.input(present).hash !== inputs[j].hash) { skipped++; return; }
            this.store.db.prepare("INSERT OR REPLACE INTO memory_vectors VALUES (?,?,?,?,?,?)").run(row.id, this.ns, inputs[j].hash, this.config.dimensions, encodeVector(vectors[j]), Number(inputs[j].truncated));
            stored++;
            committed.push({ identity: hash(JSON.stringify([row.sourceFile, row.kind, row.blockId])), blockId: row.blockId, project: row.project, topic: row.topic,
              summary: inputs[j].text, truncated: inputs[j].truncated });
          });
          this.store.db.exec("COMMIT");
        } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
        if (committed.length) { try { this.onStored(committed); } catch { /* Display only. */ } }
      }
      return { uploaded, stored, skipped, status: this.status() };
    } finally { this.releaseLease(); this.busy = false; }
  }
  async search(query: string, opts: { project?: string; limit?: number; allowedIds?: number[]; authorizedRows?: any[]; refreshPolicy?: () => Promise<{ allowedIds: number[]; authorizedRows: any[] }> } = {}, signal?: AbortSignal) {
    const cancelled = () => ({ mode: "cancelled", rows: [], reason: "Memory search cancelled" });
    if (signal?.aborted) return cancelled();
    const limit = Math.max(1, Math.min(20, opts.limit ?? 6));
    const lexical = this.store.search(query, { ...opts, limit: 20 });
    const fallback = (reason: string, coverage?: unknown) => signal?.aborted ? cancelled() : ({ mode: "lexical-fallback",
      rows: this.valid() ? this.store.search(query, { ...opts, limit }).rows : [], reason, coverage });
    if (!query.trim()) return { mode: "empty", rows: [] };
    if (!this.config.enabled) return { ...lexical, rows: lexical.rows.slice(0, limit) };
    if (this.searching) return fallback("Semantic search busy; keyword search used");
    this.searching = true;
    try {
      if (!this.valid() || signal?.aborted) return fallback("Embedding operation expired");
      if (opts.refreshPolicy) Object.assign(opts, await opts.refreshPolicy());
      if (!this.valid() || signal?.aborted) return cancelled();
      // A vector outside the authorized workspace (or stale/corrupt) never justifies query upload.
      let hasVectors = false;
      let gateScanned = 0;
      for (const row of this.rows(opts.project, opts.allowedIds, opts.authorizedRows)) {
        gateScanned++;
        if (row.vector && row.dimensions === this.config.dimensions && row.inputHash === this.input(row).hash) {
          try { cosineBlob(row.vector, this.config.dimensions); hasVectors = true; break; } catch { /* Invalid vector. */ }
        }
        if (gateScanned % 32 === 0) {
          await new Promise<void>(resolve => setImmediate(resolve));
          if (!this.valid() || signal?.aborted) return cancelled();
        }
      }
      // Refresh even on zero-vector fallback: revocation during a yield must not
      // return historical text using the old authorization snapshot.
      if (gateScanned >= 32 && opts.refreshPolicy) {
        Object.assign(opts, await opts.refreshPolicy());
        if (!this.valid() || signal?.aborted) return cancelled();
        hasVectors = false;
        for (const row of this.rows(opts.project, opts.allowedIds, opts.authorizedRows)) {
          if (row.vector && row.dimensions === this.config.dimensions && row.inputHash === this.input(row).hash) {
            try { cosineBlob(row.vector, this.config.dimensions); hasVectors = true; break; } catch { /* Invalid. */ }
          }
        }
      }
      if (!hasVectors) return fallback("No valid vectors in the authorized scope; keyword search used.",
        this.scopedStatus(opts));
      const input = prepareText(query, this.config, this.redact).text;
      const combined = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
      const [q] = await this.client.embed([input], combined);
      if (!this.valid() || combined.aborted) return fallback("Embedding operation expired");
      if (opts.refreshPolicy) Object.assign(opts, await opts.refreshPolicy());
      if (!this.valid() || combined.aborted) return fallback("Embedding operation expired");
      const changesBefore = storeChanges(this.store.db);
      const top: { row: any; score: number }[] = [];
      let scanned = 0, indexed = 0, truncated = 0;
      for (const row of this.rows(opts.project, opts.allowedIds, opts.authorizedRows)) {
        scanned++;
        if (row.vector && row.dimensions === this.config.dimensions && row.inputHash === this.input(row).hash) {
          try {
            const score = cosineBlob(row.vector, this.config.dimensions, q);
            indexed++; truncated += row.truncated ? 1 : 0;
            if (score >= this.config.minSimilarity) {
              top.push({ row: { ...row, vector: undefined }, score });
              top.sort((a, b) => b.score - a.score || a.row.id - b.row.id);
              if (top.length > 20) top.pop();
            }
          } catch { /* Invalid vector remains pending. */ }
        }
        if (scanned % 32 === 0) {
          await new Promise<void>(resolve => setImmediate(resolve));
          if (!this.valid() || combined.aborted) return fallback("Embedding operation expired");
        }
      }
      const semantic = top.map(x => x.row);
      const total = this.scopedTotal(opts);
      const changed = storeChanges(this.store.db) !== changesBefore;
      // A concurrent same-connection mutation makes scan counters approximate.
      // Omit rather than claim an impossible indexed/total ratio.
      const coverage = changed ? undefined : { total, scanned, indexed, pending: scanned - indexed,
        unscanned: total - scanned, truncated, capped: total > scanned };
      // Re-read after HTTP: pruning, ingestion or project metadata can change.
      // Never return a pre-request row whose semantic input/project is now stale.
      if (opts.refreshPolicy) Object.assign(opts, await opts.refreshPolicy());
      if (!this.valid() || combined.aborted) return fallback("Embedding operation expired");
      const finalPolicy = sqlAuthorization(this.store.db, opts.allowedIds, opts.authorizedRows);
      let liveSemantic: any[];
      try { liveSemantic = semantic.flatMap(row => {
        if (opts.allowedIds !== undefined && !opts.allowedIds.includes(row.id)) return [];
        const present = this.store.db.prepare(`SELECT ${columns} FROM blocks b JOIN sources s ON s.source_file=b.source_file
          WHERE b.id=? AND b.source_file=? AND b.block_id=? ${opts.project ? "AND s.project=?" : ""} AND ${finalPolicy.sql}`)
          .get(row.id, row.sourceFile, row.blockId, ...(opts.project ? [opts.project] : []));
        return present && this.input(present).hash === row.inputHash ? [present] : [];
      }); } finally { finalPolicy.dispose(); }
      const liveLexical = this.store.search(query, { ...opts, limit: 20 }).rows;
      return { mode: "hybrid", rows: fuse(liveLexical, liveSemantic, limit), coverage,
        ...(changed ? { reason: "Store changed during semantic scan; coverage omitted" } : {}),
        queryTruncated: prepareText(query, this.config, this.redact).truncated };
    } catch {
      if (opts.refreshPolicy) { try { Object.assign(opts, await opts.refreshPolicy()); } catch { opts.allowedIds = []; opts.authorizedRows = []; } }
      return fallback("Embedding unavailable; keyword search used");
    }
    finally { this.searching = false; }
  }
}
