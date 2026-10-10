import { createHash } from 'node:crypto';

export const NATIVE_PARSER_VERSION = 2;
export const DEFAULT_SOURCE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_SUMMARY_BYTES = 1024 * 1024;
export function completeSummary(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Summary exceeds the storage budget; no truncated revision was stored');
  return text;
}
export function ensureNativeSchema(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS memory_native_metadata (
    block_id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, active INTEGER,
    direct_block_ids TEXT, body_hash TEXT NOT NULL, summary_bytes INTEGER NOT NULL,
    CHECK(active IS NULL OR active IN (0,1))
  );
  CREATE TABLE IF NOT EXISTS memory_native_sources (
    source_file TEXT PRIMARY KEY, source_stamp TEXT NOT NULL, parser_version INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memory_bili_block_coverage (
    block_id INTEGER PRIMARY KEY, summary TEXT NOT NULL, msg_ids TEXT
  );
  CREATE TRIGGER IF NOT EXISTS memory_native_delete AFTER DELETE ON blocks BEGIN
    DELETE FROM memory_native_metadata WHERE block_id=old.id;
    DELETE FROM memory_bili_block_coverage WHERE block_id=old.id;
  END;`);
  // Small isolated stores (and older offline fixtures) need no reference trigger.
  if (db.prepare('PRAGMA table_info(blocks)').all().some((c: any) => c.name === 'msg_ids')) db.exec(`
    CREATE TRIGGER IF NOT EXISTS memory_coverage_update AFTER UPDATE OF summary,msg_ids ON blocks
      WHEN old.summary IS NOT new.summary OR old.msg_ids IS NOT new.msg_ids BEGIN
        DELETE FROM memory_bili_block_coverage WHERE block_id=old.id;
      END;`);
}
export function saveNativeMetadata(db: any, id: number, sessionId: string, block: any, summary: string): void {
  const active = typeof block.active === 'boolean' ? Number(block.active) : null;
  const children = Array.isArray(block.directBlockIds) ? JSON.stringify(block.directBlockIds) : null;
  const body = createHash('sha256').update(summary).digest('hex');
  db.prepare(`INSERT INTO memory_native_metadata VALUES(?,?,?,?,?,?)
    ON CONFLICT(block_id) DO UPDATE SET session_id=excluded.session_id,active=excluded.active,
      direct_block_ids=excluded.direct_block_ids,body_hash=excluded.body_hash,summary_bytes=excluded.summary_bytes
    WHERE session_id IS NOT excluded.session_id OR active IS NOT excluded.active OR
      direct_block_ids IS NOT excluded.direct_block_ids OR body_hash IS NOT excluded.body_hash`)
    .run(id, sessionId, active, children, body, Buffer.byteLength(summary));
}
/** Coverage proves that the current block's complete refs were actually observed,
 * not inferred from stale raw-ID evidence. Caller binds snapshot/session/revision. */
export function coverBiliBlocks(db: any, file: string, rawIds: ReadonlySet<string>): void {
  db.prepare(`DELETE FROM memory_bili_block_coverage WHERE block_id IN
    (SELECT id FROM blocks WHERE source_file=?)`).run(file);
  const put = db.prepare('INSERT OR REPLACE INTO memory_bili_block_coverage VALUES(?,?,?)');
  for (const row of db.prepare('SELECT id,summary,msg_ids FROM blocks WHERE source_file=?').all(file)) {
    let ids: unknown; try { ids = JSON.parse(row.msg_ids ?? '[]'); } catch { continue; }
    if (!Array.isArray(ids) || !ids.length || ids.length >= 4000 ||
        ids.some(id => typeof id !== 'string' || !rawIds.has(id.split('#')[0]))) continue;
    put.run(row.id, row.summary, row.msg_ids);
  }
}
