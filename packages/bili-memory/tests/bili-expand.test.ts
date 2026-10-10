import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandBiliBlock } from '../src/bili-expand.js';

test('proxy originals use bounded revision-bound chunks, redact before slicing and reject stale reads', async()=>{
 const root=await mkdtemp(join(tmpdir(),'bili-expand-'));const file=join(root,'session.json');
 const doc={version:3,id:'session',payload:{version:3,id:'session',state:{blocks:[{blockId:'b1',summary:'stored'}]},blockContents:{b1:{full:{text:'x'.repeat(3998)+'SECRET'+'😀'.repeat(60)}}}}};
 const opts={file,blockId:'b1',summary:'stored',mode:'list' as const,maxReadBytes:100000,maxChars:4500,maxMessages:2,redact:(text:string)=>({text:text.replaceAll('SECRET','[redacted]')})};
 try{
  await writeFile(file,JSON.stringify(doc));
  const list=await expandBiliBlock(opts);assert.equal(list.chunks,2);assert.ok(!list.text.includes('SECRET'));
  await assert.rejects(expandBiliBlock({...opts,mode:'full',select:[1]}),/revision/);
  const full=await expandBiliBlock({...opts,mode:'full',select:[1,2],revision:list.revision});
  assert.ok(!full.text.includes('SECRET'));assert.ok(full.text.includes('😀'));assert.ok(full.returnedChars<=4500);
  const small=await expandBiliBlock({...opts,mode:'full',select:[1],revision:list.revision,maxChars:17});assert.equal(small.truncated,true);assert.ok(small.text.length<=17);
  await assert.rejects(expandBiliBlock({...opts,maxReadBytes:10}),/budget/);
  await assert.rejects(expandBiliBlock({...opts,summary:'changed'}),/revision/);
  await assert.rejects(expandBiliBlock({...opts,signal:AbortSignal.abort()}),/cancelled/);
  const link=join(root,'link');await symlink(file,link);await assert.rejects(expandBiliBlock({...opts,file:link}),/symlink/);
  doc.payload.blockContents.b1.full.text='changed';await writeFile(file,JSON.stringify(doc));
  await assert.rejects(expandBiliBlock({...opts,mode:'full',select:[1],revision:list.revision}),/revision/);
  await writeFile(file,JSON.stringify({...doc,version:4}));await assert.rejects(expandBiliBlock(opts),/Unsupported/);
 }finally{await rm(root,{recursive:true,force:true});}
});
