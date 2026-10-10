import { ensureProjectSchema, assignBlockProjects, recordDirectoryHints } from './project-scope.js';

/** One-time association upgrade. Already-proven ownership takes precedence over
 * incomplete surviving message records. Never edits summaries, vectors or sources. */
export function migrateProjectAssociations(db: any): void {
  db.exec('SAVEPOINT memory_project_migration');
  try {
    ensureProjectSchema(db);
    const proven = db.prepare("SELECT block_id,project_id FROM memory_block_projects WHERE state='known' AND project_id IS NOT NULL").all();
    for (const row of db.prepare('SELECT DISTINCT source_file FROM blocks').all()) assignBlockProjects(db, row.source_file);
    for (const row of proven) {
      const inferred = db.prepare("SELECT project_id FROM memory_block_project_links WHERE block_id=? AND basis='messages'").all(row.block_id);
      if (inferred.some((p: any) => p.project_id !== row.project_id)) throw new Error('Conflicting historical project evidence; review before migrating');
      db.prepare(`INSERT OR REPLACE INTO memory_project_legacy_proofs(block_id,project_id,summary,msg_ids)
        SELECT id,?,summary,msg_ids FROM blocks WHERE id=?`).run(row.project_id,row.block_id);
      db.prepare("INSERT OR REPLACE INTO memory_block_projects VALUES(?,?,'known')").run(row.block_id,row.project_id);
      db.prepare("DELETE FROM memory_block_project_links WHERE block_id=? AND basis='session-directory'").run(row.block_id);
      db.prepare("INSERT OR IGNORE INTO memory_block_project_links VALUES(?,?,'messages')").run(row.block_id,row.project_id);
    }
    recordDirectoryHints(db);
    db.exec('RELEASE memory_project_migration');
  } catch (error) {
    db.exec('ROLLBACK TO memory_project_migration'); db.exec('RELEASE memory_project_migration'); throw error;
  }
}
