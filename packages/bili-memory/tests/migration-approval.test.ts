import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyHistoryApproval } from '../src/migration-approval.js';
import type { ArchivePlan } from '../src/history-archive.js';
const plan = (sourceFile = '/old/one'): ArchivePlan => ({ sourceFile, destination: '/new/one', kind: 'pi', sha256: 'a'.repeat(64), content: '{}', count: 2, enabled: false });
const entry = { sourceFile: '/old/one', sha256: 'a'.repeat(64), count: 2 };
const approval = (sources: unknown[]) => ({ format: 'bili-memory-history-approval', version: 1, sources });
test('explicit history approval enables exact stored revisions, not future path contents or other sources', () => {
 const plans = [plan(), plan('/old/two')];
 assert.equal(applyHistoryApproval(plans, approval([entry])), 2);
 assert.equal(plans[0].enabled, true);assert.equal(plans[1].enabled, false);
 assert.equal(applyHistoryApproval(plans, approval([entry])), 0);
 for (const bad of [{...entry,sha256:'b'.repeat(64)}, {...entry,count:3}, {...entry,sourceFile:'/old/missing'}]) {
  assert.throws(()=>applyHistoryApproval([plan()],approval([bad])),/changed or is missing/);
 }
});
test('approval validation is atomic and rejects duplicates and unsupported formats', () => {
 for (const value of [approval([entry,entry]),approval([entry,{...entry,sourceFile:'/missing'}]),{...approval([]),version:2},null]) {
  const plans=[plan()];assert.throws(()=>applyHistoryApproval(plans,value));assert.equal(plans[0].enabled,false);
 }
});
