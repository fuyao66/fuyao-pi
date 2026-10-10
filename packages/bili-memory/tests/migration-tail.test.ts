import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backup } from 'node:sqlite';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryDb, configureForTests, loadSqlite } from '../src/extension.js';
import { ensureVectorSchema } from '../src/hybrid.js';
import { planHistoryArchives, applyHistoryArchives } from '../src/history-archive.js';
import { completeHistoryMigration } from '../src/migration-tail.js';

async function fixture(empty = false) {
 const root=await mkdtemp(join(tmpdir(),'bili-tail-')); await loadSqlite();
 configureForTests({legacyOffline:true,logPath:join(root,'log')});
 const old=new MemoryDb(join(root,'old.sqlite'));old.open();ensureVectorSchema(old);
 const file=join(root,'old.acp.json');
 const first={blockId:'b1',summary:'first preserved summary',effectiveMessageIds:['m1']};
 await writeFile(file,JSON.stringify({blocks:empty?[]:[first]}));
 await old.ingestSourceFile(file,{kind:'pi',cwd:root},true);
 await backup(old.db,join(root,'new.sqlite'));
 const current=new MemoryDb(join(root,'new.sqlite'));current.open();ensureVectorSchema(current);
 const plans=planHistoryArchives(current.db,join(root,'history'),new Set(empty?[]:[file]));
 await applyHistoryArchives(current.db,plans);
 const second={blockId:'b2',summary:'late preserved summary',effectiveMessageIds:['m2']};
 await writeFile(file,JSON.stringify({blocks:empty?[second]:[first,second]}));
 await old.ingestSourceFile(file,{kind:'pi',cwd:root},true);
 const id=old.db.prepare("SELECT id FROM blocks WHERE block_id='b2'").get().id;
 old.db.prepare("INSERT INTO memory_vectors VALUES(?,'fixture','exact-hash',2,?,0)").run(id,Buffer.alloc(8));
 old.db.prepare("INSERT INTO memory_message_projects VALUES(?,'m2','historical-project')").run(file);
 current.db.prepare("INSERT INTO sources(source_file,kind,project) VALUES('live','bili','live')").run();
 current.db.prepare("INSERT INTO blocks(id,source_file,kind,block_id,summary) VALUES(1000,'live','bili','b1','new BC memory')").run();
 return {root,old,current,file,id,plan:plans[0]};
}
for (const empty of [false,true]) test(`tail completion preserves old/new content, vectors and policy, idempotently (empty=${empty})`,async()=>{
 const f=await fixture(empty);
 try {
  const live=f.current.db.prepare("SELECT * FROM blocks WHERE source_file='live'").get();
  const before=await readFile(f.plan.destination,'utf8');
  const result=await completeHistoryMigration(f.old.db,f.current.db,join(f.root,'history'),new Set([f.file]));
  assert.equal(result.inserted,1);assert.deepEqual(result.ids,[f.id]);
  assert.deepEqual(f.current.db.prepare("SELECT * FROM blocks WHERE source_file='live'").get(),live);
  assert.equal(await readFile(f.plan.destination,'utf8'),before,'immutable previous archive retained');
  const origin=f.current.db.prepare('SELECT * FROM memory_history_origins').get();assert.equal(origin.enabled,1);
  assert.notEqual(origin.archive_file,f.plan.destination);
  assert.equal(f.current.db.prepare('SELECT summary FROM blocks WHERE id=?').get(f.id).summary,'late preserved summary');
  assert.deepEqual(f.current.db.prepare('SELECT * FROM memory_vectors WHERE block_id=?').get(f.id),f.old.db.prepare('SELECT * FROM memory_vectors WHERE block_id=?').get(f.id));
  assert.equal(f.current.db.prepare("SELECT project_id FROM memory_block_project_links WHERE block_id=? AND basis='messages'").get(f.id).project_id,'historical-project');
  assert.equal(f.current.search('late').rows.length,1);
  const scanned=await f.current.ingestSourceFile(origin.archive_file,{kind:'history'},true);assert.equal(scanned.ok,true);assert.equal(scanned.inserted,0);
  assert.equal((await completeHistoryMigration(f.old.db,f.current.db,join(f.root,'history'),new Set())).inserted,0);
  assert.equal(f.current.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 } finally {f.old.close();f.current.close();await rm(f.root,{recursive:true,force:true});}
});
test('tail completion refuses unapproved sources, pruned blocks, row collisions and changed history',async()=>{
 const f=await fixture();
 try {
  const run=()=>completeHistoryMigration(f.old.db,f.current.db,join(f.root,'history'),new Set([f.file]));
  await assert.rejects(completeHistoryMigration(f.old.db,f.current.db,join(f.root,'history'),new Set()),/explicit source approval/);
  f.current.db.prepare("INSERT INTO block_tombstones VALUES(?,'b2',1)").run(f.plan.destination);
  await assert.rejects(run(),/pruned/);f.current.db.prepare('DELETE FROM block_tombstones').run();
  f.current.db.prepare("INSERT INTO blocks(id,source_file,block_id,summary) VALUES(?,'live','collision','untouched')").run(f.id);
  await assert.rejects(run(),/ID collision/);f.current.db.prepare('DELETE FROM blocks WHERE id=?').run(f.id);
  f.old.db.prepare("UPDATE blocks SET summary='changed' WHERE block_id='b1'").run();
  await assert.rejects(run(),/differs/);
  assert.equal(f.current.db.prepare("SELECT summary FROM blocks WHERE block_id='b1' AND kind='history'").get().summary,'first preserved summary');
 } finally {f.old.close();f.current.close();await rm(f.root,{recursive:true,force:true});}
});
test('tail completion rejects contradictory legacy ownership and rolls back the whole DB transaction',async()=>{
 const f=await fixture();
 try {
  f.old.db.prepare("INSERT OR REPLACE INTO memory_block_projects VALUES(?,'contradictory-project','known')").run(f.id);
  await assert.rejects(completeHistoryMigration(f.old.db,f.current.db,join(f.root,'history'),new Set([f.file])),/Conflicting historical block project evidence/);
  assert.equal(f.current.db.prepare('SELECT 1 FROM blocks WHERE id=?').get(f.id),undefined);
  assert.equal(f.current.db.prepare('SELECT archive_file FROM memory_history_origins').get().archive_file,f.plan.destination);
  assert.equal(f.current.db.prepare("SELECT count(*) AS n FROM blocks WHERE kind='history'").get().n,1);
 } finally {f.old.close();f.current.close();await rm(f.root,{recursive:true,force:true});}
});
test('tail completion rejects concurrent historical mutations before writing',async()=>{
 const f=await fixture();
 try {
  const proxy={prepare:(sql:string)=>{
   const statement=f.current.db.prepare(sql);
   if(sql==='SAVEPOINT memory_tail_completion') throw Error('unexpected prepare');
   return statement;
  },exec:(sql:string)=>{
   if(sql==='SAVEPOINT memory_tail_completion') f.current.db.prepare("UPDATE blocks SET summary='concurrent edit' WHERE kind='history'").run();
   return f.current.db.exec(sql);
  }};
  await assert.rejects(completeHistoryMigration(f.old.db,proxy,join(f.root,'history'),new Set([f.file])),/Historical records changed during completion/);
  assert.equal(f.current.db.prepare('SELECT 1 FROM blocks WHERE id=?').get(f.id),undefined);
  assert.equal(f.current.db.prepare('SELECT archive_file FROM memory_history_origins').get().archive_file,f.plan.destination);
 } finally {f.old.close();f.current.close();await rm(f.root,{recursive:true,force:true});}
});
test('disabled nonempty archive cannot be implicitly enabled by tail completion',async()=>{
 const f=await fixture();
 try {
  f.current.db.prepare('UPDATE memory_history_origins SET enabled=0').run();
  await assert.rejects(completeHistoryMigration(f.old.db,f.current.db,join(f.root,'history'),new Set([f.file])),/separate policy review/);
  assert.equal(f.current.db.prepare('SELECT enabled FROM memory_history_origins').get().enabled,0);
 } finally {f.old.close();f.current.close();await rm(f.root,{recursive:true,force:true});}
});
