// Child of verify-billion-context.mjs. Isolated HOME/environment, loopback only.
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { createBcpConnectionInheritance } from '../packages/remote-ssh/src/pi/integrations/bcp-inheritance.ts';
import { resolvePiRuntimeAssembly } from '../packages/remote-ssh/src/pi/assembly.ts';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createReadTool, createWriteTool, createEditTool, createBashTool, createFindTool, createGrepTool, createLsTool, DefaultResourceLoader, SettingsManager, SessionManager, createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';
const [packageDir, root, upstream, goalPath] = process.argv.slice(2);
assert.ok(packageDir && root && upstream && process.env.BILLION_CONTEXT_PROXY);
const agentDir=join(root,'native-agent');mkdirSync(agentDir,{recursive:true});
const modelsPath=join(agentDir,'models.json');
writeFileSync(join(agentDir,'settings.json'),JSON.stringify({'pi-gpt-fast-mode':{enabled:true}}));
writeFileSync(modelsPath,JSON.stringify({providers:{cpa:{baseUrl:upstream,api:'openai-completions',apiKey:'offline-fixture',models:[{id:'gpt-5.5',name:'Fixture',reasoning:false,input:['text'],contextWindow:100000,maxTokens:256,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}));
const sources=join(root,'native-sources.jsonl');
writeFileSync(sources,JSON.stringify({id:'proxy',adapter:'bili-session',root:join(root,'sessions'),pattern:'**/*.json',enabled:true})+'\n');
// Environment is isolated before loading the actual extension through Pi's loader.
mkdirSync(join(process.env.HOME,'.pi/bili-memory'),{recursive:true});
writeFileSync(join(process.env.HOME,'.pi/bili-memory/config.json'),JSON.stringify({dbPath:join(root,'native-memory.sqlite'),sourcesPath:sources,logPath:join(root,'native-memory.log'),expandEnabled:true}));
const repo=resolve(import.meta.dirname,'..');
const packages=[packageDir,join(repo,'packages/bili-memory'),join(repo,'packages/gpt-fast-mode'),join(repo,'packages/statusline')];
if(goalPath) packages.push(goalPath);
const settingsManager=SettingsManager.inMemory({packages,compaction:{enabled:false},retry:{enabled:false}});
const loader=new DefaultResourceLoader({cwd:root,agentDir,settingsManager,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
const modelRuntime=await ModelRuntime.create({authPath:join(agentDir,'auth.json'),modelsPath,modelsStorePath:join(agentDir,'models-store.json'),allowModelNetwork:false});
await loader.reload();assert.deepEqual(loader.getExtensions().errors,[]);
const sm=SessionManager.create(root,join(agentDir,'sessions'));
const goal={id:'native-fixture-goal',text:'NATIVE_GOAL_CONTRACT verify offline migration',status:'active',startedAt:Date.now(),updatedAt:Date.now(),iteration:1,tokensUsed:0,timeUsedSeconds:0,baselineTokens:0,automaticModelTurns:0,toolFreeRepeatCount:0};
if(goalPath)sm.appendCustomEntry('goal-state',{goal});
const {session}=await createAgentSession({cwd:root,agentDir,settingsManager,resourceLoader:loader,sessionManager:sm,modelRuntime,model:modelRuntime.getModel('cpa','gpt-5.5')});
const errors=[];
try {
 await session.bindExtensions({mode:'print',onError:e=>errors.push(e.error)});
 const queued=[];
 // Observe Goal continuation without allowing a mock endpoint to run unbounded.
 loader.getExtensions().runtime.sendUserMessage=(content,options)=>queued.push({content,options});
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const assistant=text=>({role:'assistant',content:[{type:'text',text}],api:'openai-completions',provider:'cpa',model:'gpt-5.5',timestamp:Date.now(),stopReason:'stop',usage});
 sm.appendMessage({role:'user',content:'Start native fixture',timestamp:1});
 sm.appendMessage(assistant('NATIVE_OLD_DETAIL '.repeat(650)));
 for(let i=0;i<8;i++){
  sm.appendMessage({role:'user',content:`Recent native request ${i}. `.repeat(220),timestamp:i+2});
  sm.appendMessage(assistant(`Recent native answer ${i}. `.repeat(220)));
 }
 await session.prompt('NATIVE_PI_FIXTURE first request via native extension.');
 assert.equal(session.messages.at(-1)?.stopReason,'stop',JSON.stringify(session.messages.at(-1)));
 assert.ok(session.getActiveToolNames().includes('compress'));
 assert.ok(session.getActiveToolNames().includes('memory_search'));
 if(goalPath)assert.ok(session.getActiveToolNames().includes('goal_complete'));
 const origin=process.env.BILLION_CONTEXT_PROXY;
 const status=await(await fetch(`${origin}/__bili/plugin/status?conversationId=${encodeURIComponent(sm.getSessionId())}`)).json();
 assert.equal(status.ok,true,JSON.stringify(status));assert.equal(status.conversationId,sm.getSessionId());
 await new Promise(r=>setTimeout(r,900));
 const snapshot=await(await fetch(`${origin}/__bili/plugin/snapshot?conversationId=${encodeURIComponent(sm.getSessionId())}`)).json();
 const old=snapshot.messages.find(m=>m.text?.includes('NATIVE_OLD_DETAIL'));
 assert.ok(old,'native old history missing');
 const args={content:[{startId:old.ref,endId:old.ref,summary:'NATIVE_SUMMARY_ONLY: the earlier synthetic investigation is finished, and its findings are preserved here.'}]};
 const runner=session.extensionRunner;
 sm.appendMessage({...assistant(''),stopReason:'toolUse',content:[{type:'toolCall',id:'native-fold',name:'compress',arguments:args}]});
 const result=await session.getToolDefinition('compress').execute('native-fold',args,undefined,undefined,runner.createToolContext('native-fold',undefined));
 assert.ok(JSON.stringify(result).includes('NATIVE_SUMMARY_ONLY') || JSON.stringify(result).includes('b1'),JSON.stringify(result));
 sm.appendMessage({role:'toolResult',toolName:'compress',toolCallId:'native-fold',content:result.content,isError:false,timestamp:Date.now()});
 await runner.emit({type:'tool_execution_end',toolCallId:'native-fold',toolName:'compress',result,isError:false});
 await session.prompt('NATIVE_PI_FIXTURE second request, verify stable identity.');
 assert.equal(session.messages.at(-1)?.stopReason,'stop');
 await new Promise(r=>setTimeout(r,1100));
 const db=new DatabaseSync(join(root,'native-memory.sqlite'),{readOnly:true});
 let originalSource;
 try {
  originalSource=db.prepare("SELECT source_file FROM blocks WHERE summary LIKE 'NATIVE_SUMMARY_ONLY%'").get()?.source_file;
  assert.equal(db.prepare("SELECT count(*) AS n FROM blocks WHERE summary LIKE 'NATIVE_SUMMARY_ONLY%'").get().n,1);
  assert.ok(db.prepare('SELECT count(*) AS n FROM memory_workspace_intervals').get().n>0);
 } finally {db.close();}
 const memoryExpand=session.getToolDefinition('memory_expand');
 const expandCtx=runner.createToolContext('native-expand',undefined);
 const manifest=await memoryExpand.execute('native-list',{block:'b1',source:originalSource,scope:'all',mode:'list'},undefined,undefined,expandCtx);
 assert.equal(manifest.details.mode,'list',JSON.stringify(manifest));
 assert.ok(manifest.details.revision);
 const original=await memoryExpand.execute('native-full',{block:'b1',source:originalSource,scope:'all',mode:'full',select:[1],revision:manifest.details.revision},undefined,undefined,expandCtx);
 assert.equal(original.details.mode,'full',JSON.stringify(original));
 assert.ok(original.content[0].text.includes('NATIVE_OLD_DETAIL'));
 console.log('PASS native Memory list -> revision-bound original text chunk.');
 if(goalPath){
  assert.ok(queued.length>0,'active Goal did not request continuation');
  const count=queued.length;
  await session.extensionRunner.emit({type:'agent_settled',aborted:false});
  assert.equal(queued.length,count,'duplicate settled event queued twice');
  await session.getToolDefinition('goal_complete').execute('native-goal-done',{goal_id:goal.id,summary:'Offline integration verified.'},undefined,undefined,session.extensionRunner.createToolContext('native-goal-done',undefined));
  const latest=sm.getBranch().filter(e=>e.type==='custom'&&e.customType==='goal-state').at(-1);
  assert.equal(latest.data.goal,null);
 }
 // Use the upstream acp_delegate implementation, its child environment and our
 // actual dispatcher. The child uses Pi SDK + compiled SSH worker, not a mock read.
 const remoteDir=join(root,'delegate-remote'), localDir=join(root,'delegate-local'), bin=join(root,'delegate-bin');
 for(const dir of [remoteDir,localDir,bin])mkdirSync(dir,{recursive:true});
 writeFileSync(join(remoteDir,'delegate-probe.txt'),'DELEGATE_REMOTE_CONTENT');
 writeFileSync(join(localDir,'delegate-probe.txt'),'WRONG_LOCAL_CONTENT');
 const worker=join(repo,`packages/remote-ssh/dist/worker-linux-${process.arch}`);
 writeFileSync(join(bin,'ssh'),`#!/bin/sh\nexec '${worker.replaceAll("'", "'\\\"'\\\"'")}'\n`);chmodSync(join(bin,'ssh'),0o755);
 const coreTools=[createReadTool(remoteDir),createWriteTool(remoteDir),createEditTool(remoteDir),createBashTool(remoteDir),createFindTool(remoteDir),createGrepTool(remoteDir),createLsTool(remoteDir)];
 const assembly=await resolvePiRuntimeAssembly({tools:coreTools.map(t=>({...t,sourceInfo:{source:'builtin',path:`<builtin:${t.name}>`,scope:'temporary',origin:'top-level'}}))});
 const beforeEnv={...process.env};
 const inheritance=createBcpConnectionInheritance({launcher:join(repo,'packages/remote-ssh/dist/bcp-launcher.js'),extension:join(repo,'packages/remote-ssh/dist/pi-extension.js'),cli:join(repo,'scripts/verify-billion-delegate.mjs')});
 try {
  process.env.PATH=`${bin}:${process.env.PATH}`;
  process.env.FUYAO_DELEGATE_LOCAL_FIXTURE=localDir;
  delete process.env.PI_CLI_PATH;
  inheritance.publish({ownerToken:'native-delegate-fixture',assembly:assembly.request,tools:assembly.tools,connectOptions:{target:'fixture-host',displayTarget:'fixture-host'},workerPath:worker,cwd:remoteDir});
  const delegated=await session.getToolDefinition('acp_delegate').execute('native-delegate',{agent:'researcher',task:'Offline SSH routing fixture',async:false,timeoutMinutes:0.5},undefined,undefined,runner.createToolContext('native-delegate',undefined));
  const reply=delegated.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
  assert.ok(reply.includes('exit 0'),reply);
  const output=reply.match(/Full result: `([^`]+)`/)?.[1];
  assert.ok(output,reply);
  assert.ok(readFileSync(output,'utf8').includes('DELEGATE_REMOTE_VERIFIED'));
  console.log('PASS actual Billion Context delegate -> dispatcher -> restricted SDK child -> SSH worker routing.');
 } finally {
  inheritance.clear('native-delegate-fixture');
  for(const key of Object.keys(process.env))if(!(key in beforeEnv))delete process.env[key];
  Object.assign(process.env,beforeEnv);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS native compress -> delayed persistence -> bili-memory ingestion.');
 console.log('PASS native Pi loader + actual model transport interception + proxy identity + Memory + active Goal continuation/completion.');
 writeFileSync(join(root,'native-result.json'),JSON.stringify({sessionId:sm.getSessionId(),tools:session.getActiveToolNames(),errors},null,2));
} finally {await session.extensionRunner.emit({type:'session_shutdown',reason:'quit'});session.dispose();}
// Native extension owns global background timers; this isolated process exits after cleanup.
process.exit(0);
