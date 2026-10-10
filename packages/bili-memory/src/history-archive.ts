import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { realSourcePath, readSourceFile } from './source-files.js';

export const HISTORY_FORMAT = 'bili-memory-history';
export interface HistoryBlock {
  blockId: string; runId: string | null; tier: number | null; topic: string | null;
  summary: string; msgIds: string[] | null; refStart: string | null; refEnd: string | null;
  compressedTokens: number | null; createdAt: number | null;
}
export interface HistoryArchive {
  format: typeof HISTORY_FORMAT; version: 1;
  origin: { sourceFile: string; kind: string; cwd: string | null; project: string };
  blocks: HistoryBlock[];
}
/** Owned historical records, not fabricated proxy sessions. No legacy source is
 * read at runtime: the converter takes the already-stored, sanitized summaries. */
export function normalizeHistoryBlocks(value: unknown): HistoryBlock[] | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as HistoryArchive;
  if (v.format !== HISTORY_FORMAT || v.version !== 1 || !v.origin ||
      typeof v.origin.sourceFile !== 'string' || typeof v.origin.kind !== 'string' ||
      typeof v.origin.project !== 'string' || (v.origin.cwd !== null && typeof v.origin.cwd !== 'string') ||
      !Array.isArray(v.blocks)) return null;
  const ids = new Set<string>();
  for (const b of v.blocks) {
    if (!b || typeof b.blockId !== 'string' || !b.blockId || ids.has(b.blockId) || typeof b.summary !== 'string' ||
        (b.topic !== null && typeof b.topic !== 'string') || (b.runId !== null && typeof b.runId !== 'string') ||
        (b.refStart !== null && typeof b.refStart !== 'string') || (b.refEnd !== null && typeof b.refEnd !== 'string') ||
        [b.tier,b.compressedTokens,b.createdAt].some(n => n !== null && !Number.isSafeInteger(n)) ||
        (b.msgIds !== null && (!Array.isArray(b.msgIds) || b.msgIds.some(id => typeof id !== 'string')))) return null;
    ids.add(b.blockId);
  }
  return v.blocks;
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
/** Directory rules alone cannot reauthorize a previously disabled source. */
export function historyRegistration(db: any, file: string): { sha256: string; enabled: number } | undefined {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_history_origins'").get()) return undefined;
  return db.prepare('SELECT sha256,enabled FROM memory_history_origins WHERE archive_file=?').get(file);
}
export function historyMatches(body: string, registration: { sha256: string } | undefined): boolean {
  return !!registration && digest(body) === registration.sha256;
}
function refs(text: string | null): string[] | null {
  if (text === null) return null;
  const ids = JSON.parse(text);
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw Error('Invalid stored message references');
  return ids;
}
export interface ArchivePlan {
  sourceFile: string; destination: string; kind: string; sha256: string;
  content: string; count: number; enabled: boolean;
}
/** Pure plan over a consistent DB copy. Authorize each source explicitly; absent
 * or disabled sources remain archived but are not silently enabled for upload. */
export function planHistoryArchives(db: any, directory: string, allowedSources: ReadonlySet<string>): ArchivePlan[] {
  const files: string[] = db.prepare(`SELECT source_file FROM sources WHERE kind IN ('pi','opencode')
    UNION SELECT source_file FROM block_tombstones WHERE source_file NOT IN (SELECT source_file FROM sources)
    ORDER BY source_file`).all().map((r: any) => r.source_file);
  const migrated = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_history_origins'").get()
    ? new Set(db.prepare('SELECT archive_file FROM memory_history_origins').all().map((r: any) => r.archive_file)) : new Set();
  return files.filter(file => !migrated.has(file)).map(sourceFile => {
    const source = db.prepare('SELECT kind,cwd,project FROM sources WHERE source_file=?').get(sourceFile);
    const kind = source?.kind ?? 'unknown';
    const rows = db.prepare('SELECT * FROM blocks WHERE source_file=? ORDER BY id').all(sourceFile);
    const blocks: HistoryBlock[] = rows.map((b: any) => ({ blockId: b.block_id, runId: b.run_id,
      tier: b.tier, topic: b.topic, summary: b.summary, msgIds: refs(b.msg_ids),
      refStart: b.ref_start, refEnd: b.ref_end, compressedTokens: b.compressed_tokens, createdAt: b.created_at }));
    const archive: HistoryArchive = { format: HISTORY_FORMAT, version: 1,
      origin: { sourceFile, kind, cwd: source?.cwd ?? null, project: source?.project ?? 'unknown' }, blocks };
    if (!normalizeHistoryBlocks(archive)) throw Error('Invalid stored history; conversion refused');
    const content = JSON.stringify(archive) + '\n';
    return { sourceFile, destination: join(resolve(directory), digest(sourceFile) + '.json'), kind,
      sha256: digest(content), content, count: blocks.length, enabled: allowedSources.has(sourceFile) };
  });
}

