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
    END;
    CREATE TABLE IF NOT EXISTS memory_block_project_links (
      block_id INTEGER NOT NULL, project_id TEXT NOT NULL,
      basis TEXT NOT NULL CHECK(basis IN ('messages','session-directory')),
      PRIMARY KEY(block_id,project_id,basis));
    CREATE INDEX IF NOT EXISTS memory_project_links_lookup ON memory_block_project_links(project_id,basis,block_id);
    CREATE TRIGGER IF NOT EXISTS memory_project_links_delete AFTER DELETE ON blocks BEGIN
      DELETE FROM memory_block_project_links WHERE block_id=old.id;
    END;
    CREATE TABLE IF NOT EXISTS memory_proxy_message_hashes (
      source_file TEXT NOT NULL, message_id TEXT NOT NULL, identity_hash TEXT NOT NULL,
      PRIMARY KEY(source_file,message_id));
    CREATE TABLE IF NOT EXISTS memory_project_legacy_proofs (
      block_id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, summary TEXT NOT NULL, msg_ids TEXT);
    CREATE TRIGGER IF NOT EXISTS memory_legacy_proof_delete AFTER DELETE ON blocks BEGIN
      DELETE FROM memory_project_legacy_proofs WHERE block_id=old.id;
    END;
    CREATE TABLE IF NOT EXISTS memory_workspace_intervals (
      id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL, project_id TEXT,
      scope_stamp TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
      CHECK(ended_at IS NULL OR ended_at>=started_at));
    CREATE UNIQUE INDEX IF NOT EXISTS memory_workspace_open ON memory_workspace_intervals(conversation_id) WHERE ended_at IS NULL;
  `);
  // Preserve existing proven assignments before any re-scan; never fabricate evidence.
  db.exec(`INSERT OR IGNORE INTO memory_block_project_links(block_id,project_id,basis)
    SELECT p.block_id,p.project_id,'messages' FROM memory_block_projects p
    JOIN blocks b ON b.id=p.block_id WHERE p.state='known' AND p.project_id IS NOT NULL`);
}
/** Evidence is write-once: reopening a session must never relabel its old messages. */
export function recordMessageProjects(db: any, file: string, ids: string[], project: string | null): void {
  const insert = db.prepare('INSERT OR IGNORE INTO memory_message_projects VALUES(?,?,?)');
  db.exec('BEGIN');
  try { for (const id of ids) insert.run(file, id, project); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
/** Proxy evidence is revision-bound. A reused identity with different content
 * revokes the previous proof; an unknown observation cannot promote an old id. */
export function recordBiliMessageProjects(db: any, file: string,
  rows: ReadonlyArray<{ rawId: string; identityHash: string; projectId: string | null }>): void {
  db.exec('SAVEPOINT memory_proxy_evidence');
  try {
    const get = db.prepare('SELECT identity_hash FROM memory_proxy_message_hashes WHERE source_file=? AND message_id=?');
    const hash = db.prepare('INSERT OR REPLACE INTO memory_proxy_message_hashes VALUES(?,?,?)');
    const put = db.prepare('INSERT OR IGNORE INTO memory_message_projects VALUES(?,?,?)');
    for (const row of rows) {
      const previous = get.get(file, row.rawId);
      if (previous && previous.identity_hash !== row.identityHash) {
        db.prepare('UPDATE memory_message_projects SET project_id=NULL WHERE source_file=? AND message_id=?').run(file, row.rawId);
        // Imported proofs are only for historical records, never a license to
        // retain a proof after observing a content-identity conflict.
        db.prepare(`DELETE FROM memory_project_legacy_proofs WHERE block_id IN
          (SELECT b.id FROM blocks b, json_each(CASE WHEN json_valid(b.msg_ids) THEN b.msg_ids ELSE '[]' END) j
           WHERE b.source_file=? AND (j.value=? OR j.value LIKE ? ESCAPE '\\'))`)
          .run(file, row.rawId, row.rawId.replace(/[\\%_]/g, m => '\\' + m) + '#%');
      }
      put.run(file, row.rawId, previous && previous.identity_hash !== row.identityHash ? null : row.projectId);
      hash.run(file, row.rawId, row.identityHash);
    }
    assignBlockProjects(db, file);
    db.exec('RELEASE memory_proxy_evidence');
  } catch (error) {
    db.exec('ROLLBACK TO memory_proxy_evidence'); db.exec('RELEASE memory_proxy_evidence'); throw error;
  }
}
export function assignBlockProjects(db: any, file: string): void {
  const lookup = db.prepare('SELECT project_id FROM memory_message_projects WHERE source_file=? AND message_id=?');
  const put = db.prepare('INSERT OR REPLACE INTO memory_block_projects VALUES(?,?,?)');
  for (const row of db.prepare('SELECT id,msg_ids,summary FROM blocks WHERE source_file=?').all(file)) {
    db.prepare('DELETE FROM memory_project_legacy_proofs WHERE block_id=? AND (summary IS NOT ? OR msg_ids IS NOT ?)').run(row.id, row.summary, row.msg_ids);
    let ids: string[] = []; try { ids = JSON.parse(row.msg_ids ?? '[]'); } catch { /* Legacy unknown. */ }
    // Expansion references are capped at 4000 by the importer. At the cap we
    // cannot prove completeness; do not infer a project from a partial prefix.
    if (!Array.isArray(ids) || ids.length >= 4000 || ids.some(id => typeof id !== 'string')) ids = [];
    const projects = ids.map(id => lookup.get(file, id.split('#')[0])?.project_id ?? null);
    const known = new Set(projects.filter(Boolean));
    const proof = db.prepare('SELECT project_id FROM memory_project_legacy_proofs WHERE block_id=?').get(row.id);
    // Missing old per-message rows do not negate a retained, revision-bound proof.
    // Positive conflicting evidence does: never prefer migration metadata to it.
    const retained = proof && [...known].every(project => project === proof.project_id);
    if (proof && !retained) db.prepare('DELETE FROM memory_project_legacy_proofs WHERE block_id=?').run(row.id);
    if (retained) known.add(proof.project_id);
    const state = known.size > 1 ? 'mixed' : retained || (ids.length && projects.every(Boolean)) ? 'known' : 'unknown';
    put.run(row.id, state === 'known' ? [...known][0] : null, state);
    db.prepare("DELETE FROM memory_block_project_links WHERE block_id=? AND basis='messages'").run(row.id);
    const link = db.prepare("INSERT OR IGNORE INTO memory_block_project_links VALUES(?,?,'messages')");
    // An association means the summary contains this project's messages, not
    // that all its messages belong exclusively to that project. Preserve proven
    // subsets even when another interval is unknown; state retains completeness.
    if (known.size > 0) {
      db.prepare("DELETE FROM memory_block_project_links WHERE block_id=? AND basis='session-directory'").run(row.id);
      for (const project of known) link.run(row.id, project);
    }
  }
}

/** Session cwd is a historical clue, not an assertion about an SSH workspace.
 * Only used by the one-time migration; callers must label fallback hits. */
export function recordDirectoryHints(db: any): void {
  const link = db.prepare("INSERT OR IGNORE INTO memory_block_project_links VALUES(?,?,'session-directory')");
  for (const row of db.prepare(`SELECT b.id,s.cwd FROM blocks b JOIN sources s ON s.source_file=b.source_file
    WHERE NOT EXISTS(SELECT 1 FROM memory_block_project_links p WHERE p.block_id=b.id AND p.basis='messages')`).all()) {
    if (typeof row.cwd !== 'string' || !path.isAbsolute(row.cwd)) continue;
    const scope = projectScope(row.cwd);
    if (scope.id) link.run(row.id, scope.id);
  }
}

/** Persist workspace transitions independently of proxy availability. No raw
 * messages or credentials are stored here. A restart opens a new interval. */
export function recordWorkspaceInterval(db: any, conversationId: string, scope: ProjectScope, at = Date.now(), restart = false): void {
  if (!conversationId || !Number.isSafeInteger(at)) throw new Error('Invalid workspace observation');
  const open = db.prepare('SELECT id,scope_stamp,started_at FROM memory_workspace_intervals WHERE conversation_id=? AND ended_at IS NULL').get(conversationId);
  if (!restart && open?.scope_stamp === scope.stamp) return;
  const time = Math.max(at, open?.started_at ?? at);
  db.exec('SAVEPOINT memory_workspace_transition');
  try {
    if (open) db.prepare('UPDATE memory_workspace_intervals SET ended_at=? WHERE id=?').run(time, open.id);
    db.prepare('INSERT INTO memory_workspace_intervals(conversation_id,project_id,scope_stamp,started_at) VALUES(?,?,?,?)')
      .run(conversationId, scope.id, scope.stamp, time);
    db.exec('RELEASE memory_workspace_transition');
  } catch (error) {
    db.exec('ROLLBACK TO memory_workspace_transition'); db.exec('RELEASE memory_workspace_transition'); throw error;
  }
}

export function scopeDirectoryHintIds(db: any, allowed: number[], scope: ProjectScope): number[] {
  if (!scope.id) return [];
  const ids = new Set<number>(db.prepare("SELECT block_id FROM memory_block_project_links WHERE project_id=? AND basis='session-directory'").all(scope.id).map((r: any) => r.block_id));
  return allowed.filter(id => ids.has(id));
}
export function scopeAllowedIds(db: any, allowed: number[], scope: ProjectScope, all: boolean): number[] {
  if (all) return allowed;
  if (!scope.id) return [];
  const known = new Set<number>(db.prepare("SELECT block_id FROM memory_block_project_links WHERE project_id=? AND basis='messages'").all(scope.id).map((r: any) => r.block_id));
  return allowed.filter(id => known.has(id));
}
