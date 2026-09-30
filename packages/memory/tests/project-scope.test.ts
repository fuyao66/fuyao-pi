import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { projectScope,ensureProjectSchema,recordMessageProjects,assignBlockProjects,scopeAllowedIds } from '../src/project-scope.ts';

test('project identities distinguish same basename, remote target, port and unknown domain',()=>{
 const a=projectScope('/one/demo'),b=projectScope('/two/demo');assert.notEqual(a.id,b.id);
 const remote=(target:string,port=22)=>projectScope('/local',{mode:'remote',target,port,root:'/work/demo'});
 assert.notEqual(remote('a').id,remote('b').id);assert.notEqual(remote('a').id,remote('a',2222).id);
 assert.notEqual(remote('a').id,projectScope('/work/demo').id);
 assert.equal(projectScope('/local',{mode:'unavailable'}).id,null);
 assert.equal(projectScope('/local',{mode:'remote'}).id,null);
 assert.equal(projectScope('/a/../b').id,projectScope('/b').id);
});
test('only complete write-once message evidence assigns blocks; mixed/legacy stay explicit-all',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE blocks(id INTEGER PRIMARY KEY,source_file TEXT,msg_ids TEXT)');ensureProjectSchema(db);
 try{
  const insert=db.prepare('INSERT INTO blocks VALUES(?,?,?)');insert.run(1,'s',JSON.stringify(['a','b']));insert.run(2,'s',JSON.stringify(['a','c']));insert.run(3,'s',JSON.stringify(['legacy']));insert.run(4,'s',null);
  recordMessageProjects(db,'s',['a','b'],'one');recordMessageProjects(db,'s',['c'],'two');recordMessageProjects(db,'s',['a'],'wrong');
  assignBlockProjects(db,'s');
  assert.deepEqual(db.prepare('SELECT state FROM memory_block_projects ORDER BY block_id').all().map((x:any)=>x.state),['known','mixed','unknown','unknown']);
  const scope={id:'one',stamp:'one',label:'demo'};
  assert.deepEqual(scopeAllowedIds(db,[1,2,3,4],scope,false),[1]);assert.deepEqual(scopeAllowedIds(db,[1,2,3,4],scope,true),[1,2,3,4]);
  db.prepare('UPDATE blocks SET msg_ids=? WHERE id=1').run(JSON.stringify(['unknown']));assignBlockProjects(db,'s');assert.deepEqual(scopeAllowedIds(db,[1],scope,false),[]);
  recordMessageProjects(db,'s',['a'],'one');
  db.prepare('UPDATE blocks SET msg_ids=? WHERE id=1').run(JSON.stringify(['a#call-1']));assignBlockProjects(db,'s');assert.deepEqual(scopeAllowedIds(db,[1],scope,false),[1]);
  const capped=Array.from({length:4000},(_,i)=>'cap'+i);recordMessageProjects(db,'s',capped,'one');
  db.prepare('UPDATE blocks SET msg_ids=? WHERE id=1').run(JSON.stringify(capped));assignBlockProjects(db,'s');assert.deepEqual(scopeAllowedIds(db,[1],scope,false),[],'bounded prefix is not complete project evidence');
  db.exec('DELETE FROM blocks WHERE id=2');assert.equal(db.prepare('SELECT count(*) n FROM memory_block_projects WHERE block_id=2').get()!.n,0);
 }finally{db.close();}
});