/** Write immutable artifacts first, then transact DB relocation. If interrupted,
 * only unreferenced files remain; never a committed DB pointing at partial files.
 * Operate on a DB copy/offline store. Do not point the running old extension here. */
export async function applyHistoryArchives(db: any, plans: readonly ArchivePlan[]): Promise<void> {
  for (const plan of plans) {
    const dir = resolve(plan.destination, '..');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await realSourcePath(dir);
    const temporary = `${plan.destination}.tmp-${randomUUID()}`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(plan.content); await handle.sync(); } finally { await handle.close(); }
      // Hard-link publication is atomic and never replaces an existing archive.
      try { await link(temporary, plan.destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const { body } = await readSourceFile(plan.destination);
      if (digest(body) !== plan.sha256) throw Error('History archive conflict; refusing to overwrite');
      const directory = await open(dir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary).catch(() => {}); }
  }
  db.exec('SAVEPOINT memory_history_conversion');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS memory_history_origins(
      archive_file TEXT PRIMARY KEY, original_file TEXT NOT NULL UNIQUE, original_kind TEXT NOT NULL,
      sha256 TEXT NOT NULL, enabled INTEGER NOT NULL)`);
    for (const plan of plans) {
      const prior = db.prepare('SELECT * FROM memory_history_origins WHERE original_file=?').get(plan.sourceFile);
      if (prior) {
        if (prior.archive_file !== plan.destination || prior.sha256 !== plan.sha256 || prior.enabled !== Number(plan.enabled)) throw Error('Conflicting history migration');
        continue;
      }
      if (digest(plan.content) !== plan.sha256) throw Error('Invalid archive plan hash');
      const archive = JSON.parse(plan.content) as HistoryArchive;
      if (!normalizeHistoryBlocks(archive) || archive.origin.sourceFile !== plan.sourceFile || archive.origin.kind !== plan.kind)
        throw Error('Invalid archive plan identity');
      const current = db.prepare('SELECT * FROM blocks WHERE source_file=? ORDER BY id').all(plan.sourceFile);
      const fingerprint = current.map((b: any) => ({ blockId: b.block_id, runId: b.run_id, tier: b.tier,
        topic: b.topic, summary: b.summary, msgIds: refs(b.msg_ids), refStart: b.ref_start,
        refEnd: b.ref_end, compressedTokens: b.compressed_tokens, createdAt: b.created_at }));
      if (JSON.stringify(fingerprint) !== JSON.stringify(archive.blocks)) throw Error('History changed after planning');
      if (db.prepare('SELECT 1 FROM sources WHERE source_file=?').get(plan.destination) ||
          db.prepare('SELECT 1 FROM blocks WHERE source_file=?').get(plan.destination)) throw Error('History destination already indexed');
      db.prepare("UPDATE blocks SET source_file=?,kind='history' WHERE source_file=?").run(plan.destination,plan.sourceFile);
      db.prepare("UPDATE sources SET source_file=?,kind='history',last_mtime_ms=0,last_size=0 WHERE source_file=?").run(plan.destination,plan.sourceFile);
      for (const table of ['block_tombstones','source_watermarks','memory_message_projects','memory_proxy_message_hashes']) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
          db.prepare(`UPDATE ${table} SET source_file=? WHERE source_file=?`).run(plan.destination,plan.sourceFile);
      }
      db.prepare('INSERT INTO memory_history_origins VALUES(?,?,?,?,?)').run(plan.destination,plan.sourceFile,plan.kind,plan.sha256,Number(plan.enabled));
    }
    db.exec('RELEASE memory_history_conversion');
  } catch (error) {
    db.exec('ROLLBACK TO memory_history_conversion'); db.exec('RELEASE memory_history_conversion'); throw error;
  }
}
