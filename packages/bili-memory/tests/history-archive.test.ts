import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSqlite, MemoryDb, configureForTests, buildSourcePolicy } from '../src/extension.js';
import { planHistoryArchives, applyHistoryArchives, normalizeHistoryBlocks } from '../src/history-archive.js';
import { ensureVectorSchema } from '../src/hybrid.js';
import { migrateProjectAssociations } from '../src/project-migration.js';

async function fixture() {
 const root=await mkdtemp(join(tmpdir(),'bili-history-'));await loadSqlite();
 configureForTests({legacyOffline:true,logPath:join(root,'log')});
 const db=new MemoryDb(join(root,'db'));db.open();ensureVectorSchema(db);
 const source=join(root,'old.acp.json');
 await writeFile(source,JSON.stringify({blocks:[{blockId:'b1',summary:'historical needle summary',effectiveMessageIds:['m1']}]}));
 await db.ingestSourceFile(source,{kind:'pi',cwd:root},true);
 const row=db.db.prepare('SELECT id FROM blocks').get();
 db.db.prepare("INSERT INTO memory_vectors VALUES(?,'fixture','hash',2,?,0)").run(row.id,Buffer.alloc(8));
 db.db.prepare("INSERT OR REPLACE INTO memory_block_projects VALUES(?,'old-project','known')").run(row.id);
 db.db.prepare("INSERT INTO block_tombstones VALUES(?,'deleted',1)").run(source);
 migrateProjectAssociations(db.db);
 return {root,db,source,id:row.id};
}
test('one-time archives preserve rows, vectors, tombstones, provenance and survive runtime rescan',async()=>{
 const {root,db,source,id}=await fixture();
 try {
  const before=db.db.prepare('SELECT * FROM memory_vectors').all();
  const plans=planHistoryArchives(db.db,join(root,'history'),new Set([source]));assert.equal(plans.length,1);
  assert.equal(plans[0].enabled,true);assert.equal(normalizeHistoryBlocks(JSON.parse(plans[0].content))?.length,1);
  await applyHistoryArchives(db.db,plans);await applyHistoryArchives(db.db,plans);
  assert.equal(planHistoryArchives(db.db,join(root,'history'),new Set([source])).length,0);
  const row=db.db.prepare('SELECT * FROM blocks').get();assert.equal(row.id,id);assert.equal(row.kind,'history');
  assert.equal(row.source_file,plans[0].destination);assert.equal(row.summary,'historical needle summary');
  assert.deepEqual(db.db.prepare('SELECT * FROM memory_vectors').all(),before);
  assert.equal(db.db.prepare('SELECT source_file FROM block_tombstones').get().source_file,plans[0].destination);
  assert.equal(db.db.prepare('SELECT original_file FROM memory_history_origins').get().original_file,source);
  await rm(source);
  configureForTests({maxSummaryChars:5});
  const res=await db.ingestSourceFile(plans[0].destination,{kind:'history'},true);assert.equal(res.ok,true);
  assert.equal(res.inserted,0);assert.equal(db.db.prepare('SELECT summary FROM blocks').get().summary,'historical needle summary');
  assert.deepEqual(db.db.prepare('SELECT * FROM memory_vectors').all(),before);
  assert.equal(db.db.prepare('SELECT project_id FROM memory_block_projects').get().project_id,'old-project');
  assert.equal(db.search('needle').rows.length,1);
  const sources=join(root,'sources');await writeFile(sources,JSON.stringify({id:'archive',adapter:'memory-history',root:join(root,'history'),pattern:'*.json'}));
  configureForTests({dbPath:join(root,'db'),sourcesPath:sources,logPath:join(root,'log')});
  assert.deepEqual((await buildSourcePolicy()).allowedIds,[id]);
  await writeFile(sources,JSON.stringify({id:'archive',adapter:'memory-history',root:join(root,'history'),pattern:'*.json',enabled:false}));
  assert.deepEqual((await buildSourcePolicy()).allowedIds,[],'archival does not bypass source revocation');
 } finally {configureForTests({maxSummaryChars:20000});db.close();await rm(root,{recursive:true,force:true});}
});
test('source changes or archive conflicts abort conversion; disabled history never promoted',async()=>{
 const {root,db,source}=await fixture();
 try {
  const plans=planHistoryArchives(db.db,join(root,'history'),new Set());assert.equal(plans[0].enabled,false);
  db.db.prepare("UPDATE blocks SET summary='changed'").run();
  await assert.rejects(applyHistoryArchives(db.db,plans),/changed after planning/);
  assert.equal(db.db.prepare('SELECT source_file FROM blocks').get().source_file,source);
  const updated=planHistoryArchives(db.db,join(root,'history'),new Set());
  await assert.rejects(applyHistoryArchives(db.db,updated),/archive conflict/);
  assert.equal(db.db.prepare('SELECT kind FROM sources').get().kind,'pi');
 } finally {db.close();await rm(root,{recursive:true,force:true});}
});
test('broad directory rules cannot enable migrated disabled sources and tampering fails closed',async()=>{
 const {root,db,source}=await fixture();
 try {
  const plans=planHistoryArchives(db.db,join(root,'history'),new Set());
  await applyHistoryArchives(db.db,plans);
  const sources=join(root,'sources');
  await writeFile(sources,JSON.stringify({id:'history',adapter:'memory-history',root:join(root,'history'),pattern:'*.json'}));
  configureForTests({dbPath:join(root,'db'),sourcesPath:sources,logPath:join(root,'log')});
  assert.deepEqual((await buildSourcePolicy()).allowedIds,[]);
  db.db.prepare('UPDATE memory_history_origins SET enabled=1').run();
  assert.equal((await buildSourcePolicy()).allowedIds.length,1);
  await writeFile(plans[0].destination,plans[0].content.replace('historical needle','modified needle'));
  assert.deepEqual((await buildSourcePolicy()).allowedIds,[]);
  assert.equal((await db.ingestSourceFile(plans[0].destination,{kind:'history'},true)).ok,false);
  assert.equal(db.db.prepare('SELECT summary FROM blocks').get().summary,'historical needle summary');
 } finally {configureForTests({maxSummaryChars:20000});db.close();await rm(root,{recursive:true,force:true});}
});
test('history format fails closed on unknown versions, duplicate blocks and malformed references',()=>{
 const doc={format:'bili-memory-history',version:1,origin:{sourceFile:'old',kind:'pi',cwd:null,project:'old'},blocks:[]};
 assert.deepEqual(normalizeHistoryBlocks(doc),[]);
 assert.equal(normalizeHistoryBlocks({...doc,version:2}),null);
 assert.equal(normalizeHistoryBlocks({...doc,blocks:[{blockId:'x',summary:'x'}]}),null);
});
