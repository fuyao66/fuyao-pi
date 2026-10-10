import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { chmod, mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { planHistoryArchives } from '../src/history-archive.js';
import { applyHistoryApproval } from '../src/migration-approval.js';
import { completeHistoryMigration } from '../src/migration-tail.js';

// Append-only tail completion, not a replacement for initial preparation. All
// legacy writers must have retired. Backups and a copied-DB rehearsal precede
// the brief live transaction. Consent is bound to exact legacy source revisions.
const [input, output, backupDirectory, approvalFile] = process.argv.slice(2);
if (!input || !output || !backupDirectory || !approvalFile) throw Error(
  'Usage: node --import tsx packages/bili-memory/scripts/complete-migration.ts <retired-old-db> <active-memory-directory> <fresh-backup-directory> <exact-history-approval.json>');
const source = resolve(input), root = resolve(output), directory = resolve(backupDirectory);
const destinationPath = join(root,'memory.sqlite');
if (source === destinationPath) throw Error('Legacy and destination DB must differ');
async function assertRetired(): Promise<void> {
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    let descriptors: string[];
    try { descriptors = await readdir(`/proc/${entry}/fd`); } catch { continue; }
    for (const fd of descriptors) {
      let file: string;
      try { file = await readlink(`/proc/${entry}/fd/${fd}`); } catch { continue; }
      if ([source,source+'-wal',source+'-shm'].includes(file)) throw Error(`Legacy DB is still open by process ${entry}`);
    }
  }
}
const fields = ['id','block_id','run_id','tier','topic','summary','ref_start','ref_end','compressed_tokens','created_at','msg_ids'];
const capture = (db: DatabaseSync) => ({
  rows: db.prepare('SELECT * FROM blocks ORDER BY id').all(),
  vectors: db.prepare('SELECT * FROM memory_vectors ORDER BY block_id,namespace').all(),
  links: db.prepare('SELECT * FROM memory_block_project_links ORDER BY block_id,project_id,basis').all(),
});
function verify(legacy: DatabaseSync, current: DatabaseSync, before: ReturnType<typeof capture>): void {
  const origins = new Map(current.prepare('SELECT * FROM memory_history_origins').all().map(r => [r.original_file,r]));
  for (const row of legacy.prepare('SELECT * FROM blocks ORDER BY id').all()) {
    const origin = origins.get(row.source_file);
    assert.ok(origin, 'Legacy source missing from history registrations');
    const actual = current.prepare('SELECT * FROM blocks WHERE id=?').get(row.id!);
    assert.ok(actual,'Legacy block missing from destination');
    for (const field of fields) assert.deepEqual(actual[field],row[field],`Legacy field differs: ${field}`);
    assert.equal(actual.source_file,origin.archive_file);assert.equal(actual.kind,'history');
  }
  for (const row of before.rows) {
    const actual = current.prepare('SELECT * FROM blocks WHERE id=?').get(row.id!);
    assert.ok(actual, 'Previously indexed block disappeared');
    // Historical archive identity may move; all other data is immutable here.
    if (row.kind === 'history') {
      for (const field of fields) assert.deepEqual(actual[field],row[field],`Existing field differs: ${field}`);
      assert.equal(actual.kind,'history');
    } else assert.deepEqual(actual,row,'New BC record changed');
  }
  for (const row of [...before.vectors,...legacy.prepare('SELECT * FROM memory_vectors ORDER BY block_id,namespace').all()]) {
    assert.deepEqual(current.prepare('SELECT * FROM memory_vectors WHERE block_id=? AND namespace=?').get(row.block_id!,row.namespace!),row,
      'Vector data changed or disappeared');
  }
  for (const row of before.links) assert.ok(current.prepare('SELECT 1 FROM memory_block_project_links WHERE block_id=? AND project_id=? AND basis=?')
    .get(row.block_id!,row.project_id!,row.basis!), 'Previously indexed project link disappeared');
  assert.equal(current.prepare('PRAGMA quick_check').get()?.quick_check,'ok');
}
await assertRetired();
await mkdir(directory,{mode:0o700}); // Exclusive: never overwrite a backup.
const old = new DatabaseSync(source,{readOnly:true});
const current = new DatabaseSync(destinationPath);
current.exec('PRAGMA busy_timeout=10000');
try {
  await backup(old,join(directory,'legacy-memory.sqlite'));
  await backup(current,join(directory,'destination-before.sqlite'));
  await chmod(join(directory,'legacy-memory.sqlite'),0o600);
  await chmod(join(directory,'destination-before.sqlite'),0o600);
  await writeFile(join(directory,'approval.json'),await readFile(resolve(approvalFile)),{mode:0o600,flag:'wx'});
  const snapshot = new DatabaseSync(join(directory,'legacy-memory.sqlite'),{readOnly:true});
  try {
    const plans = planHistoryArchives(snapshot,join(directory,'approval-preview'),new Set());
    const consent = JSON.parse(await readFile(join(directory,'approval.json'),'utf8'));
    applyHistoryApproval(plans,consent);
    const approved = new Set<string>(consent.sources.map((r: {sourceFile: string}) => r.sourceFile));
    await backup(current,join(directory,'rehearsal.sqlite'));
    await chmod(join(directory,'rehearsal.sqlite'),0o600);
    const rehearsal = new DatabaseSync(join(directory,'rehearsal.sqlite'));
    let preview;
    try {
      const before = capture(rehearsal);
      preview = await completeHistoryMigration(snapshot,rehearsal,join(directory,'rehearsal-history'),approved);
      verify(snapshot,rehearsal,before);
      assert.equal((await completeHistoryMigration(snapshot,rehearsal,join(directory,'rehearsal-history'),approved)).inserted,0,
        'Tail completion must be idempotent');
    } finally { rehearsal.close(); }
    await assertRetired();
    const before = capture(current);
    const result = await completeHistoryMigration(snapshot,current,join(root,'history'),approved);
    assert.deepEqual(result,preview,'Live completion differs from copied-DB rehearsal');
    verify(snapshot,current,before);
    const report = {completedAt:new Date().toISOString(),activated:true,source,directory:root,backupDirectory:directory,
      ...result, legacyBlocks:snapshot.prepare('SELECT count(*) AS n FROM blocks').get()?.n,
      historyBlocks:current.prepare("SELECT count(*) AS n FROM blocks WHERE kind='history'").get()?.n,
      preservedLegacyVectors:snapshot.prepare('SELECT count(*) AS n FROM memory_vectors').get()?.n,
      projectLinks:current.prepare('SELECT count(*) AS n FROM memory_block_project_links').get()?.n,
      verification:'All legacy rows, vector bytes and pre-existing destination rows/project links preserved; quick_check ok; copied-DB rehearsal idempotent',
      note:'No source DB/configuration writes or embedding calls. Old immutable archives retained. Exact source-revision approval does not authorize future legacy ingestion.'};
    await writeFile(join(directory,'completion-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log(JSON.stringify(report,null,2));
  } finally { snapshot.close(); }
} finally { old.close();current.close(); }
