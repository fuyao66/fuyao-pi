import { createHash } from 'node:crypto';
import path from 'node:path';
import { realpathSync } from 'node:fs';

export interface WorkspaceIdentity { mode: 'local' | 'remote' | 'unavailable'; generation?: number; target?: string; port?: number; root?: string }
export interface ProjectScope { id: string | null; stamp: string; label: string }
export function projectScope(cwd: string, workspace?: WorkspaceIdentity): ProjectScope {
  const mode = workspace?.mode ?? 'local';
  let key: unknown;
  let root = cwd;
  if (mode === 'local') {
    root = path.resolve(cwd);
    try { root = realpathSync(root); } catch { /* Path identity still separates nonexisting roots. */ }
    key = ['local', root];
  } else if (mode === 'remote' && workspace?.target && workspace.root?.startsWith('/')) {
    root = path.posix.normalize(workspace.root);
    key = ['ssh', workspace.target, workspace.port ?? 22, root];
  } else return { id: null, stamp: JSON.stringify(workspace ?? {}), label: 'Unknown workspace' };
  const id = createHash('sha256').update(JSON.stringify(key)).digest('hex');
  return { id, stamp: JSON.stringify([id, workspace?.generation ?? 0]), label: path.basename(root) };
}
export function readProjectScope(pi: { events?: { emit: (channel: string, message: unknown) => void } }, cwd: string): ProjectScope {
  let workspace: WorkspaceIdentity | undefined;
  pi.events?.emit('fuyao:workspace-identity', { accept: (value: WorkspaceIdentity) => { workspace = value; } });
  return projectScope(cwd, workspace);
}
export function ensureProjectSchema(db: any): void {
  db.exec(`CREATE TABLE IF NOT EXISTS memory_message_projects (
    source_file TEXT NOT NULL, message_id TEXT NOT NULL, project_id TEXT,
    PRIMARY KEY(source_file,message_id));
    CREATE TABLE IF NOT EXISTS memory_block_projects (
    block_id INTEGER PRIMARY KEY, project_id TEXT, state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS memory_block_project_id ON memory_block_projects(project_id);
    CREATE TRIGGER IF NOT EXISTS memory_project_delete AFTER DELETE ON blocks BEGIN
      DELETE FROM memory_block_projects WHERE block_id=old.id;
    END;`);
}
/** Evidence is write-once: reopening a session must never relabel its old messages. */
export function recordMessageProjects(db: any, file: string, ids: string[], project: string | null): void {
  const insert = db.prepare('INSERT OR IGNORE INTO memory_message_projects VALUES(?,?,?)');
  db.exec('BEGIN');
  try { for (const id of ids) insert.run(file, id, project); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function assignBlockProjects(db: any, file: string): void {
  const lookup = db.prepare('SELECT project_id FROM memory_message_projects WHERE source_file=? AND message_id=?');
  const put = db.prepare('INSERT OR REPLACE INTO memory_block_projects VALUES(?,?,?)');
  for (const row of db.prepare('SELECT id,msg_ids FROM blocks WHERE source_file=?').all(file)) {
    let ids: string[] = []; try { ids = JSON.parse(row.msg_ids ?? '[]'); } catch { /* Legacy unknown. */ }
    // Expansion references are capped at 4000 by the importer. At the cap we
    // cannot prove completeness; do not infer a project from a partial prefix.
    if (!Array.isArray(ids) || ids.length >= 4000 || ids.some(id => typeof id !== 'string')) ids = [];
    const projects = ids.map(id => lookup.get(file, id.split('#')[0])?.project_id ?? null);
    const known = new Set(projects.filter(Boolean));
    const state = known.size > 1 ? 'mixed' : ids.length && projects.every(Boolean) ? 'known' : 'unknown';
    put.run(row.id, state === 'known' ? projects[0] : null, state);
  }
}
export function scopeAllowedIds(db: any, allowed: number[], scope: ProjectScope, all: boolean): number[] {
  if (all) return allowed;
  if (!scope.id) return [];
  const known = new Set<number>(db.prepare('SELECT block_id FROM memory_block_projects WHERE project_id=? AND state=\'known\'').all(scope.id).map((r: any) => r.block_id));
  return allowed.filter(id => known.has(id));
}
