import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import assert from 'node:assert/strict';
import { BcpLocalArtifacts } from '../packages/remote-ssh/src/pi/integrations/bcp-local.ts';
import { BiliCollector } from '../packages/bili-memory/src/bili-collector.ts';
import { MemoryDb, loadSqlite, configureForTests } from '../packages/bili-memory/src/extension.ts';
import { recordBiliMessageProjects, scopeAllowedIds } from '../packages/bili-memory/src/project-scope.ts';
// Opt-in offline integration probe: pass an unpacked, reviewed 0.1.189 package.
// No installation or production configuration changes; upstream is loopback only.
const packageDir = process.argv[2] && resolve(process.argv[2]);
if (!packageDir) throw new Error('Usage: node scripts/verify-billion-context.mjs <unpacked-package-dir>');
const packageInfo = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
assert.equal(packageInfo.name, 'billion-context');
assert.equal(packageInfo.version, '0.1.189', 'Review the protocol before changing the test baseline');
const root=mkdtempSync('/tmp/fuyao-bili-migration-');
const captured=[];
const upstream=createServer(async(req,res)=>{let s='';for await(const c of req)s+=c;const request=JSON.parse(s);captured.push(request);if(request.stream){res.writeHead(200,{'content-type':'text/event-stream'});for(const chunk of [{delta:{role:'assistant',content:'fixture response'},finish_reason:null},{delta:{},finish_reason:'stop'}])res.write('data: '+JSON.stringify({id:'mock',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,...chunk}],usage:{prompt_tokens:100,completion_tokens:3,total_tokens:103}})+'\n\n');res.end('data: [DONE]\n\n');return;}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'mock',object:'chat.completion',created:1,model:'fixture',choices:[{index:0,message:{role:'assistant',content:'fixture response'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:3,total_tokens:103}}));});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
mkdirSync(join(root,'home'));const config=join(root,'billion-context.json');
writeFileSync(config,JSON.stringify({autoUpdate:false,advisoryCheck:false,releaseNotesCheck:false,persist:{enabled:true,debounceMs:25},compress:{modelContextLimit:100000}}));
// Do not inherit live ACP/BILI routing, credentials or Pi profile overrides.
const env={PATH:process.env.PATH,LANG:process.env.LANG,HOME:join(root,'home'),XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),BILI_CONFIG_FILE:config,BILI_SESSIONS_DIR:join(root,'sessions'),ACP_AUTO_UPDATE:'0',BILI_ADVISORY_CHECK:'0',BILI_RELEASE_NOTES_CHECK:'0',ACP_HOST:'127.0.0.1',ACP_PORT:String(port),HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',BILI_UPSTREAM_PROXY:''};
const child=spawn(process.execPath,[join(packageDir,'dist/index.js'),'start','--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});let log='';let spawnError;child.on('error',e=>{spawnError=e;});child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
const origin=`http://127.0.0.1:${port}`;
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/__bili/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{} if(spawnError)throw spawnError; if(child.exitCode!==null)throw Error('proxy exited '+child.exitCode);await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'proxy ready');
 const manifest=await(await fetch(origin+'/__bili/plugin/manifest')).json();writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2));
 const target=`${origin}/bili/http://127.0.0.1:${upstream.address().port}/v1/chat/completions`;
 const messages=[{role:'system',content:'Local migration fixture. No real user content.'},{role:'user',content:'Start project fixture.'},{role:'assistant',content:'Investigated OLD_DETAIL_ALPHA. '.repeat(300)},{role:'user',content:'Keep working.'}];
 for(let i=0;i<8;i++)messages.push({role:'assistant',content:`Later answer ${i}. `.repeat(300)},{role:'user',content:`Later request ${i}. `.repeat(300)});
 const headers={'content-type':'application/json','x-bili-plugin':'pi','x-bili-plugin-conversation':'migration-fixture','x-bili-plugin-context-window':'100000','x-bili-plugin-model':'fixture'};
 const send=()=>fetch(target,{method:'POST',headers,body:JSON.stringify({model:'fixture',messages,stream:false,service_tier:'priority',max_tokens:256}),signal:AbortSignal.timeout(15000)});
 let response=await send();const text=await response.text();assert.equal(response.status,200,text);
 assert.equal(captured.length,1);assert.equal(captured[0].service_tier,'priority');
 const status=await(await fetch(origin+'/__bili/plugin/status?conversationId=migration-fixture')).json();writeFileSync(join(root,'status.json'),JSON.stringify(status,null,2));
 const snapshot=await(await fetch(origin+'/__bili/plugin/snapshot?conversationId=migration-fixture')).json();writeFileSync(join(root,'snapshot.json'),JSON.stringify(snapshot,null,2));
 const compressResponse=await fetch(origin+'/__bili/plugin/tool',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId:'migration-fixture',tool:'compress',args:{content:[{startId:'m00002',endId:'m00002',summary:'MIGRATED_SUMMARY_ALPHA: investigated the synthetic migration fixture and recorded the findings.',topic:'fixture'}]}})});
 const compressed=await compressResponse.text();writeFileSync(join(root,'compress.json'),compressed);assert.equal(compressResponse.status,200,compressed);assert.equal(JSON.parse(compressed).blocksCreated,1,compressed);
 messages.push({role:'assistant',content:null,tool_calls:[{id:'compress-fixture',type:'function',function:{name:'compress',arguments:JSON.stringify({content:[{startId:'m00002',endId:'m00002',summary:'MIGRATED_SUMMARY_ALPHA: investigated the synthetic migration fixture and recorded the findings.',topic:'fixture'}]})}}]},{role:'tool',tool_call_id:'compress-fixture',content:JSON.parse(compressed).result});
 response=await send();assert.equal(response.status,200,await response.text());
 assert.ok(JSON.stringify(captured.at(-1)).includes('MIGRATED_SUMMARY_ALPHA'));
 assert.ok(!JSON.stringify(captured.at(-1)).includes('OLD_DETAIL_ALPHA'));
 await new Promise(r=>setTimeout(r,250));
 writeFileSync(join(root,'captured.json'),JSON.stringify(captured,null,2));
 const after=await(await fetch(origin+'/__bili/plugin/status?conversationId=migration-fixture')).json();writeFileSync(join(root,'status-after.json'),JSON.stringify(after,null,2));
 // An actual proxy-generated receipt must route its export to the local reader.
 const exportPath=join(root,'decompressed.txt');
 const restored=await(await fetch(origin+'/__bili/plugin/tool',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId:'migration-fixture',tool:'decompress',args:{blockId:'b1',toFile:exportPath}}),signal:AbortSignal.timeout(15000)})).json();
 assert.equal(restored.ok,true,JSON.stringify(restored));
 assert.ok(readFileSync(exportPath,'utf8').includes('OLD_DETAIL_ALPHA'));
 const artifacts=new BcpLocalArtifacts();artifacts.observe('decompress',[{type:'text',text:restored.result}],false);
 assert.equal(artifacts.isLocalRead({path:exportPath}),true);
 assert.equal(artifacts.isLocalRead({path:join(root,'unrelated.txt')}),false);
 console.log('PASS actual decompress export recognized by Remote SSH local-artifact routing.');
 // Test an Advisor-like side conversation using the public fork contract.
 const forkSnapshot=await(await fetch(origin+'/__bili/plugin/snapshot?conversationId=migration-fixture')).json();
 const childId='advisor-fixture';
 const forkResponse=await fetch(origin+'/__bili/plugin/fork',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({protocolVersion:1,parentConversationId:'migration-fixture',childConversationId:childId,parentRevision:forkSnapshot.parentRevision,branchPoint:{messageCount:forkSnapshot.orderedMessages.length,orderHash:forkSnapshot.orderHash},orderedMessages:forkSnapshot.orderedMessages,idempotencyKey:'advisor-fixture-once'})});
 const fork=await forkResponse.json();writeFileSync(join(root,'fork.json'),JSON.stringify(fork,null,2));assert.equal(forkResponse.status,201,JSON.stringify(fork));assert.equal(fork.status,'exact');
 const advisorMessages=structuredClone(messages);advisorMessages[0].content='You are a read-only advisor. Review the fixture.';
 advisorMessages.push({role:'user',content:'Please assess the current plan without tools.'});
 const advisorResponse=await fetch(target,{method:'POST',headers:{...headers,'x-bili-plugin-conversation':childId},body:JSON.stringify({model:'fixture',messages:advisorMessages,stream:false,tools:[],max_tokens:256}),signal:AbortSignal.timeout(15000)});
 assert.equal(advisorResponse.status,200,await advisorResponse.text());
 const advisorWire=captured.at(-1);assert.ok(JSON.stringify(advisorWire).includes('MIGRATED_SUMMARY_ALPHA'));assert.ok(!JSON.stringify(advisorWire).includes('OLD_DETAIL_ALPHA'));
 writeFileSync(join(root,'advisor-wire.json'),JSON.stringify(advisorWire,null,2));
 const parentAfter=await(await fetch(origin+'/__bili/plugin/snapshot?conversationId=migration-fixture')).json();assert.equal(parentAfter.parentRevision,forkSnapshot.parentRevision);
 console.log('PASS public fork: Advisor-like child retains parent folds with a new system prompt; parent revision unchanged.');
 // Persisted summaries are the future Memory source; do not accept just HTTP success.
 await new Promise(r=>setTimeout(r,100));
 const sessionDir=join(root,'sessions','openai');
 const persisted=readdirSync(sessionDir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(sessionDir,f),'utf8'))).find(x=>x.id==='migration-fixture');
 assert.equal(persisted?.version,3);assert.equal(persisted.payload.state.blocks.length,1);
 assert.equal(persisted.payload.state.blocks[0].summary, 'MIGRATED_SUMMARY_ALPHA: investigated the synthetic migration fixture and recorded the findings.');
 writeFileSync(join(root,'memory-source.json'),JSON.stringify(persisted,null,2));
 console.log('PASS version-3 persisted summary and raw-message references available for Memory.');
 // Exercise the collector against actual control-plane JSON and disk persistence,
 // not hand-written fixtures. An existing history stays unattributed on first load.
 const scope={id:'fixture-project',stamp:'fixture-project:0',label:'fixture'};
 const evidence=[];
 const collector=new BiliCollector({conversationId:'migration-fixture',origin:()=>origin,
  scope:()=>scope,current:()=>true,files:async()=>({files:readdirSync(sessionDir).filter(f=>f.endsWith('.json')).map(f=>join(sessionDir,f)),complete:true}),
  ingest:async(file)=>JSON.parse(readFileSync(file,'utf8')).id==='migration-fixture',
  saveEvidence:(_file,rows)=>evidence.push(rows)});
 try {
  assert.equal(await collector.scan(),'stored');
  assert.ok(evidence[0].length>0);assert.ok(evidence[0].every(row=>row.projectId===null));
  messages.push({role:'user',content:'NEW_PROJECT_EVIDENCE after baseline snapshot.'});
  response=await send();assert.equal(response.status,200,await response.text());
  await new Promise(r=>setTimeout(r,100));
  assert.equal(await collector.scan(),'stored');
  assert.ok(evidence[1].length>0);assert.ok(evidence[1].every(row=>row.projectId===scope.id));
  console.log('PASS actual proxy identities -> persisted source -> new-workspace evidence, old history not relabeled.');
 } finally {collector.stop();}
 // A fork-unsafe snapshot is NOT a failed memory source. Actual image and opaque
 // wire histories still compress/persist; status proves the exact session only,
 // so the collector indexes complete summaries without guessing project ownership.
 configureForTests({legacyOffline:false,logPath:join(root,'memory.log')});await loadSqlite();
 const store=new MemoryDb(join(root,'native-memory.sqlite'));store.open();
 try {
  for(const variant of ['image','opaque']) {
   const conversationId=`native-memory-${variant}`;
   // A fresh history, not a copy containing the earlier compress tool receipt:
   // the proxy deliberately restores folds from such receipts on replay.
   const history=structuredClone(messages.slice(0,20));
   history[0].content=`ISOLATED_NATIVE_MEMORY_${variant}`;
   history[1].content=`Start an independent ${variant} fixture.`;
   history[2].content=`NATIVE_${variant}_OLD_DETAIL `.repeat(500);
   if(variant==='image')history.push({role:'user',content:[{type:'text',text:'SYNTHETIC_IMAGE_ONLY'},{type:'image_url',image_url:{url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}}]});
   else history.push({role:'assistant',content:'SYNTHETIC_OPAQUE_AUDIO_ONLY',audio:{id:'synthetic-audio-fixture'}});
   const wire=await fetch(target,{method:'POST',headers:{...headers,'x-bili-plugin-conversation':conversationId},body:JSON.stringify({model:'fixture',messages:history,stream:false,max_tokens:256}),signal:AbortSignal.timeout(15000)});
   assert.equal(wire.status,200,await wire.text());
   const unavailable=await fetch(origin+'/__bili/plugin/snapshot?conversationId='+conversationId);assert.equal(unavailable.status,409,await unavailable.text());
   const summary=`NATIVE_${variant.toUpperCase()}_SUMMARY: earlier synthetic investigation was compressed and remains searchable despite an unsafe fork snapshot.`;
   const compressed=await(await fetch(origin+'/__bili/plugin/tool',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId,tool:'compress',args:{content:[{startId:'m00002',endId:'m00002',summary}]}}),signal:AbortSignal.timeout(15000)})).json();
   assert.equal(compressed.blocksCreated,1,JSON.stringify(compressed));
   let ingests=0,proofs=0;
   const opaqueCollector=new BiliCollector({conversationId,origin:()=>origin,scope:()=>scope,current:()=>true,
    files:async()=>({files:readdirSync(sessionDir).filter(f=>f.endsWith('.json')).map(f=>join(sessionDir,f)),complete:true}),
    ingest:async(file,id,stamp,current)=>{ingests++;return(await store.ingestSourceFile(file,{kind:'bili',expectedSessionId:id,expectedStamp:stamp},false,null,current)).ok;},
    saveEvidence:(file,rows,identity)=>{proofs++;recordBiliMessageProjects(store.db,file,rows,identity.messages);}});
   try {
    for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,100));if(await opaqueCollector.scan()==='stored'&&store.search(`NATIVE_${variant.toUpperCase()}_SUMMARY`).rows.length)break;}
    const hit=store.search(`NATIVE_${variant.toUpperCase()}_SUMMARY`).rows;assert.equal(hit.length,1);assert.equal(hit[0].summary,summary);
    assert.ok(ingests>0);assert.equal(proofs,0);assert.deepEqual(scopeAllowedIds(store.db,[hit[0].id],scope,false),[]);
    console.log(`PASS actual ${variant} snapshot409 -> successful compress/persist -> searchable complete summary, no invented project proof.`);
   }finally{opaqueCollector.stop();}
  }
 }finally{store.close();}
 // Load Pi's native extension in a separate process: its global network patches
 // must not intercept this harness or escape its isolated environment.
 const native=spawn(process.execPath,['--import','tsx',join(import.meta.dirname,'verify-billion-native.mjs'),packageDir,root,`http://127.0.0.1:${upstream.address().port}/v1`,...(process.argv[3]?[resolve(process.argv[3])]:[])],{
  cwd:resolve(import.meta.dirname,'..'),env:{...env,BILLION_CONTEXT_PROXY:origin,PI_CODING_AGENT_DIR:join(root,'native-agent'),FUYAO_MEMORY_EMBEDDING_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 let nativeLog='';native.stdout.on('data',x=>nativeLog+=x);native.stderr.on('data',x=>nativeLog+=x);
 const timer=setTimeout(()=>native.kill('SIGKILL'),45000);
 const code=await new Promise((resolve,reject)=>{native.on('error',reject);native.on('exit',resolve);});clearTimeout(timer);
 writeFileSync(join(root,'native.log'),nativeLog);assert.equal(code,0,nativeLog);console.log(nativeLog);
 const nativeWire=captured.filter(x=>JSON.stringify(x).includes('NATIVE_PI_FIXTURE'));
 assert.ok(nativeWire.length>=2,'native requests did not reach mock upstream');
 assert.ok(nativeWire.every(body=>body.service_tier==='priority'),'native Fast hook lost priority service tier');
 assert.ok(JSON.stringify(nativeWire.at(-1)).includes('NATIVE_SUMMARY_ONLY'));
 assert.ok(!JSON.stringify(nativeWire.at(-1)).includes('NATIVE_OLD_DETAIL'));
 if(process.argv[3])assert.ok(JSON.stringify(nativeWire.at(-1)).includes('NATIVE_GOAL_CONTRACT'),'Goal contract lost during proxy compression');
 assert.deepEqual(advisorWire.tools ?? [], [], 'Advisor must not gain compression tools');
 assert.equal(advisorWire.messages[0].role,'system');
 assert.ok(advisorWire.messages[0].content.includes('read-only advisor'));
 console.log('PASS isolated exact proxy startup, plugin manifest, model routing, Fast parameter retention.');console.log('Artifacts:',root);console.log('Status keys:',Object.keys(status));console.log('Snapshot keys:',Object.keys(snapshot));
}catch(e){console.error(e);process.exitCode=1;}finally{child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');upstream.closeAllConnections();await new Promise(r=>upstream.close(r));writeFileSync(join(root,'proxy.log'),log);console.log('Log:',join(root,'proxy.log'));}
