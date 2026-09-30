import { createHash } from 'node:crypto';

export type PolicyState = 'allowed' | 'disabled/excluded' | 'missing/unreadable' | 'block-absent' | 'revision-stale';
export interface PolicyRow {
  id: number; sourceFile: string; kind: string; blockId: string;
  summary: string; topic?: string | null; msgIds?: string | null;
  refStart?: string | null; refEnd?: string | null;
}
export const authorizedSql = `EXISTS (SELECT 1 FROM json_each(?) policy WHERE
  json_extract(policy.value,'$.id')=b.id AND json_extract(policy.value,'$.sourceFile')=b.source_file
  AND json_extract(policy.value,'$.kind')=b.kind AND json_extract(policy.value,'$.blockId')=b.block_id
  AND json_extract(policy.value,'$.summary') IS b.summary AND json_extract(policy.value,'$.topic') IS b.topic
  AND json_extract(policy.value,'$.msgIds') IS b.msg_ids AND json_extract(policy.value,'$.refStart') IS b.ref_start
  AND json_extract(policy.value,'$.refEnd') IS b.ref_end)`;
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
