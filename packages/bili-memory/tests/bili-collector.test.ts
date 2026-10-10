import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { BiliCollector } from '../src/bili-collector.js';
import { fetchBiliIdentity,fetchBiliSession,localBiliOrigin } from '../src/bili-client.js';
import type { BiliIdentity } from '../src/bili-identity.js';

const scope={id:'local',stamp:'local:0',label:'local'};
const identity=(ids:string[]):BiliIdentity=>({conversationId:'pi',sessionId:'proxy',parentRevision:String(ids.length).repeat(64),orderHash:'e'.repeat(64),messages:ids.map((id,i)=>({rawId:id,ref:`m${String(i+1).padStart(5,'0')}`,identityHash:id.repeat(64).slice(0,64)}))});
const doc={version:3,id:'proxy',payload:{version:3,id:'proxy',state:{blocks:[]}}};

test('collector waits for persistence, saves only append-only evidence, cancels obsolete scans',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bili-collector-'));const file=join(root,'source.json');
 let active=true,current=scope,view=identity(['a']);const saved:any[]=[];let ingested=0,listed=0;
 const c=new BiliCollector({conversationId:'pi',origin:()=> 'http://127.0.0.1:12345',scope:()=>current,current:()=>active,
  files:async()=>{listed++;return {files:[file],complete:true};},session:async()=>({conversationId:'pi',sessionId:'proxy',sessionRevision:view.parentRevision}),
  identity:async()=>view,ingest:async()=>{ingested++;return true;},saveEvidence:(_f,e)=>saved.push(e)});
 try {
  assert.equal(await c.scan(),'unavailable');assert.equal(ingested,0);
  await writeFile(file,JSON.stringify(doc));
  assert.equal(await c.scan(),'stored');assert.deepEqual(saved[0],[{rawId:'a',identityHash:'a'.repeat(64),projectId:null}]);
  view=identity(['a','b']);await c.observe();assert.equal(listed,3,'ordinary observation never lists persistence');
  assert.equal(await c.scan(),'stored');assert.deepEqual(saved[1],[{rawId:'b',identityHash:'b'.repeat(64),projectId:'local'}]);
  c.observeScope({id:'remote',stamp:'remote',label:'remote'});c.observeScope(scope);
  view=identity(['a','b','c']);await c.scan();assert.deepEqual(saved[2],[{rawId:'c',identityHash:'c'.repeat(64),projectId:null}]);
  active=false;assert.equal(await c.scan(),'expired');
  active=true;c.stop();assert.equal(await c.scan(),'expired');
 } finally {c.stop();await rm(root,{recursive:true,force:true});}
});

test('failed evidence transaction retries exact revisions without losing observed ownership',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bili-retry-'));const file=join(root,'source.json');await writeFile(file,JSON.stringify(doc));
 let view=identity(['a']),fail=false,missing=false;const saved:any[]=[];
 const c=new BiliCollector({conversationId:'pi',origin:()=> 'http://127.0.0.1:12345',scope:()=>scope,current:()=>true,
 files:async()=>({files:missing?[]:[file],complete:true}),session:async()=>({conversationId:'pi',sessionId:'proxy',sessionRevision:view.parentRevision}),
 identity:async()=>view,ingest:async()=>true,saveEvidence:(_f,rows)=>{if(fail)throw Error('database busy');saved.push(rows);}});
 try{
  await c.scan();view=identity(['a','b']);fail=true;await assert.rejects(c.scan(),/database busy/);
  fail=false;missing=true;assert.equal(await c.scan(),'unavailable');missing=false;
  await c.scan();assert.deepEqual(saved[1],[{rawId:'b',identityHash:'b'.repeat(64),projectId:'local'}]);
  view=identity(['a','b','c']);fail=true;await assert.rejects(c.scan());
  view.messages[2].identityHash='f'.repeat(64);view.parentRevision='f'.repeat(64);fail=false;await c.scan();assert.equal(saved[2][0].projectId,null);
 }finally{c.stop();await rm(root,{recursive:true,force:true});}
});

