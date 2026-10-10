// Invoked by the isolated native probe. The actual upstream delegate spawns this
// SDK child through our real dispatcher; no LLM request is needed to prove routing.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DefaultResourceLoader, SettingsManager, SessionManager, createAgentSession } from '@earendil-works/pi-coding-agent';
const extension=process.env.PI_BCP_REMOTE_EXTENSION;
assert.ok(extension && process.env.PI_BCP_REMOTE_CONNECTION);
assert.equal(process.env.PI_ACP_DELEGATE_DEPTH,'1');
const args=process.argv.slice(2);const toolIndex=args.indexOf('--tools');
assert.ok(toolIndex>=0);assert.ok(!args[toolIndex+1].split(',').includes('write'));
const settingsManager=SettingsManager.inMemory({});
const cwd=resolve(process.env.FUYAO_DELEGATE_LOCAL_FIXTURE);
const loader=new DefaultResourceLoader({cwd,agentDir:cwd,settingsManager,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,additionalExtensionPaths:[extension]});
await loader.reload();assert.deepEqual(loader.getExtensions().errors,[]);
const {session}=await createAgentSession({cwd,agentDir:cwd,settingsManager,resourceLoader:loader,sessionManager:SessionManager.inMemory(cwd),tools:['read','bash']});
try {
 await session.bindExtensions({mode:'print'});
 const result=await session.getToolDefinition('read').execute('delegate-read',{path:'delegate-probe.txt'},undefined,undefined,session.extensionRunner.createToolContext('delegate-read',undefined));
 assert.ok(JSON.stringify(result).includes('DELEGATE_REMOTE_CONTENT'),JSON.stringify(result));
 assert.ok(!JSON.stringify(result).includes('WRONG_LOCAL_CONTENT'));
 console.log('DELEGATE_REMOTE_VERIFIED');
}finally{await session.extensionRunner.emit({type:'session_shutdown',reason:'quit'});session.dispose();}
