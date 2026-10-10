import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { projectScope,ensureProjectSchema,recordMessageProjects,assignBlockProjects,scopeAllowedIds,recordDirectoryHints,scopeDirectoryHintIds,recordWorkspaceInterval } from '../src/project-scope.ts';

test('project identities distinguish same basename, remote target, port and unknown domain',()=>{
 const a=projectScope('/one/demo'),b=projectScope('/two/demo');assert.notEqual(a.id,b.id);
 const remote=(target:string,port=22)=>projectScope('/local',{mode:'remote',target,port,root:'/work/demo'});
 assert.notEqual(remote('a').id,remote('b').id);assert.notEqual(remote('a').id,remote('a',2222).id);
 assert.notEqual(remote('a').id,projectScope('/work/demo').id);
 assert.equal(projectScope('/local',{mode:'unavailable'}).id,null);
 assert.equal(projectScope('/local',{mode:'remote'}).id,null);
 assert.equal(projectScope('/a/../b').id,projectScope('/b').id);
});
test('complete message evidence permits multi-project blocks without duplicating summaries',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE blocks(id INTEGER PRIMARY KEY,source_file TEXT,msg_ids TEXT,summary TEXT NOT NULL DEFAULT 'fixture')");ensureProjectSchema(db);
 try{
  const insert=db.prepare('INSERT INTO blocks(id,source_file,msg_ids) VALUES(?,?,?)');insert.run(1,'s',JSON.stringify(['a','b']));insert.run(2,'s',JSON.stringify(['a','c']));insert.run(3,'s',JSON.stringify(['legacy']));insert.run(4,'s',null);
  recordMessageProjects(db,'s',['a','b'],'one');recordMessageProjects(db,'s',['c'],'two');recordMessageProjects(db,'s',['a'],'wrong');
  assignBlockProjects(db,'s');
  assert.deepEqual(db.prepare('SELECT state FROM memory_block_projects ORDER BY block_id').all().map((x:any)=>x.state),['known','mixed','unknown','unknown']);
  const scope={id:'one',stamp:'one',label:'demo'};
  assert.deepEqual(scopeAllowedIds(db,[1,2,3,4],scope,false),[1,2]);assert.deepEqual(scopeAllowedIds(db,[1,2,3,4],scope,true),[1,2,3,4]);
  db.prepare('UPDATE blocks SET msg_ids=? WHERE id=1').run(JSON.stringify(['unknown']));assignBlockProjects(db,'s');assert.deepEqual(scopeAllowedIds(db,[1],scope,false),[]);
  recordMessageProjects(db,'s',['a'],'one');
  db.prepare('UPDATE blocks SET msg_ids=? WHERE id=1').run(JSON.stringify(['a#call-1']));assignBlockProjects(db,'s');assert.deepEqual(scopeAllowedIds(db,[1],scope,false),[1]);
  const capped=Array.from({length:4000},(_,i)=>'cap'+i);recordMessageProjects(db,'s',capped,'one');
  db.prepare('UPDATE blocks SET msg_ids=? WHERE id=1').run(JSON.stringify(capped));assignBlockProjects(db,'s');assert.deepEqual(scopeAllowedIds(db,[1],scope,false),[],'bounded prefix is not complete project evidence');
  assert.deepEqual(scopeAllowedIds(db,[1,2,3,4],{id:'two',stamp:'two',label:'two'},false),[2]);
  db.exec('DELETE FROM blocks WHERE id=2');assert.equal(db.prepare('SELECT count(*) n FROM memory_block_projects WHERE block_id=2').get()!.n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_block_project_links WHERE block_id=2').get()!.n,0);
 }finally{db.close();}
});

test('directory clues stay separate from exact links; schema upgrade preserves known assignments',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE blocks(id INTEGER PRIMARY KEY,source_file TEXT,msg_ids TEXT);
 CREATE TABLE sources(source_file TEXT PRIMARY KEY,cwd TEXT);
 INSERT INTO sources VALUES('old','/work/demo');
 INSERT INTO blocks VALUES(1,'old','[]'),(2,'old','[]');
 CREATE TABLE memory_block_projects(block_id INTEGER PRIMARY KEY,project_id TEXT,state TEXT);
 INSERT INTO memory_block_projects VALUES(1,'proven','known');`);
 try {
  ensureProjectSchema(db);ensureProjectSchema(db);recordDirectoryHints(db);recordDirectoryHints(db);
  const local=projectScope('/work/demo');
  assert.deepEqual(scopeAllowedIds(db,[1,2],local,false),[]);
  assert.deepEqual(scopeDirectoryHintIds(db,[1,2],local),[2]);
  assert.deepEqual(scopeDirectoryHintIds(db,[],local),[],'source revocation still applies');
  assert.deepEqual(scopeAllowedIds(db,[1,2],{id:'proven',stamp:'p',label:'p'},false),[1]);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_block_project_links').get()!.n,2);
 } finally {db.close();}
});

test('workspace intervals persist transitions, restart boundaries and unknown domains',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE blocks(id INTEGER PRIMARY KEY)');ensureProjectSchema(db);
 try {
  const local=projectScope('/work');const remote=projectScope('/work',{mode:'remote',target:'host',root:'/app',generation:1});
  recordWorkspaceInterval(db,'session',local,100);recordWorkspaceInterval(db,'session',local,110);
  recordWorkspaceInterval(db,'session',remote,120);recordWorkspaceInterval(db,'session',local,130);
  recordWorkspaceInterval(db,'session',local,140,true);
  recordWorkspaceInterval(db,'session',projectScope('/work',{mode:'unavailable',generation:2}),150);
  const rows=db.prepare('SELECT project_id,started_at,ended_at FROM memory_workspace_intervals ORDER BY id').all();
  assert.equal(rows.length,5);assert.equal(rows[0].ended_at,120);assert.equal(rows[1].project_id,remote.id);
  assert.equal(rows[3].started_at,140);assert.equal(rows[4].project_id,null);assert.equal(rows[4].ended_at,null);
  assert.throws(()=>recordWorkspaceInterval(db,'',local));
 } finally {db.close();}
});
