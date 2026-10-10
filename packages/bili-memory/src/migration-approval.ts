import type { ArchivePlan } from './history-archive.js';

export interface HistoryApproval {
  format: 'bili-memory-history-approval';
  version: 1;
  sources: Array<{ sourceFile: string; sha256: string; count: number }>;
}

/** One-time consent binds an entire immutable source revision, not a path glob.
 * A changed source must be reviewed again, even when its pathname is unchanged.
 * Validate all entries before modifying any plan. */
export function applyHistoryApproval(plans: ArchivePlan[], value: unknown): number {
  if (!value || typeof value !== 'object') throw new Error('Invalid history approval');
  const doc = value as HistoryApproval;
  if (doc.format !== 'bili-memory-history-approval' || doc.version !== 1 || !Array.isArray(doc.sources)) {
    throw new Error('Unsupported history approval');
  }
  const bySource = new Map(plans.map(plan => [plan.sourceFile, plan]));
  const approved: ArchivePlan[] = [];
  const seen = new Set<string>();
  for (const item of doc.sources) {
    if (!item || typeof item.sourceFile !== 'string' || !item.sourceFile || seen.has(item.sourceFile) ||
        typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !Number.isSafeInteger(item.count) || item.count <= 0) throw new Error('Invalid or duplicate history approval entry');
    seen.add(item.sourceFile);
    const plan = bySource.get(item.sourceFile);
    if (!plan || plan.sha256 !== item.sha256 || plan.count !== item.count) {
      throw new Error('Approved history changed or is missing; review before migration');
    }
    approved.push(plan);
  }
  let enabled = 0;
  for (const plan of approved) {
    if (!plan.enabled) enabled += plan.count;
    plan.enabled = true;
  }
  return enabled;
}
