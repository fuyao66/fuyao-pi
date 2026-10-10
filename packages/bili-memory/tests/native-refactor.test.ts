import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { createHook } from 'node:async_hooks';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { BiliSessionLocator, parseBiliSession } from '../src/bili-identity.js';
import { BiliCollector } from '../src/bili-collector.js';
import { BiliProjectEvidence } from '../src/bili-project-evidence.js';
import { readSourceFile } from '../src/source-files.js';
import { SourceCache } from '../src/source-cache.js';
import factory, { MemoryDb, loadSqlite, configureForTests, listSourceFiles, formatResults, getDb } from '../src/extension.js';
import { recordBiliMessageProjects, recordMessageProjects, assignBlockProjects, projectScope, scopeAllowedIds } from '../src/project-scope.js';
import { HybridMemory } from '../src/hybrid.js';
import { sanitizeEmbeddingConfig } from '../src/embeddings.js';
import { authorizedGroups, fuseDistinct } from '../src/retrieval.js';

const envelope = (id: string, blocks: any[] = [], extra = '') => ({version:3,id,payload:{version:3,id,state:{blocks},extra}});
const digest = (c: string) => c.repeat(64);
const scope = {id:'project',stamp:'project:0',label:'project'};
const view = (ids: string[]) => ({conversationId:'pi',sessionId:'native',parentRevision:digest(String(ids.length)),orderHash:digest('d'),messages:ids.map((rawId,i)=>({rawId,ref:`m${String(i+1).padStart(5,'0')}`,identityHash:digest(rawId)}))});

test('native status mapping rejects fallback/missing identity but accepts opaque session revision',()=>{
 const v={ok:true,conversationId:'pi',sessionId:'native',sessionRevision:null};
 assert.equal(parseBiliSession(v,'pi')?.sessionId,'native');
 for(const bad of [{...v,fallback:true},{...v,sessionId:null},{...v,conversationId:'another'}, {...v,sessionRevision:'bad'}]) assert.equal(parseBiliSession(bad,'pi'),null);
});

