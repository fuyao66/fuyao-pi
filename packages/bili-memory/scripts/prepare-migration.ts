import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { configureForTests, loadSqlite, getDb, buildSourcePolicy } from '../src/extension.js';
import { migrateProjectAssociations } from '../src/project-migration.js';
import { planHistoryArchives, applyHistoryArchives } from '../src/history-archive.js';
import { captureLegacySources } from '../src/migration-sources.js';
import { applyHistoryApproval } from '../src/migration-approval.js';

// Preparation only. Never activate this snapshot while the old host can still
// write new memories. Re-run into a fresh directory at the final offline cutover.
const [input, output, configFile, proxySessions, approvalFile, embeddingFile] = process.argv.slice(2);
if (!input || !output || !configFile || !proxySessions) throw Error(
  'Usage: node --import tsx packages/bili-memory/scripts/prepare-migration.ts <old-db> <new-directory> <old-config.json> <proxy-sessions-directory> [exact-history-approval.json] [old-embedding.json]');
const source = resolve(input), root = resolve(output);
const config = JSON.parse(await readFile(resolve(configFile), 'utf8'));
if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Expected configuration object');
const sourceRules = await captureLegacySources(config, homedir());
await mkdir(root, { mode: 0o700 }); // Exclusive preparation directory; never overwrite an old run.
const dbPath = join(root, 'memory.sqlite');
await writeFile(join(root, 'original-sources.jsonl'), sourceRules, { mode: 0o600, flag: 'wx' });
const original = new DatabaseSync(source, { readOnly: true });
try { await backup(original, dbPath); } finally { original.close(); }
await chmod(dbPath, 0o600);
await loadSqlite();
configureForTests({ ...config, legacyOffline: true, dbPath, sourcesPath: join(root, 'original-sources.jsonl'), logPath: join(root, 'preparation.log') });
const store = getDb(); store.open();
const db = store.db;
const fingerprint = (sql: string) => {
  const hash = createHash('sha256'); let count = 0;
  for (const row of db.prepare(sql).iterate()) { hash.update(JSON.stringify(row)); hash.update('\n'); count++; }
  return { count, sha256: hash.digest('hex') };
};
const protectedData = () => ({
  blocks: fingerprint('SELECT id,block_id,run_id,tier,topic,summary,ref_start,ref_end,compressed_tokens,created_at,msg_ids FROM blocks ORDER BY id'),
  vectors: db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_vectors'").get()
    ? fingerprint('SELECT * FROM memory_vectors ORDER BY block_id,namespace') : { count: 0, absent: true },
  projects: fingerprint('SELECT * FROM memory_block_project_links ORDER BY block_id,project_id,basis'),
  tombstones: fingerprint('SELECT block_id,pruned_at FROM block_tombstones ORDER BY block_id,pruned_at'),
});
try {
  const policy = await buildSourcePolicy();
  const allowed = new Set(policy.allowedIds);
  const grouped = new Map<string, number[]>();
  const states: Record<string, number> = {};
  for (const row of db.prepare('SELECT id,source_file FROM blocks ORDER BY id').all()) {
    const ids = grouped.get(row.source_file) ?? []; ids.push(row.id); grouped.set(row.source_file, ids);
    const state = policy.state(row.id); states[state] = (states[state] ?? 0) + 1;
  }
  // Archive permission is currently source-level. Never enable an entire archive
  // merely because one of its rows was allowed; report mixed-policy sources.
  const authorizedSources = new Set([...grouped].filter(([, ids]) => ids.length && ids.every(id => allowed.has(id))).map(([file]) => file));
  const mixedPolicySources = [...grouped.values()].filter(ids => ids.some(id => allowed.has(id)) && !ids.every(id => allowed.has(id))).length;
  migrateProjectAssociations(db);
  const before = protectedData();
  const plans = planHistoryArchives(db, join(root, 'history'), authorizedSources);
  const explicitlyEnabledBlocks = approvalFile
    ? applyHistoryApproval(plans, JSON.parse(await readFile(resolve(approvalFile), 'utf8'))) : 0;
  await applyHistoryArchives(db, plans);
  assert.deepEqual(protectedData(), before, 'Protected records changed during archive conversion');
  await applyHistoryArchives(db, plans);
  assert.deepEqual(protectedData(), before, 'Conversion is not idempotent');
  assert.equal(db.prepare("SELECT count(*) AS n FROM pragma_integrity_check WHERE integrity_check!='ok'").get().n, 0);
  const rules = [
    { id: 'billion-context', adapter: 'bili-session', root: resolve(proxySessions), pattern: '**/*.json', enabled: true },
    { id: 'migrated-history', adapter: 'memory-history', root: join(root, 'history'), pattern: '*.json', enabled: true },
  ];
  const newSources = join(root, 'sources.jsonl');
  await writeFile(newSources, rules.map(r => JSON.stringify(r)).join('\n')+'\n', { mode: 0o600, flag: 'wx' });
  await writeFile(join(root, 'config.json'), JSON.stringify({ ...config, dbPath, sourcesPath: newSources, logPath: join(root, 'memory.log') }, null, 2)+'\n', { mode: 0o600, flag: 'wx' });
  if (embeddingFile) {
    const text = await readFile(resolve(embeddingFile), 'utf8');
    const embedding = JSON.parse(text);
    if (!embedding || typeof embedding !== 'object' || Array.isArray(embedding)) throw Error('Invalid embedding configuration');
    // Preserve model/namespace and credential reference exactly. Never print credentials
    // or call the provider during migration. Source credential files stay untouched.
    await writeFile(join(root, 'embedding.json'), text, { mode: 0o600, flag: 'wx' });
  }
  const report = { preparedOnly: true, activated: false, source, directory: root,
    archives: plans.length, enabledArchives: plans.filter(p => p.enabled).length, embeddingConfigCopied: Boolean(embeddingFile),
    preserved: before, originalPolicyStates: states, mixedPolicySources, explicitlyEnabledBlocks,
    withheldPreviouslyAllowedBlocks: [...grouped].filter(([file]) => !plans.some(plan => plan.sourceFile === file && plan.enabled)).reduce((n, [, ids]) => n+ids.filter(id => allowed.has(id)).length, 0),
    note: 'No source DB/configuration writes or embedding calls. Sources not authorized by original policy or exact revision-bound approval remain archived but disabled. Mixed-policy sources require review before cutover. This snapshot can become stale while the old host runs.' };
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2)+'\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
} finally { store.close(); }
