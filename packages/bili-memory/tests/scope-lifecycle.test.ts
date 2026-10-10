import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import factory,{configureForTests,getDb,loadSqlite} from '../src/extension.ts';
import { projectScope, recordDirectoryHints } from '../src/project-scope.ts';

test('factory attributes only post-start persisted evidence, guards transitions and scopes tools',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'memory-scope-life-'));const file=join(dir,'session');
 writeFileSync(join(dir,'sources'),JSON.stringify({id:'test',adapter:'pi-sidecar',root:dir,pattern:'*.acp.json'}));
 configureForTests({dbPath:join(dir,'db'),sourcesPath:join(dir,'sources'),logPath:join(dir,'log'),scanOnStartup:false,expandEnabled:true});await loadSqlite();
 const handlers=new Map<string,any>(),tools=new Map<string,any>();let workspace:any={mode:'local',generation:0};
 const pi:any={events:{emit:(_n:string,m:any)=>m.accept(workspace)},on:(n:string,f:any)=>handlers.set(n,f),registerTool:(t:any)=>tools.set(t.name,t),registerCommand:()=>{},registerEntryRenderer:()=>{}};
 const entries:any[]=[{type:'message',id:'legacy'}];const ctx:any={cwd:'/one/demo',sessionManager:{getSessionFile:()=>file,getEntries:()=>entries}};
 await factory(pi);
 try{
  await handlers.get('session_start')({},ctx);
  // Actual Pi order: handler runs before this message is appended.
  const finish=async(id:string)=>{await handlers.get('message_end')({},ctx);entries.push({type:'message',id});};
  await finish('local1');await finish('local2');
  workspace={mode:'remote',target:'host',root:'/work/demo',generation:1};
  await finish('remote1');await finish('remote2');await handlers.get('agent_settled')({},ctx);
  const db=getDb();const rows=db.db.prepare('SELECT message_id,project_id FROM memory_message_projects ORDER BY message_id').all();
  const map=new Map(rows.map((r:any)=>[r.message_id,r.project_id]));
  assert.equal(map.has('legacy'),false);assert.equal(map.get('local1'),projectScope(ctx.cwd).id);
  assert.equal(map.get('local2'),null,'ambiguous transition fails closed');assert.equal(map.get('remote1'),projectScope(ctx.cwd,workspace).id);
  writeFileSync(file+'.acp.json',JSON.stringify({blocks:[{blockId:'known',summary:'needle remote',effectiveMessageIds:['remote1#call','remote2']},{blockId:'old',summary:'needle legacy',effectiveMessageIds:['legacy']}]}));
  const search=async(params:any)=>tools.get('memory_search').execute('s',params,undefined,undefined,ctx);
  const current=await search({query:'needle'});assert.equal(current.details.hits,1);
  assert.equal((await search({query:'needle',scope:'all'})).details.hits,2);
  // Historical cwd is an explicit lower-confidence fallback, never an exact link.
  db.db.prepare('UPDATE sources SET cwd=? WHERE source_file=?').run('/one/demo',file+'.acp.json');
  recordDirectoryHints(db.db);
  workspace={mode:'local',generation:2};
  const fallback=await search({query:'needle'});
  assert.equal(fallback.details.hits,1);
  assert.match(fallback.content[0].text,/session-directory clue only/);
  const detail=await tools.get('memory_expand').execute('e',{block:'old',mode:'summary'},undefined,undefined,ctx);
  assert.equal(detail.details.mode,'summary');
  assert.match(detail.content[0].text,/needle legacy/);
  workspace={mode:'remote',target:'host',root:'/work/demo',generation:3};
  const pending=search({query:'needle'}); // scanSources awaits filesystem IO before resolving.
  workspace={mode:'unavailable',generation:2};
  const switched=await pending;assert.equal(switched.details.mode,'error');assert.match(switched.content[0].text,/workspace changed/);
  assert.equal((await search({query:'needle'})).details.hits,0);
  const expand=await tools.get('memory_expand').execute('e',{block:'known'},undefined,undefined,ctx);assert.equal(expand.details.hits,0);
  await handlers.get('session_shutdown')({},ctx);await handlers.get('session_start')({},ctx);await handlers.get('agent_settled')({},ctx);
  assert.equal(getDb().db.prepare('SELECT project_id FROM memory_message_projects WHERE message_id=?').get('remote1').project_id,map.get('remote1'),'resume does not reassign old IDs');
 }finally{await handlers.get('session_shutdown')({},ctx);rmSync(dir,{recursive:true,force:true});}
});
