import { createHash } from 'node:crypto';

/** Internal oversampling is bounded; the public tool still returns at most 20 hits. */
export const CANDIDATE_LIMIT = 100;
export const MAX_ALTERNATIVES = 8;
export function contentKey(row: any): string {
  return createHash('sha256').update(JSON.stringify([row.topic ?? null, row.summary ?? ''])).digest('hex');
}
export function members(row: any): any[] { return [row, ...(row.alternatives ?? [])]; }
const preference = (row: any): number => row.kind === 'bili' ? row.active === 1 ? 3 : row.active === 0 ? 1 : 2 : 0;

/** Only call AFTER source and workspace authorization. Exact content copies are
 * one hit, with authorized alternative receipts. Different summaries/topics are
 * never collapsed just because they share a block ID, project or embedding. */
export function distinctRows(rows: readonly any[], limit: number): any[] {
  const groups = new Map<string, any[]>();
  for (const row of rows) for (const item of members(row)) {
    const key = contentKey(item); const group = groups.get(key) ?? [];
    if (!group.some(old => old.id === item.id) && group.length < MAX_ALTERNATIVES + 1) group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].slice(0, limit).map(group => {
    group.sort((a,b) => preference(b) - preference(a) || a.id - b.id);
    const [first, ...rest] = group;
    const clean = (r: any) => { const { alternatives: _ignored, ...value } = r; return value; };
    return { ...clean(first), ...(rest.length ? { alternatives: rest.map(clean) } : {}) };
  });
}

/** Rank distinct content per retrieval route, not individual migration copies.
 * At most one RRF contribution per route/content. Diversify directly related BC
 * parent/child hits only when other relevant candidates exist; details are kept. */
export function fuseDistinct(lexical: any[], semantic: any[], limit: number): any[] {
  const candidates = new Map<string, { rows: any[]; score: number; order: number }>();
  for (const list of [lexical, semantic]) distinctRows(list, CANDIDATE_LIMIT).forEach((row, index) => {
    const key = contentKey(row); const old = candidates.get(key);
    candidates.set(key, { rows: [...(old?.rows ?? []), row], score: (old?.score ?? 0) + 1 / (60 + index + 1), order: old?.order ?? candidates.size });
  });
  const ranked = [...candidates.values()].sort((a,b) => b.score-a.score || a.order-b.order)
    .map(group => distinctRows(group.rows, 1)[0]);
  const selected: any[] = [], deferred: any[] = [];
  for (const row of ranked) {
    const related = selected.some(old => members(old).some(a => members(row).some(b => {
      if (a.kind !== 'bili' || b.kind !== 'bili' || a.sourceFile !== b.sourceFile || a.sessionId !== b.sessionId) return false;
      const children = (r: any): string[] => { try { return JSON.parse(r.directBlockIds ?? '[]'); } catch { return []; } };
      return children(a).includes(b.blockId) || children(b).includes(a.blockId);
    })));
    (related ? deferred : selected).push(row);
  }
  return [...selected, ...deferred].slice(0, limit);
}

/** Reauthorize every receipt, then promote a surviving representative. Never
 * retain an alternative merely because the group's former primary was allowed. */
export function authorizedGroups(rows: any[], allowed: (row: any) => boolean, limit: number): any[] {
  return distinctRows(rows.flatMap(row => members(row).filter(allowed).map(item => ({ ...item, alternatives: undefined }))), limit);
}
