import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { BiliCollector } from '../src/bili-collector.js';
import { fetchBiliIdentity,localBiliOrigin } from '../src/bili-client.js';
import type { BiliIdentity } from '../src/bili-identity.js';

const scope={id:'local',stamp:'local:0',label:'local'};
const identity=(ids:string[]):BiliIdentity=>({conversationId:'pi',sessionId:'proxy',messages:ids.map((id,i)=>({rawId:id,ref:`m${String(i+1).padStart(5,'0')}`,identityHash:id.repeat(64).slice(0,64)}))});

test('collector waits for persistence, saves only append-only evidence, cancels obsolete scans',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bili-collector-'));const file=join(root,'source.json');
 let active=true,current=scope,view=identity(['a']);const saved:any[]=[];let ingested=0;
 const c=new BiliCollector({conversationId:'pi',origin:()=> 'http://127.0.0.1:12345',scope:()=>current,current:()=>active,
  files:async()=>[file],identity:async()=>view,ingest:async()=>{ingested++;return true;},saveEvidence:(_f,e)=>saved.push(e)});
 try {
  assert.equal(await c.scan(),'unavailable');assert.equal(ingested,0);
  await writeFile(file,JSON.stringify({version:3,id:'proxy',payload:{version:3,id:'proxy',state:{blocks:[]}}}));
  assert.equal(await c.scan(),'stored');assert.deepEqual(saved[0],[{rawId:'a',identityHash:'a'.repeat(64),projectId:null}]);
  view=identity(['a','b']);assert.equal(await c.scan(),'stored');assert.deepEqual(saved[1],[{rawId:'b',identityHash:'b'.repeat(64),projectId:'local'}]);
  c.observeScope({id:'remote',stamp:'remote',label:'remote'});c.observeScope(scope);
  view=identity(['a','b','c']);await c.scan();assert.deepEqual(saved[2],[{rawId:'c',identityHash:'c'.repeat(64),projectId:null}]);
  active=false;assert.equal(await c.scan(),'expired');
  active=true;c.stop();assert.equal(await c.scan(),'expired');
 } finally {c.stop();await rm(root,{recursive:true,force:true});}
});

test('failed evidence transaction retries exact revisions without losing observed ownership',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bili-retry-'));const file=join(root,'source.json');
 await writeFile(file,JSON.stringify({version:3,id:'proxy',payload:{version:3,id:'proxy',state:{blocks:[]}}}));
 let view=identity(['a']),fail=false;const saved:any[]=[];
 const c=new BiliCollector({conversationId:'pi',origin:()=> 'http://127.0.0.1:12345',scope:()=>scope,current:()=>true,
 files:async()=>[file],identity:async()=>view,ingest:async()=>true,saveEvidence:(_f,rows)=>{if(fail)throw Error('database busy');saved.push(rows);}});
 try{
  await c.scan();view=identity(['a','b']);fail=true;await assert.rejects(c.scan(),/database busy/);
  fail=false;await c.scan();assert.deepEqual(saved[1],[{rawId:'b',identityHash:'b'.repeat(64),projectId:'local'}]);
  view=identity(['a','b','c']);fail=true;await assert.rejects(c.scan());
  view.messages[2].identityHash='x'.repeat(64);fail=false;await c.scan();assert.equal(saved[2][0].projectId,null);
 }finally{c.stop();await rm(root,{recursive:true,force:true});}
});

test('workspace change during network await discards identity and never writes',async()=>{
 let current=scope;let release!:(v:BiliIdentity)=>void;let writes=0;
 const c=new BiliCollector({conversationId:'pi',origin:()=> 'http://localhost:12345',scope:()=>current,current:()=>true,
 files:async()=>{writes++;return [];},ingest:async()=>{writes++;return true;},saveEvidence:()=>writes++,
 identity:()=>new Promise(r=>{release=r;})});
 const pending=c.scan();assert.equal(await c.scan(),'busy');current={id:'remote',stamp:'remote:1',label:'remote'};
 release(identity(['a']));assert.equal(await pending,'expired');assert.equal(writes,0);c.stop();
});

test('local snapshot client rejects remote origins, redirects and wrong session identity',async()=>{
 for(const raw of ['https://example.com','http://127.0.0.1.evil.test','http://u:p@localhost','http://localhost/path','http://localhost/?token=x']) assert.equal(localBiliOrigin(raw),null);
 let mode='exact';const server=createServer((req,res)=>{
  if(mode==='redirect'){res.writeHead(302,{location:'http://example.invalid'});res.end();return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,status:'exact',protocolVersion:1,
   conversationId:mode==='wrong'?'other':'pi',sessionId:'proxy',orderedMessages:identity(['a']).messages}));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 try {
  assert.equal((await fetchBiliIdentity(origin,'pi'))?.sessionId,'proxy');
  mode='wrong';assert.equal(await fetchBiliIdentity(origin,'pi'),null);
  mode='redirect';assert.equal(await fetchBiliIdentity(origin,'pi'),null);
  assert.equal(await fetchBiliIdentity(origin,'pi',AbortSignal.abort()),null);
 } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
