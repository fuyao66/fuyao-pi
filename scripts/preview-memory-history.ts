import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, chmod, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { migrateProjectAssociations } from '../packages/bili-memory/src/project-migration.js';
import { planHistoryArchives, applyHistoryArchives } from '../packages/bili-memory/src/history-archive.js';

// Offline rehearsal only. Do not infer upload permission from the existence of a
// row: archives remain disabled until the cutover checks original source policy.
const input = process.argv[2];
if (!input) throw Error('Usage: node --import tsx scripts/preview-memory-history.ts <existing-db>');
const root = await mkdtemp(join(tmpdir(), 'bili-memory-history-preview-'));
await chmod(root, 0o700);
const original = new DatabaseSync(resolve(input), { readOnly: true });
try { await backup(original, join(root, 'memory.sqlite')); } finally { original.close(); }
await chmod(join(root, 'memory.sqlite'), 0o600);
const db = new DatabaseSync(join(root, 'memory.sqlite'));
function fingerprint(sql: string) {
 const hash = createHash('sha256'); let count = 0;
 for (const row of db.prepare(sql).iterate()) { hash.update(JSON.stringify(row)); hash.update('\n'); count++; }
 return { count, sha256: hash.digest('hex') };
}
const protectedData = () => ({
 blocks: fingerprint('SELECT id,block_id,run_id,tier,topic,summary,ref_start,ref_end,compressed_tokens,created_at,msg_ids FROM blocks ORDER BY id'),
 vectors: db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_vectors'").get()
   ? fingerprint('SELECT * FROM memory_vectors ORDER BY block_id,namespace') : { absent: true, count: 0 },
 projects: fingerprint('SELECT * FROM memory_block_project_links ORDER BY block_id,project_id,basis'),
 tombstones: fingerprint('SELECT block_id,pruned_at FROM block_tombstones ORDER BY block_id,pruned_at'),
});
try {
 migrateProjectAssociations(db);
 const before = protectedData();
 const plans = planHistoryArchives(db, join(root, 'history'), new Set());
 await applyHistoryArchives(db, plans);
 assert.deepEqual(protectedData(), before, 'Protected history changed');
 await applyHistoryArchives(db, plans);
 assert.deepEqual(protectedData(), before, 'Repeated conversion changed history');
 assert.equal(planHistoryArchives(db, join(root, 'history'), new Set()).length, 0);
 assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_integrity_check WHERE integrity_check!='ok'").get()!.n, 0);
 const report = { dryRun: true, directory: root, source: resolve(input), archives: plans.length,
   preserved: before, idempotent: true, archiveAuthorization: 'disabled pending cutover policy check',
   note: 'Only the SQLite online backup was modified. No production configuration, sources, vectors or API calls changed.' };
 await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2)+'\n', { mode: 0o600 });
 console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
