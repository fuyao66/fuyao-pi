import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync,unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureForTests,loadSqlite,getDb,buildSourcePolicy } from '../src/extension.ts';
import { HybridMemory } from '../src/hybrid.ts';
import { sanitizeEmbeddingConfig } from '../src/embeddings.ts';

test('one policy checks source, format, block presence and revisions before search/upload',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'source-policy-')); const source=join(dir,'source.acp.json'),list=join(dir,'sources');
 configureForTests({dbPath:join(dir,'db'),sourcesPath:list,logPath:join(dir,'log')});await loadSqlite();const db=getDb();db.open();
 const rule=(enabled=true,adapter='pi-sidecar')=>writeFileSync(list,JSON.stringify({id:'test',root:dir,pattern:'*.acp.json',adapter,enabled}));
 const blocks=Array.from({length:25},(_,i)=>({blockId:`b${i}`,summary:'sharedneedle '+i,active:false}));
 const save=(value=blocks)=>writeFileSync(source,JSON.stringify({blocks:value}));
 const refresh=async()=>{const policy=await buildSourcePolicy();return Object.assign((row:any)=>policy.allows(row),{allowedIds:policy.allowedIds});};
 try{
  rule();save();await db.ingestSourceFile(source,{kind:'pi'},true);
  let p=await buildSourcePolicy();assert.equal(p.allowedIds.length,25,'inactive children remain searchable');
  save([blocks[0]]);p=await buildSourcePolicy();assert.equal(p.allowedIds.length,1);
  assert.equal(db.search('sharedneedle',{allowedIds:p.allowedIds,limit:1}).rows[0].blockId,'b0');
  const config=sanitizeEmbeddingConfig({enabled:true,baseUrl:'https://example.invalid/v1',dimensions:2});
  let sent=0;const hybrid=new HybridMemory(db,config,x=>x,{embed:async(x:string[])=>{sent+=x.length;return x.map(()=>[1,0]);}} as any);
  assert.equal((await hybrid.backfill(20,refresh)).stored,1);assert.equal(sent,1);
  const snapshot=p;
  db.db.prepare('UPDATE blocks SET summary=? WHERE id=?').run('unvalidated replacement',p.allowedIds[0]);
  assert.equal(db.search('unvalidated',{authorizedRows:snapshot.authorizedRows}).rows.length,0);
  assert.equal(snapshot.allows({...snapshot.authorizedRows[0],msgIds:'["changed"]'}),false);
  await db.ingestSourceFile(source,{kind:'pi'},true);
  rule(false);p=await buildSourcePolicy();assert.equal(p.allowedIds.length,0);assert.equal(p.state(1),'disabled/excluded');
  assert.equal((await hybrid.backfill(20,refresh)).uploaded,0);
  rule(true,'opencode-acp');assert.equal((await buildSourcePolicy()).allowedIds.length,0);
  rule();unlinkSync(source);p=await buildSourcePolicy();assert.equal(p.state(1),'missing/unreadable');
  save([{...blocks[0],summary:'revisedneedle'}]);p=await buildSourcePolicy();assert.equal(p.state(1),'revision-stale');
  await db.ingestSourceFile(source,{kind:'pi'},true);p=await buildSourcePolicy();assert.equal(p.allowedIds.length,1);
  assert.equal(db.search('revisedneedle',{allowedIds:p.allowedIds}).rows.length,1);
  save([blocks[24]]); await db.ingestSourceFile(source,{kind:'pi'},true);
  const capped=new HybridMemory(db,{...config,maxBlocks:1},x=>x,{embed:async(x:string[])=>x.map(()=>[1,0])} as any);
  assert.equal((await capped.backfill(20,refresh)).stored,1,'ineligible prefix cannot starve eligible rows');
  assert.equal(db.db.prepare('SELECT count(*) n FROM blocks').get().n,25,'policy never deletes history');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