test('workspace change during status await discards session identity and never writes',async()=>{
 let current=scope;let release!:(v:any)=>void;let writes=0;
 const c=new BiliCollector({conversationId:'pi',origin:()=> 'http://localhost:12345',scope:()=>current,current:()=>true,
 files:async()=>{writes++;return {files:[],complete:true};},ingest:async()=>{writes++;return true;},saveEvidence:()=>writes++,
 session:()=>new Promise(r=>{release=r;})});
 const pending=c.scan();assert.equal(await c.scan(),'busy');current={id:'remote',stamp:'remote:1',label:'remote'};
 release({conversationId:'pi',sessionId:'proxy',sessionRevision:null});assert.equal(await pending,'expired');assert.equal(writes,0);c.stop();
});

test('unavailable image snapshot does not block authorized summary ingestion or guess projects',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bili-image-'));const file=join(root,'source.json');await writeFile(file,JSON.stringify(doc));
 let stored=0,saved=0;
 const c=new BiliCollector({conversationId:'pi',origin:()=> 'http://localhost:12345',scope:()=>scope,current:()=>true,
  files:async()=>({files:[file],complete:true}),session:async()=>({conversationId:'pi',sessionId:'proxy',sessionRevision:null}),
  identity:async()=>null,ingest:async(_f,id,_stamp,valid)=>{assert.equal(id,'proxy');assert.equal(valid(),true);stored++;return true;},saveEvidence:()=>saved++});
 try{assert.equal(await c.scan(),'stored');assert.equal(stored,1);assert.equal(saved,0);}finally{c.stop();await rm(root,{recursive:true,force:true});}
});

test('workspace ABA transitions expire in-flight ingestion despite returning to the same stamp',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bili-aba-'));const file=join(root,'source.json');await writeFile(file,JSON.stringify(doc));
 let current=scope,release!:()=>void,guard!:()=>boolean,saved=0;
 const c=new BiliCollector({conversationId:'pi',origin:()=> 'http://localhost:12345',scope:()=>current,current:()=>true,
  files:async()=>({files:[file],complete:true}),session:async()=>({conversationId:'pi',sessionId:'proxy',sessionRevision:null}),
  ingest:async(_f,_id,_stamp,valid)=>{guard=valid;await new Promise<void>(r=>{release=r;});return valid();},saveEvidence:()=>saved++});
 try{
  const work=c.scan();while(!release)await new Promise<void>(r=>setImmediate(r));
  current={id:'other',stamp:'other:0',label:'other'};c.observeScope(current);current=scope;c.observeScope(current);
  assert.equal(guard(),false);release();assert.equal(await work,'unavailable');assert.equal(saved,0);
 }finally{c.stop();await rm(root,{recursive:true,force:true});}
});

test('local control clients reject remote origins, fallback identities, redirects and mismatched snapshots',async()=>{
 for(const raw of ['https://example.com','http://127.0.0.1.evil.test','http://u:p@localhost','http://localhost/path','http://localhost/?token=x']) assert.equal(localBiliOrigin(raw),null);
 let mode='exact';const server=createServer((req,res)=>{
  if(mode==='redirect'){res.writeHead(302,{location:'http://example.invalid'});res.end();return;}
  if(mode==='image'&&req.url?.includes('/snapshot')){res.writeHead(409);res.end();return;}
  res.setHeader('content-type','application/json');
  const common={ok:true,conversationId:mode==='wrong'?'other':'pi',sessionId:'proxy',...(mode==='fallback'?{fallback:true}:{})};
  res.end(JSON.stringify(req.url?.includes('/status')?{...common,sessionRevision:mode==='image'?null:'d'.repeat(64)}:
    {...common,status:'exact',protocolVersion:1,parentRevision:'d'.repeat(64),orderHash:'e'.repeat(64),orderedMessages:identity(['a']).messages}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 try {
  assert.equal((await fetchBiliIdentity(origin,'pi'))?.sessionId,'proxy');assert.equal((await fetchBiliSession(origin,'pi'))?.sessionId,'proxy');
  mode='image';assert.equal(await fetchBiliIdentity(origin,'pi'),null);assert.equal((await fetchBiliSession(origin,'pi'))?.sessionRevision,null);
  mode='fallback';assert.equal(await fetchBiliSession(origin,'pi'),null);
  mode='wrong';assert.equal(await fetchBiliIdentity(origin,'pi'),null);assert.equal(await fetchBiliSession(origin,'pi'),null);
  mode='redirect';assert.equal(await fetchBiliIdentity(origin,'pi'),null);assert.equal(await fetchBiliSession(origin,'pi'),null);
  assert.equal(await fetchBiliIdentity(origin,'pi',AbortSignal.abort()),null);
 } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
