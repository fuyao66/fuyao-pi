import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { historyMatches, normalizeHistoryBlocks, type HistoryArchive, type HistoryBlock } from './history-archive.js';
import { readSourceFile } from './source-files.js';
import { assignBlockProjects, projectScope } from './project-scope.js';

const fields = ['id','block_id','run_id','tier','topic','summary','ref_start','ref_end','compressed_tokens','created_at','msg_ids'] as const;
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const hasTable = (db: any, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const historyBlock = (row: any): HistoryBlock => ({ blockId: row.block_id, runId: row.run_id,
  tier: row.tier, topic: row.topic, summary: row.summary, msgIds: row.msg_ids === null ? null : JSON.parse(row.msg_ids),
  refStart: row.ref_start, refEnd: row.ref_end, compressedTokens: row.compressed_tokens, createdAt: row.created_at });

/** One-time, append-only completion after legacy writers have retired. The caller
 * supplies a consistent, read-only legacy snapshot and explicitly approved sources.
 * Never replace the active destination DB, edit existing summaries or resurrect
 * pruned blocks. Publish a new immutable archive revision, retaining the old file. */
export async function completeHistoryMigration(legacy: any, destination: any, directory: string,
  approvedSources: ReadonlySet<string>): Promise<{ inserted: number; sources: number; ids: number[] }> {
  const origins = new Map<string, any>(destination.prepare('SELECT * FROM memory_history_origins').all()
    .map((row: any) => [row.original_file, row]));
  const grouped = new Map<string, any[]>();
  for (const row of legacy.prepare('SELECT * FROM blocks ORDER BY id').all()) {
    const origin = origins.get(row.source_file);
    if (!origin) throw Error('Legacy source was not included in the original migration');
    const existing = destination.prepare('SELECT * FROM blocks WHERE source_file=? AND block_id=?').get(origin.archive_file, row.block_id);
    if (existing) {
      if (fields.some(field => existing[field] !== row[field])) throw Error('Existing historical record differs; refusing to overwrite');
      continue;
    }
    if (!approvedSources.has(row.source_file)) throw Error('Missing history requires explicit source approval');
    if (destination.prepare('SELECT 1 FROM blocks WHERE id=?').get(row.id)) throw Error('Historical row ID collision; refusing to overwrite');
    if (destination.prepare('SELECT 1 FROM block_tombstones WHERE source_file=? AND block_id=?').get(origin.archive_file,row.block_id))
      throw Error('Historical block was pruned; refusing to resurrect');
    const rows = grouped.get(row.source_file) ?? []; rows.push(row); grouped.set(row.source_file, rows);
  }
  if (!grouped.size) return { inserted: 0, sources: 0, ids: [] };
  const plans = [];
  for (const [source, rows] of grouped) {
    const origin = origins.get(source);
    const previous = destination.prepare('SELECT * FROM blocks WHERE source_file=? ORDER BY id').all(origin.archive_file);
    const { body } = await readSourceFile(origin.archive_file);
    if (!historyMatches(body, origin)) throw Error('Registered history archive hash mismatch');
    const archive = JSON.parse(body) as HistoryArchive;
    if (!normalizeHistoryBlocks(archive) || archive.origin.sourceFile !== source || archive.origin.kind !== origin.original_kind)
      throw Error('Invalid history archive identity');
    // No source-level authorization widening over previously disabled content.
    if (!origin.enabled && archive.blocks.length) throw Error('Disabled nonempty archive requires separate policy review');
    const content = JSON.stringify({ ...archive, blocks: [...archive.blocks, ...rows.map(historyBlock)] }) + '\n';
    if (!normalizeHistoryBlocks(JSON.parse(content))) throw Error('Invalid completed history archive');
    const sha256 = hash(content);
    const file = join(resolve(directory), `${hash(source)}-${sha256}.json`);
    await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
    const temp = `${file}.tmp-${randomUUID()}`;
    try {
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      try { await link(temp, file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      if (hash((await readSourceFile(file)).body) !== sha256) throw Error('Completed archive publication conflict');
      const dir = await open(resolve(directory), 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    } finally { await unlink(temp).catch(() => {}); }
    plans.push({ source, rows, origin, file, sha256, previous });
  }
  // The only destination write phase: short transaction, leaves new BC records
  // untouched. A concurrent prune/change makes validation fail rather than undo it.
  destination.exec('SAVEPOINT memory_tail_completion');
  try {
    for (const plan of plans) {
      const { source, rows, origin, file, sha256, previous } = plan;
      const now = destination.prepare('SELECT * FROM memory_history_origins WHERE original_file=?').get(source);
      if (JSON.stringify(now) !== JSON.stringify(origin)) throw Error('History registration changed during completion');
      const current = destination.prepare('SELECT * FROM blocks WHERE source_file=? ORDER BY id').all(origin.archive_file);
      if (JSON.stringify(current) !== JSON.stringify(previous)) throw Error('Historical records changed during completion');
      if (destination.prepare('SELECT 1 FROM sources WHERE source_file=?').get(file) ||
          destination.prepare('SELECT 1 FROM blocks WHERE source_file=?').get(file)) throw Error('History revision already indexed');
      for (const row of rows) {
        if (destination.prepare('SELECT 1 FROM blocks WHERE id=? OR (source_file=? AND block_id=?)').get(row.id,origin.archive_file,row.block_id))
          throw Error('Historical row changed during completion');
        if (destination.prepare('SELECT 1 FROM block_tombstones WHERE source_file=? AND block_id=?').get(origin.archive_file,row.block_id))
          throw Error('Historical block was pruned; refusing to resurrect');
      }
      destination.prepare('UPDATE sources SET source_file=?,last_mtime_ms=0,last_size=0 WHERE source_file=?').run(file,origin.archive_file);
      destination.prepare('UPDATE blocks SET source_file=? WHERE source_file=?').run(file,origin.archive_file);
      for (const table of ['block_tombstones','source_watermarks','memory_message_projects','memory_proxy_message_hashes']) {
        if (hasTable(destination, table)) destination.prepare(`UPDATE ${table} SET source_file=? WHERE source_file=?`).run(file,origin.archive_file);
      }
      destination.prepare('UPDATE memory_history_origins SET archive_file=?,sha256=?,enabled=1 WHERE original_file=?').run(file,sha256,source);
      for (const row of rows) {
        destination.prepare(`INSERT INTO blocks(id,source_file,kind,block_id,run_id,tier,topic,summary,ref_start,ref_end,compressed_tokens,created_at,msg_ids)
          VALUES(?,?,'history',?,?,?,?,?,?,?,?,?,?)`).run(row.id,file,row.block_id,row.run_id,row.tier,row.topic,row.summary,
            row.ref_start,row.ref_end,row.compressed_tokens,row.created_at,row.msg_ids);
        if (hasTable(legacy,'memory_vectors')) {
          for (const vector of legacy.prepare('SELECT * FROM memory_vectors WHERE block_id=?').all(row.id)) {
            destination.prepare('INSERT INTO memory_vectors(block_id,namespace,input_hash,dimensions,vector,truncated) VALUES(?,?,?,?,?,?)')
              .run(vector.block_id,vector.namespace,vector.input_hash,vector.dimensions,vector.vector,vector.truncated);
          }
        }
        const refs: string[] = JSON.parse(row.msg_ids ?? '[]');
        if (hasTable(legacy,'memory_message_projects')) {
          for (const ref of new Set(refs.map(id => id.split('#')[0]))) {
            const evidence = legacy.prepare('SELECT project_id FROM memory_message_projects WHERE source_file=? AND message_id=?').get(source,ref);
            if (!evidence) continue;
            const previous = destination.prepare('SELECT project_id FROM memory_message_projects WHERE source_file=? AND message_id=?').get(file,ref);
            if (previous && previous.project_id !== evidence.project_id) throw Error('Conflicting historical message project evidence');
            destination.prepare('INSERT OR IGNORE INTO memory_message_projects VALUES(?,?,?)').run(file,ref,evidence.project_id);
          }
        }
        if (hasTable(legacy,'memory_block_projects')) {
          const proof = legacy.prepare("SELECT project_id FROM memory_block_projects WHERE block_id=? AND state='known' AND project_id IS NOT NULL").get(row.id);
          if (proof) {
            const lookup = destination.prepare('SELECT project_id FROM memory_message_projects WHERE source_file=? AND message_id=?');
            if (refs.some(ref => {
              const evidence = lookup.get(file,ref.split('#')[0]);
              return evidence?.project_id && evidence.project_id !== proof.project_id;
            })) throw Error('Conflicting historical block project evidence');
            destination.prepare('INSERT INTO memory_project_legacy_proofs VALUES(?,?,?,?)').run(row.id,proof.project_id,row.summary,row.msg_ids);
          }
        }
      }
      assignBlockProjects(destination,file);
      for (const row of rows) {
        if (hasTable(legacy,'memory_block_project_links')) {
          for (const evidence of legacy.prepare('SELECT * FROM memory_block_project_links WHERE block_id=?').all(row.id))
            destination.prepare('INSERT OR IGNORE INTO memory_block_project_links VALUES(?,?,?)').run(row.id,evidence.project_id,evidence.basis);
        }
        if (!destination.prepare('SELECT 1 FROM memory_block_project_links WHERE block_id=?').get(row.id)) {
          const cwd = destination.prepare('SELECT cwd FROM sources WHERE source_file=?').get(file)?.cwd;
          if (typeof cwd === 'string' && cwd.startsWith('/')) {
            const scope = projectScope(cwd);
            if (scope.id) destination.prepare("INSERT OR IGNORE INTO memory_block_project_links VALUES(?,?,'session-directory')").run(row.id,scope.id);
          }
        }
      }
    }
    destination.exec('RELEASE memory_tail_completion');
  } catch (error) {
    destination.exec('ROLLBACK TO memory_tail_completion'); destination.exec('RELEASE memory_tail_completion'); throw error;
  }
  return { inserted: [...grouped.values()].reduce((n,rows) => n + rows.length,0), sources: plans.length,
    ids: [...grouped.values()].flat().map(row => row.id) };
}