test('incremental locator reads no unchanged JSON, refreshes replacements and refuses incomplete ambiguity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bm-locator-'));let reads=0,bytes=0;
 const read=async(file:string,max?:number)=>{const value=await readSourceFile(file,max);reads++;bytes+=Buffer.byteLength(value.body);return value;};
 const locator=new BiliSessionLocator(128,32*1024*1024,128*1024*1024,read);
 const files=Array.from({length:33},(_,i)=>join(dir,`${i}.json`));
 try{
  for(let i=0;i<files.length;i++)writeFileSync(files[i],JSON.stringify(envelope(`s${i}`,[],'x'.repeat(2*1024*1024))));
  const listing={files,complete:true};const start=performance.now();
  assert.equal((await locator.locate(listing,'s0'))?.file,files[0]);const coldBytes=bytes;assert.equal(reads,33);
  const coldMs=performance.now()-start;const hotStart=performance.now();
  for(let i=0;i<3;i++)assert.equal((await locator.locate(listing,'s0'))?.file,files[0]);
  assert.equal(reads,33);assert.equal(bytes,coldBytes);
  const hotMs=performance.now()-hotStart;
  const replacement=join(dir,'replacement');writeFileSync(replacement,JSON.stringify(envelope('s1')));renameSync(replacement,files[1]);
  assert.equal((await locator.locate(listing,'s0'))?.file,files[0]);assert.equal(reads,34);
  const duplicate=join(dir,'duplicate.json');writeFileSync(duplicate,JSON.stringify(envelope('s0')));
  assert.equal(await locator.locate({files:[...files,duplicate],complete:true},'s0'),null);
  assert.equal(await locator.locate({files,complete:false},'s0'),null);
  assert.equal(await new BiliSessionLocator(2).locate(listing,'s0'),null);
  console.log(JSON.stringify({benchmark:'native-locator',coldMs:Math.round(coldMs),threeHotMs:Math.round(hotMs),coldBytes,hotReadBytes:0}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('ordinary observations do not list files, repeated revisions reuse identities, pending scan drains once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bm-drain-'));const file=join(dir,'native.json');writeFileSync(file,JSON.stringify(envelope('native')));
 let snapshot=view(['a']),fetches=0,lists=0,ingests=0,release!:(v:any)=>void,slow=false;
 const collector=new BiliCollector({conversationId:'pi',origin:()=> 'http://127.0.0.1:1234',scope:()=>scope,current:()=>true,
  files:async()=>{lists++;return {files:[file],complete:true};},session:async()=>({conversationId:'pi',sessionId:'native',sessionRevision:snapshot.parentRevision}),
  identity:async()=>{fetches++;return slow?await new Promise<any>(r=>{release=r;}):snapshot;},
  ingest:async()=>{ingests++;return true;},saveEvidence:()=>{}});
 try{
  for(let i=0;i<10;i++)await collector.observe();assert.equal(lists,0);assert.equal(fetches,1);
  snapshot=view(['a','b']);slow=true;const observation=collector.observe();
  while(!release)await new Promise<void>(r=>setImmediate(r));
  assert.equal(await collector.scan(),'busy');assert.equal(await collector.scan(),'busy');
  slow=false;release(snapshot);await observation;
  for(let i=0;i<50&&!ingests;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(ingests,1,'overlapping settle/compress requests coalesce to one ingestion');
 }finally{collector.stop();rmSync(dir,{recursive:true,force:true});}
});

test('ordered identity prefixes reject reorder, ref reuse and workspace gaps',()=>{
 const evidence=new BiliProjectEvidence();evidence.capture(view(['a','b']),scope);
 const reordered=view(['b','a','c']);assert.ok(evidence.capture(reordered,scope).every(x=>x.projectId===null));
 const changed=view(['b','a','c','d']);changed.messages[0].ref='m99999';
 assert.ok(evidence.capture(changed,scope).every(x=>x.projectId===null));
});

test('complete native summaries, graph metadata, parser refresh and project hash reconciliation stay consistent',async()=>{
 await loadSqlite();const dir=mkdtempSync(join(tmpdir(),'bm-native-store-'));const file=join(dir,'native.json');
 const store=new MemoryDb(join(dir,'index.sqlite'));store.open();const project=projectScope(dir);
 const text='evidence '.repeat(3000)+'TAIL_NATIVE_NEEDLE';
 let blocks=[{blockId:'b1',summary:text,effectiveMessageIds:['a'],active:false,directBlockIds:[]},
 {blockId:'b2',summary:'Parent evidence TAIL_NATIVE_NEEDLE',effectiveMessageIds:['a'],active:true,directBlockIds:['b1']}];
 const save=()=>writeFileSync(file,JSON.stringify(envelope('native',blocks)));
 const ingest=()=>store.ingestSourceFile(file,{kind:'bili'},false);
 try{
  save();assert.equal((await ingest()).inserted,2);const first=store.db.prepare("SELECT * FROM blocks WHERE block_id='b1'").get();
  assert.equal(first.summary,text);assert.equal(store.search('TAIL_NATIVE_NEEDLE').rows.length,2);
  assert.equal(store.db.prepare('SELECT active FROM memory_native_metadata WHERE block_id=?').get(first.id).active,0);
  recordBiliMessageProjects(store.db,file,[{rawId:'a',identityHash:digest('a'),projectId:project.id}],[{rawId:'a',identityHash:digest('a')}]);
  assert.deepEqual(scopeAllowedIds(store.db,[first.id],project,false),[first.id]);
  // Lost volatile delta must not preserve a stale ownership claim: all snapshot
  // hashes are reconciled even when there are no new project assignments.
  recordBiliMessageProjects(store.db,file,[],[{rawId:'a',identityHash:digest('b')}]);
  assert.deepEqual(scopeAllowedIds(store.db,[first.id],project,false),[]);
  const hybrid=new HybridMemory(store,sanitizeEmbeddingConfig({enabled:true,baseUrl:'https://example.invalid/v1',dimensions:2}),x=>x,{embed:async(xs:string[])=>xs.map(()=>[1,0])} as any);
  await hybrid.backfill();let events=0;store.onStored=()=>events++;
  blocks=blocks.map(b=>({...b,active:!b.active}));save();assert.equal((await ingest()).refreshed,0);assert.equal(events,0);assert.equal(hybrid.status().indexed,2);
  const stable=store.db.prepare('SELECT id,summary FROM blocks').all();
  store.db.prepare('UPDATE memory_native_sources SET parser_version=0').run();assert.equal((await ingest()).parsed,true);
  assert.deepEqual(store.db.prepare('SELECT id,summary FROM blocks').all(),stable);assert.equal(hybrid.status().indexed,2);
  const watermark=store.db.prepare('SELECT * FROM source_watermarks').get();
  configureForTests({maxStoredSummaryBytes:128});save();assert.equal((await store.ingestSourceFile(file,{kind:'bili'},true)).ok,false);
  assert.deepEqual(store.db.prepare('SELECT * FROM source_watermarks').get(),watermark);assert.equal(store.db.prepare('SELECT summary FROM blocks WHERE id=?').get(first.id).summary,text);
 }finally{configureForTests({maxStoredSummaryBytes:1024*1024});store.close();rmSync(dir,{recursive:true,force:true});}
});

test('authorization-first exact copies share hits but keep receipts; parent/child diversity does not delete detail',()=>{
 const row=(id:number,summary:string,extra:any={})=>({id,summary,topic:'same',sourceFile:'s',kind:'bili',sessionId:'native',blockId:`b${id}`,...extra});
 const copies=[row(1,'shared',{kind:'history',sourceFile:'archive'}),row(2,'shared',{active:1}),row(3,'different',{active:1})];
 const hits=fuseDistinct(copies,[copies[1]],3);assert.equal(hits.length,2);assert.equal(hits[0].id,2);assert.equal(hits[0].alternatives[0].id,1);
 assert.match(formatResults({mode:'hybrid',rows:hits}),/Other authorized sources:/);
 assert.deepEqual(authorizedGroups(hits,r=>r.id!==2,3).map(r=>r.id),[1,3]);
 const parent=row(4,'parent',{active:1,directBlockIds:'["b5"]'}),child=row(5,'child',{active:0});
 assert.deepEqual(fuseDistinct([parent,child,row(6,'unrelated')],[],2).map(r=>r.id),[4,6]);
 assert.deepEqual(fuseDistinct([parent,child],[],2).map(r=>r.id),[4,5]);
 assert.equal(fuseDistinct([row(7,'same',{topic:'a'}),row(8,'same',{topic:'b'})],[],2).length,2);
});

test('one input embedding can serve authorized copies without uploading disabled or changed rows',async()=>{
 await loadSqlite();const dir=mkdtempSync(join(tmpdir(),'bm-vector-dedup-'));const store=new MemoryDb(join(dir,'index.sqlite'));store.open();
 try{
  store.db.exec("INSERT INTO sources(source_file,kind,project) VALUES('s','bili','fixture');");
  const add=store.db.prepare("INSERT INTO blocks(source_file,kind,block_id,summary) VALUES('s','bili',?,'same input')");
  for(let i=0;i<20;i++)add.run(`b${i}`);
  let inputCount=0;const hybrid=new HybridMemory(store,sanitizeEmbeddingConfig({enabled:true,baseUrl:'https://example.invalid/v1',dimensions:2}),x=>x,
    {embed:async(xs:string[])=>{inputCount+=xs.length;return xs.map(()=>[1,0]);}} as any);
  const allowed=store.db.prepare('SELECT id FROM blocks WHERE id<=19').all().map(r=>r.id);
  const result=await hybrid.backfill(20,async()=>Object.assign((r:any)=>r.id<=19,{allowedIds:allowed}));
  assert.equal(result.uploaded,1);assert.equal(inputCount,1);assert.equal(result.stored,19);
  assert.equal(store.db.prepare('SELECT count(*) n FROM memory_vectors WHERE block_id=20').get().n,0);
  assert.equal(store.search('same').rows.length,1,'bounded lexical copies do not consume tool result slots');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('overlapping ordinary observation cannot erase full hash reconciliation of a validated scan',async()=>{
 await loadSqlite();const dir=mkdtempSync(join(tmpdir(),'bm-reconcile-')),file=join(dir,'native.json');
 const store=new MemoryDb(join(dir,'db'));store.open();writeFileSync(file,JSON.stringify(envelope('native',[{blockId:'b1',summary:'project evidence',effectiveMessageIds:['a']}] )));
 const project=projectScope(dir);let snapshot=view(['a']),paused=false,calls=0,release!:(s:any)=>void;
 await store.ingestSourceFile(file,{kind:'bili'});
 recordBiliMessageProjects(store.db,file,[{rawId:'a',identityHash:digest('a'),projectId:project.id}],snapshot.messages);
 const id=store.db.prepare('SELECT id FROM blocks').get().id;
 snapshot={...snapshot,parentRevision:digest('f'),messages:[{...snapshot.messages[0],identityHash:digest('f')}]};
 const c=new BiliCollector({conversationId:'pi',origin:()=> 'http://localhost:1234',scope:()=>project,current:()=>true,
  files:async()=>({files:[file],complete:true}),identity:async()=>snapshot,
  session:async()=>{const s={conversationId:'pi',sessionId:'native',sessionRevision:snapshot.parentRevision};return ++calls===3?await new Promise<any>(r=>{paused=true;release=r;}):s;},
  ingest:async(f)=> (await store.ingestSourceFile(f,{kind:'bili'})).ok,
  saveEvidence:(f,rows,identity)=>recordBiliMessageProjects(store.db,f,rows,identity.messages)});
 try{
  const work=c.scan();while(!paused)await new Promise<void>(r=>setImmediate(r));await c.observe();
  release({conversationId:'pi',sessionId:'native',sessionRevision:snapshot.parentRevision});assert.equal(await work,'stored');
  assert.equal(store.db.prepare('SELECT identity_hash FROM memory_proxy_message_hashes').get().identity_hash,digest('f'));
  assert.deepEqual(scopeAllowedIds(store.db,[id],project,false),[]);
 }finally{c.stop();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('semantic scoring cannot return a changed unembedded suffix under an identical prefix hash',async()=>{
 await loadSqlite();const dir=mkdtempSync(join(tmpdir(),'bm-semantic-revision-'));const store=new MemoryDb(join(dir,'db'));store.open();
 try{
  store.db.exec("INSERT INTO sources(source_file,kind,project) VALUES('s','bili','fixture');");
  const old='A'.repeat(7000)+' OLD_SUFFIX',updated='A'.repeat(7000)+' NEW_SUFFIX';
  store.db.prepare("INSERT INTO blocks(source_file,kind,block_id,summary) VALUES('s','bili','b1',?)").run(old);
  const worker=new HybridMemory(store,sanitizeEmbeddingConfig({enabled:true,baseUrl:'https://example.invalid/v1',dimensions:2}),x=>x,{embed:async(xs:string[])=>xs.map(()=>[1,0])} as any);
  await worker.backfill();let calls=0;
  const result=await worker.search('semantic wording absent from body',{refreshPolicy:async()=>{
    if(++calls===3)store.db.prepare('UPDATE blocks SET summary=? WHERE id=1').run(updated);
    return {allowedIds:[1],authorizedRows:undefined as any};
  }});
  assert.equal(result.mode,'hybrid');assert.deepEqual(result.rows,[]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('zero-vector refresh and coverage yield in chunks and respect cancellation before fallback',async()=>{
 await loadSqlite();const dir=mkdtempSync(join(tmpdir(),'bm-empty-vectors-'));const store=new MemoryDb(join(dir,'db'));store.open();
 let immediates=0;const hook=createHook({init(_id,type){if(type==='Immediate')immediates++;}});
 try{
  store.db.exec("INSERT INTO sources(source_file,kind,project) VALUES('s','bili','fixture');");
  const add=store.db.prepare("INSERT INTO blocks(source_file,kind,block_id,summary) VALUES('s','bili',?,'keyword evidence')");for(let i=0;i<96;i++)add.run(`b${i}`);
  const worker=new HybridMemory(store,sanitizeEmbeddingConfig({enabled:true,baseUrl:'https://example.invalid/v1',dimensions:2}),x=>x,{embed:async()=>{throw Error('no query upload');}} as any);
  const ids=store.db.prepare('SELECT id FROM blocks').all().map(r=>r.id);let refreshes=0,before=0;
  hook.enable();const result=await worker.search('keyword',{refreshPolicy:async()=>{if(++refreshes===2)before=immediates;return {allowedIds:ids,authorizedRows:undefined as any};}});hook.disable();
  assert.ok(immediates-before>=6,'second gate and coverage both yield every 32 rows');assert.equal(result.mode,'lexical-fallback');
  const abort=new AbortController();refreshes=0;
  const cancelled=await worker.search('keyword',{refreshPolicy:async()=>{if(++refreshes===2)setImmediate(()=>abort.abort());return {allowedIds:ids,authorizedRows:undefined as any};}},abort.signal);
  assert.equal(cancelled.mode,'cancelled');assert.deepEqual(cancelled.rows,[]);
 }finally{hook.disable();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('second vector gate reauthorizes its witness after yielding and never uploads a revoked query',async()=>{
 await loadSqlite();const dir=mkdtempSync(join(tmpdir(),'bm-query-gate-'));const store=new MemoryDb(join(dir,'db'));store.open();
 try{
  store.db.exec("INSERT INTO sources(source_file,kind,project) VALUES('s','bili','fixture');");
  const add=store.db.prepare("INSERT INTO blocks(source_file,kind,block_id,summary) VALUES('s','bili',?,'query gate fixture')");for(let i=0;i<33;i++)add.run(`b${i}`);
  let uploads=0;const worker=new HybridMemory(store,sanitizeEmbeddingConfig({enabled:true,baseUrl:'https://example.invalid/v1',dimensions:2}),x=>x,{embed:async(xs:string[])=>{uploads++;return xs.map(()=>[1,0]);}} as any);
  await worker.backfill(1,async()=>Object.assign(()=>true,{allowedIds:[33]}));uploads=0;
  const ids=store.db.prepare('SELECT id FROM blocks').all().map(r=>r.id);let revoked=false,calls=0;
  const result=await worker.search('semantic-only wording',{refreshPolicy:async()=>{
    if(++calls===2)setImmediate(()=>{revoked=true;});
    return {allowedIds:revoked?[]:ids,authorizedRows:undefined as any};
  }});
  assert.ok(revoked);assert.equal(uploads,0);assert.deepEqual(result.rows,[]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('full current/all search results reauthorize the primary and alternatives after async retrieval',async()=>{
 await loadSqlite();const dir=mkdtempSync(join(tmpdir(),'bm-final-permission-')),file=join(dir,'source.acp.json'),sources=join(dir,'sources');
 writeFileSync(file,JSON.stringify({schemaVersion:1,blocks:[{blockId:'b1',summary:'keyword evidence',effectiveMessageIds:['a']},{blockId:'b2',summary:'keyword evidence',effectiveMessageIds:['a']}]}));
 writeFileSync(sources,JSON.stringify({id:'test',adapter:'pi-sidecar',root:dir,pattern:'*.acp.json'}));
 configureForTests({dbPath:join(dir,'db'),sourcesPath:sources,logPath:join(dir,'log'),scanOnStartup:false});
 const handlers=new Map<string,any>(),tools=new Map<string,any>();const ctx:any={cwd:dir,sessionManager:{getEntries:()=>[],getSessionFile:()=>null}};
 await factory({on:(n:string,f:any)=>handlers.set(n,f),registerTool:(t:any)=>tools.set(t.name,t),registerCommand:()=>{},registerEntryRenderer:()=>{}} as any);
 try{
  await handlers.get('session_start')({},ctx);
  for(const mode of ['current','all']){
   writeFileSync(sources,JSON.stringify({id:'test',adapter:'pi-sidecar',root:dir,pattern:'*.acp.json'}));
   const store=getDb();await store.ingestSourceFile(file,{kind:'pi'});recordMessageProjects(store.db,file,['a'],projectScope(dir).id);assignBlockProjects(store.db,file);
   const original=store.search.bind(store);let intercepted=false;
   store.search=((q:string,o:any)=>{const result=original(q,o);if(!intercepted){intercepted=true;assert.equal(result.rows.length,1);assert.equal(result.rows[0].alternatives.length,1);queueMicrotask(()=>writeFileSync(sources,JSON.stringify({id:'test',adapter:'pi-sidecar',root:dir,pattern:'*.acp.json',enabled:false})));}return result;}) as any;
   try{const result=await tools.get('memory_search').execute('s',{query:'keyword',scope:mode,limit:1},undefined,undefined,ctx);assert.equal(result.details.hits,0);assert.ok(!result.content[0].text.includes('Other authorized sources:'));}
   finally{store.search=original;}
  }
 }finally{await handlers.get('session_shutdown')({},ctx);rmSync(dir,{recursive:true,force:true});}
});

test('content-store companion is not a memory source and parsed-summary cache ignores raw-history size',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bm-foreign-'));const file=join(dir,'native.json');const foreign=join(dir,'native.content-store.json');
 try{
  writeFileSync(file,JSON.stringify(envelope('native',[],'x'.repeat(2*1024*1024))));writeFileSync(foreign,'{}');
  const listed=await listSourceFiles({id:'native',adapter:'bili-session',root:dir,pattern:'*.json',enabled:true});
  assert.deepEqual(listed.files,[file]);assert.equal(listed.errors.length,0);assert.equal(listed.complete,true);
  const cache=new SourceCache(2,1024);let parses=0;
  const parse=()=>{parses++;return {state:'loaded' as const,blocks:new Map([['b1',{blockId:'b1',summary:'small evidence'}]])};};
  await cache.read('s',file,parse,32*1024*1024);await cache.read('s',file,parse,32*1024*1024);assert.equal(parses,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
