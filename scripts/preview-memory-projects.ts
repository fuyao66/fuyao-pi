import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, chmod, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { migrateProjectAssociations } from '../packages/bili-memory/src/project-migration.js';

// Read-only input + SQLite online backup includes committed WAL records. Never
// copy the database file alone while the running extension may still be writing.
const input = process.argv[2];
if (!input) throw new Error('Usage: node --import tsx scripts/preview-memory-projects.ts <existing-db>');
const dir = await mkdtemp(join(tmpdir(), 'bili-memory-project-preview-'));
await chmod(dir, 0o700);
const original = new DatabaseSync(resolve(input), { readOnly: true });
try { await backup(original, join(dir, 'preview.sqlite')); } finally { original.close(); }
await chmod(join(dir, 'preview.sqlite'), 0o600);
const db = new DatabaseSync(join(dir, 'preview.sqlite'));
function fingerprint(table: string, order: string) {
  const h = createHash('sha256'); let count = 0;
  for (const row of db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).iterate()) {
    h.update(JSON.stringify(row)); h.update('\n'); count++;
  }
  return { count, sha256: h.digest('hex') };
}
const preserved = () => Object.fromEntries([
  ['blocks','id'], ['memory_vectors','block_id,namespace'], ['sources','source_file'],
  ['block_tombstones','source_file,block_id'], ['memory_message_projects','source_file,message_id'],
].map(([table,order])=>[table,fingerprint(table,order)]));
try {
  const before = preserved();
  const previous = db.prepare("SELECT coalesce(p.state,'unrecorded') AS state,count(*) AS blocks FROM blocks b LEFT JOIN memory_block_projects p ON p.block_id=b.id GROUP BY 1").all();
  migrateProjectAssociations(db);
  assert.deepEqual(preserved(),before,'Migration changed protected data');
  const links = fingerprint('memory_block_project_links','block_id,project_id,basis');
  migrateProjectAssociations(db);
  assert.deepEqual(fingerprint('memory_block_project_links','block_id,project_id,basis'),links,'Migration is not idempotent');
  assert.deepEqual(preserved(),before);
  const after = db.prepare(`SELECT CASE
    WHEN (SELECT count(*) FROM memory_block_project_links p WHERE p.block_id=b.id AND basis='messages')>1 THEN 'multiple-projects'
    WHEN EXISTS(SELECT 1 FROM memory_block_project_links p WHERE p.block_id=b.id AND basis='messages')
      AND EXISTS(SELECT 1 FROM memory_block_projects p WHERE p.block_id=b.id AND p.state='known') THEN 'complete-single-project'
    WHEN EXISTS(SELECT 1 FROM memory_block_project_links p WHERE p.block_id=b.id AND basis='messages') THEN 'partial-project-evidence'
    WHEN EXISTS(SELECT 1 FROM memory_block_project_links p WHERE p.block_id=b.id AND basis='session-directory') THEN 'directory-clue'
    ELSE 'no-evidence' END AS attribution,count(*) AS blocks FROM blocks b GROUP BY 1`).all();
  const report = { input: resolve(input), dryRun: true, before: previous, after, preserved: before, idempotent: true,
    note: 'Existing stored evidence only. SSH journal reconstruction has not been performed. No production writes or embedding calls.' };
  await writeFile(join(dir,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({directory:dir,...report},null,2));
} finally { db.close(); }
