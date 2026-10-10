import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateProjectAssociations } from '../src/project-migration.js';
import { ensureProjectSchema, recordMessageProjects, assignBlockProjects, recordBiliMessageProjects } from '../src/project-scope.js';

function fixture() {
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE blocks(id INTEGER PRIMARY KEY,source_file TEXT,msg_ids TEXT,summary TEXT);
 CREATE TABLE sources(source_file TEXT PRIMARY KEY,cwd TEXT);INSERT INTO sources VALUES('s','/work');
 INSERT INTO blocks VALUES(1,'s','["a"]','summary');`);ensureProjectSchema(db);return db;
}
test('migration preserves previously proven project and is idempotent without rewriting content',()=>{
 const db=fixture();try {
  db.prepare("INSERT INTO memory_block_projects VALUES(1,'old-proof','known')").run();
  migrateProjectAssociations(db);
  const before=db.prepare('SELECT * FROM memory_block_project_links').all();
  migrateProjectAssociations(db);assert.deepEqual(db.prepare('SELECT * FROM memory_block_project_links').all(),before);
  assignBlockProjects(db,'s');
  assert.deepEqual(db.prepare('SELECT * FROM memory_block_project_links').all(),before,'normal reingestion retains migrated proof');
  assert.equal(before[0].project_id,'old-proof');assert.equal(before[0].basis,'messages');
  assert.equal(db.prepare('SELECT summary FROM blocks').get()!.summary,'summary');
 } finally {db.close();}
});
test('rewritten summary invalidates retained historical proof',()=>{
 const db=fixture();try {
  db.prepare("INSERT INTO memory_block_projects VALUES(1,'old-proof','known')").run();migrateProjectAssociations(db);
  db.prepare("UPDATE blocks SET summary='changed'").run();assignBlockProjects(db,'s');
  assert.equal(db.prepare('SELECT count(*) n FROM memory_block_project_links').get()!.n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_project_legacy_proofs').get()!.n,0);
 }finally{db.close();}
});
test('proxy identity hash conflicts revoke stale projects without later automatic relabeling',()=>{
 const db=fixture();try {
  recordBiliMessageProjects(db,'s',[{rawId:'a',identityHash:'a'.repeat(64),projectId:'one'}]);
  assert.equal(db.prepare('SELECT project_id FROM memory_block_projects').get()!.project_id,'one');
  recordBiliMessageProjects(db,'s',[{rawId:'a',identityHash:'b'.repeat(64),projectId:null}]);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_block_project_links').get()!.n,0);
  recordBiliMessageProjects(db,'s',[{rawId:'a',identityHash:'b'.repeat(64),projectId:'two'}]);
  assert.equal(db.prepare('SELECT project_id FROM memory_message_projects').get()!.project_id,null);
 }finally{db.close();}
});
test('conflicting migration evidence rolls back the entire association upgrade',()=>{
 const db=fixture();try {
  db.prepare("INSERT INTO memory_block_projects VALUES(1,'old-proof','known')").run();
  recordMessageProjects(db,'s',['a'],'different-proof');
  const before=db.prepare('SELECT * FROM memory_block_projects').all();
  assert.throws(()=>migrateProjectAssociations(db),/Conflicting historical/);
  assert.deepEqual(db.prepare('SELECT * FROM memory_block_projects').all(),before);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_block_project_links').get()!.n,0);
 } finally {db.close();}
});
test('partial evidence is associated without calling it complete; unknown tail does not erase projects',()=>{
 const db=fixture();try {
  db.prepare('UPDATE blocks SET msg_ids=?').run('["a","b","missing"]');
  recordMessageProjects(db,'s',['a'],'one');recordMessageProjects(db,'s',['b'],'two');
  migrateProjectAssociations(db);
  assert.deepEqual(db.prepare('SELECT project_id FROM memory_block_project_links ORDER BY project_id').all().map(r=>r.project_id),['one','two']);
  assert.equal(db.prepare('SELECT state FROM memory_block_projects').get()!.state,'mixed');
 } finally {db.close();}
});
