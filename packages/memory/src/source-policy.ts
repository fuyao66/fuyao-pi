import { createHash } from 'node:crypto';

export type PolicyState = 'allowed' | 'disabled/excluded' | 'missing/unreadable' | 'block-absent' | 'revision-stale';
export interface PolicyRow {
  id: number; sourceFile: string; kind: string; blockId: string;
  summary: string; topic?: string | null; msgIds?: string | null;
  refStart?: string | null; refEnd?: string | null;
}
/** Indexed, operation-local snapshot. Never share a mutable snapshot across awaits. */
let snapshotSequence = 0;
const snapshotWrites = new WeakMap<object, number>();
/** Ignore temporary authorization inserts when detecting concurrent store mutation. */
export function storeChanges(db: any): number {
  return db.prepare('SELECT total_changes() AS n').get().n - (snapshotWrites.get(db) ?? 0);
}
export function sqlAuthorization(db: any, allowedIds?: number[], rows?: PolicyRow[]): { sql: string; dispose(): void } {
  if (allowedIds === undefined && rows === undefined) return { sql: '1=1', dispose() {} };
  const table = `memory_policy_${++snapshotSequence}`;
  db.exec(`CREATE TEMP TABLE ${table}(id INTEGER PRIMARY KEY, sourceFile TEXT, kind TEXT, blockId TEXT,
    summary TEXT, topic TEXT, msgIds TEXT, refStart TEXT, refEnd TEXT)`);
  try {
    const insert = db.prepare(`INSERT OR REPLACE INTO ${table} VALUES(?,?,?,?,?,?,?,?,?)`);
    const put = { run(...values: any[]) {
      const result = insert.run(...values);
      snapshotWrites.set(db, (snapshotWrites.get(db) ?? 0) + Number(result.changes));
    } };
    const ids = allowedIds === undefined ? undefined : new Set(allowedIds);
    if (rows !== undefined) {
      for (const row of rows) if (!ids || ids.has(row.id)) put.run(row.id, row.sourceFile, row.kind, row.blockId,
        row.summary, row.topic ?? null, row.msgIds ?? null, row.refStart ?? null, row.refEnd ?? null);
    } else for (const id of ids ?? []) put.run(id, null, null, null, null, null, null, null, null);
    const revision = rows === undefined ? '' : ` AND policy.sourceFile=b.source_file AND policy.kind=b.kind
      AND policy.blockId=b.block_id AND policy.summary IS b.summary AND policy.topic IS b.topic
      AND policy.msgIds IS b.msg_ids AND policy.refStart IS b.ref_start AND policy.refEnd IS b.ref_end`;
    return { sql: `EXISTS (SELECT 1 FROM ${table} policy WHERE policy.id=b.id${revision})`,
      dispose() { db.exec(`DROP TABLE IF EXISTS ${table}`); } };
  } catch (error) { db.exec(`DROP TABLE IF EXISTS ${table}`); throw error; }
}
export type SourceDocument = { state: 'missing/unreadable' } | { state: 'loaded'; blocks: Map<string, Omit<PolicyRow, 'id' | 'sourceFile' | 'kind'>> };
export const sourceKey = (file: string, kind: string) => JSON.stringify([file, kind]);
export function revisionKey(row: Pick<PolicyRow, 'summary' | 'topic' | 'msgIds' | 'refStart' | 'refEnd'>): string {
  return createHash('sha256').update(JSON.stringify([row.summary, row.topic ?? null, row.msgIds ?? null, row.refStart ?? null, row.refEnd ?? null])).digest('hex');
}
/** Immutable operation snapshot. Inactive BCP children remain valid when present;
 * absence and revocation exclude operations but never delete stored history. */
export class SourcePolicy {
  readonly allowedIds: number[] = [];
  readonly authorizedRows: PolicyRow[] = [];
  private states = new Map<number, PolicyState>();
  private revisions = new Map<number, string>();
  constructor(rows: PolicyRow[], documents: Map<string, SourceDocument>, unavailable: Set<string> = new Set()) {
    for (const row of rows) {
      const key = sourceKey(row.sourceFile, row.kind);
      const document = documents.get(key);
      let state: PolicyState;
      if (!document) state = unavailable.has(key) ? 'missing/unreadable' : 'disabled/excluded';
      else if (document.state !== 'loaded') state = 'missing/unreadable';
      else {
        const block = document.blocks.get(row.blockId);
        state = !block ? 'block-absent' : revisionKey(block) !== revisionKey(row) ? 'revision-stale' : 'allowed';
      }
      this.states.set(row.id, state);
      if (state === 'allowed') { this.allowedIds.push(row.id); this.authorizedRows.push({ ...row }); this.revisions.set(row.id, JSON.stringify([row.sourceFile, row.kind, row.blockId, revisionKey(row)])); }
    }
  }
  state(id: number): PolicyState { return this.states.get(id) ?? 'disabled/excluded'; }
  allows(row: PolicyRow): boolean { return this.state(row.id) === 'allowed' && this.revisions.get(row.id) === JSON.stringify([row.sourceFile, row.kind, row.blockId, revisionKey(row)]); }
}
