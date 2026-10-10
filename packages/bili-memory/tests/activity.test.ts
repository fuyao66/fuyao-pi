import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ActivityFeed, preview } from "../src/activity.ts";
import { ActivityCards, cardLines, memoryMenu, MEMORY_CARD, registerMemoryCards } from "../src/memory-ui.ts";
import { loadSqlite, MemoryDb, configureForTests } from "../src/extension.ts";
import { HybridMemory } from "../src/hybrid.ts";
import { redactSecrets, withoutPaths } from "../src/extension.ts";
import { defaults } from "../src/embeddings.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import { SessionManager, buildSessionContext } from "@earendil-works/pi-coding-agent";

test("cards batch, cap previews, sanitize controls and stay outside model context", () => {
  const sm=SessionManager.inMemory(); let valid=true;
  const cards=new ActivityCards(card=>sm.appendCustomEntry(MEMORY_CARD,card),()=>valid);
  const rows=Array.from({length:30},(_,i)=>({blockId:`b${i}`,summary:'\x1b[31m中文\r\n'+ 'x'.repeat(500),topic:'主题'}));
  cards.saved('summary',rows); cards.saved('vector',rows,30,'test',2); cards.flush();
  const entries=sm.getEntries(); assert.equal(entries.length,1);
  const data=(entries[0] as any).data;
  assert.equal(data.summaries,30);assert.equal(data.vectors,30);assert.equal(data.records.length,12);
  assert.ok(data.records.every((r:any)=>r.summary.length<=200&&!r.summary.includes('\x1b')));
  assert.deepEqual(cardLines(data,true), ['Bili-Memory · Updated 30 memories']);
  assert.deepEqual(buildSessionContext(entries,sm.getLeafId()).messages,[]);
  cards.flush();assert.equal(sm.getEntries().length,1);
  cards.state('backoff');cards.flush();cards.state('backoff');cards.flush();assert.equal(sm.getEntries().length,2);
  cards.state('scheduled');cards.flush();assert.equal(sm.getEntries().length,2,'recovery stays silent');
  cards.saved('summary',rows);valid=false;cards.flush();assert.equal(sm.getEntries().length,2);
  cards.stop();cards.saved('summary',rows);cards.flush();assert.equal(sm.getEntries().length,2);
});
test("automatic cards wait through scheduled/network time and report each completed batch once", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const emitted:any[]=[]; const cards=new ActivityCards(x=>emitted.push(x),()=>true,x=>x,750,true);
  const row={identity:'a'.repeat(64),blockId:'b1',project:'test',topic:'One'};
  cards.saved('summary',[row],2); cards.state('scheduled');
  t.mock.timers.tick(5000); assert.equal(emitted.length,0);
  assert.equal(cards.beginBatch(),true); assert.equal(cards.beginBatch(),false);
  t.mock.timers.tick(10000); assert.equal(emitted.length,0);
  cards.saved('vector',[row],2,'model',2); cards.endBatch();
  assert.equal(emitted.length,1);assert.equal(emitted[0].summaries,2);assert.equal(emitted[0].vectors,2);
  assert.deepEqual(cardLines(emitted[0],true), ['Bili-Memory · Updated 2 memories']);
  cards.state('idle');t.mock.timers.tick(5000);assert.equal(emitted.length,1);cards.stop();
});
test("cycles preserve partial saves, deduplicate failures and keep vector-only recovery silent",()=>{
  const emitted:any[]=[];let current=true;const cards=new ActivityCards(x=>emitted.push(x),()=>current,x=>x,750,true);
  const row={identity:'a'.repeat(64),blockId:'b1'};const other={identity:'b'.repeat(64),blockId:'b1'};
  cards.saved('summary',[row]);cards.beginBatch();cards.saved('summary',[other]);
  cards.saved('vector',[row],1,'model',2);cards.endBatch(true);cards.state('backoff');
  assert.equal(emitted[0].summaries,1);assert.equal(emitted[0].vectors,1);assert.equal(emitted[0].outcome,'retry');
  assert.equal(emitted[1].summaries,1);assert.equal(emitted[1].vectors,0);
  assert.deepEqual(cardLines(emitted[0]),['Bili-Memory · Updated 1 memory · Embedding failed; retrying']);
  assert.deepEqual(cardLines(emitted[1]),['Bili-Memory · Updated 1 memory']);
  cards.beginBatch();cards.endBatch(true);cards.state('backoff');assert.equal(emitted.length,2);
  cards.beginBatch();cards.saved('vector',[other],1,'model',2);cards.endBatch();assert.equal(emitted.length,2);
  for(let i=0;i<3;i++){cards.beginBatch();cards.saved('vector',Array(20).fill(row),20,'model',2);cards.endBatch();}
  assert.equal(emitted.length,2);assert.ok(emitted.every(x=>x.records.length<=12));
  cards.beginBatch();cards.endBatch(true);cards.state('backoff');assert.equal(emitted.length,3,'new failure after recovery is reported once');
  assert.deepEqual(cardLines(emitted[2]),['Bili-Memory · Embedding failed; retrying']);
  cards.saved('summary',[row,other]);cards.beginBatch();current=false;cards.endBatch();assert.equal(emitted.length,3);
  cards.stop();
});
test("disabled auto emits without embedding, and identities from different sources are not merged", (t)=>{
  t.mock.timers.enable({apis:['setTimeout']});const emitted:any[]=[];
  const cards=new ActivityCards(x=>emitted.push(x),()=>true);
  cards.saved('summary',[{identity:'a'.repeat(64),blockId:'b1'},{identity:'b'.repeat(64),blockId:'b1'}]);
  t.mock.timers.tick(750);assert.equal(emitted.length,1);assert.equal(emitted[0].vectors,0);
  assert.deepEqual(cardLines(emitted[0],false), ['Bili-Memory · Updated 2 memories']);cards.stop();
});
test("manual-only cycles flush concurrent summaries and never promise automatic retry", (t)=>{
  t.mock.timers.enable({apis:['setTimeout']});const emitted:any[]=[];
  const cards=new ActivityCards(x=>emitted.push(x),()=>true);
  cards.beginBatch();cards.saved('summary',[{blockId:'later'}]);cards.endBatch(true);
  assert.equal(emitted.length,1);assert.equal(emitted[0].outcome,'failed');
  assert.match(cardLines(emitted[0],false).join('\n'),/check \/bili-memory/);
  assert.doesNotMatch(cardLines(emitted[0],false).join('\n'),/retry.*background/);
  t.mock.timers.tick(750);assert.equal(emitted.length,2);assert.equal(emitted[1].summaries,1);
  assert.equal(emitted[1].outcome,undefined);cards.stop();
});
test("feedback has only memory updates and embedding failures; success and recovery are silent",()=>{
  const card=(summaries:number,vectors:number,extra:Partial<Parameters<typeof cardLines>[0]>={})=>({summaries,vectors,records:[],at:1,...extra});
  assert.deepEqual(cardLines(card(1,0)),['Bili-Memory · Updated 1 memory']);
  assert.deepEqual(cardLines(card(0,1)),[]);
  assert.deepEqual(cardLines(card(0,20)),[]);
  // Different commit counts must not imply all newly saved summaries are ready.
  assert.deepEqual(cardLines(card(4,1)),['Bili-Memory · Updated 4 memories']);
  assert.deepEqual(cardLines(card(2,1,{outcome:'retry'})),['Bili-Memory · Updated 2 memories · Embedding failed; retrying']);
  assert.deepEqual(cardLines(card(0,0,{outcome:'failed'})),['Bili-Memory · Embedding failed; check /bili-memory']);
  assert.deepEqual(cardLines(card(0,0,{state:'resumed'})),[]);
  assert.deepEqual(cardLines(card(1,0,{state:'resumed'})),['Bili-Memory · Updated 1 memory']);
  for(const sample of [card(3,5),card(0,0,{state:'backoff'}),card(3,0)]) {
    const line=cardLines(sample).join('\n');
    assert.match(line,/^Bili-Memory · /);
    assert.doesNotMatch(line,/Indexed|vectors|Search improved|all memories ready/i);
    assert.equal(cardLines(sample).length,1);
    assert.deepEqual(cardLines(sample,true),cardLines(sample,false));
  }
});
test("no vector-only entries are persisted; repeated non-retrying failures deduplicate until success",()=>{
  const emitted:any[]=[];const cards=new ActivityCards(x=>emitted.push(x),()=>true);
  cards.saved('vector',[{blockId:'b1'}]);cards.flush();assert.equal(emitted.length,0);
  cards.beginBatch();cards.endBatch(true);
  assert.deepEqual(cardLines(emitted[0]),['Bili-Memory · Embedding failed; check /bili-memory']);
  cards.beginBatch();cards.endBatch(true);assert.equal(emitted.length,1);
  cards.saved('summary',[{blockId:'b2'}]);cards.beginBatch();cards.endBatch(true);
  assert.deepEqual(cardLines(emitted[1]),['Bili-Memory · Updated 1 memory']);
  cards.beginBatch();cards.saved('vector',[{blockId:'b2'}]);cards.endBatch();assert.equal(emitted.length,2);
  cards.beginBatch();cards.endBatch(true);assert.equal(emitted.length,3);
  assert.deepEqual(cardLines(emitted[2]),['Bili-Memory · Embedding failed; check /bili-memory']);
  cards.stop();
});
test("user menu exposes only three core actions; cancel, expiry and no-op remain safe",async()=>{
  const expected=['browse','status','rescan'];
  let labels:string[]=[];
  for(let i=0;i<expected.length;i++){
    const result=await memoryMenu({mode:'tui',hasUI:true,ui:{select:async(title:string,items:string[])=>{
      assert.equal(title,'Bili Memory\nstatus');labels=items;return items[i];
    }}} as any,'status',()=>true);
    assert.equal(result,expected[i]);
  }
  assert.deepEqual(labels,['Browse memories','View status','Refresh memories']);
  for(const selection of [undefined,'Session activity','Prepare semantic search','Prune old memories','View sources']) {
    assert.equal(await memoryMenu({mode:'tui',hasUI:true,ui:{select:async()=>selection}} as any,'status',()=>true),undefined);
  }
  let current=true;
  assert.equal(await memoryMenu({mode:'tui',hasUI:true,ui:{select:async()=>{current=false;return 'Refresh memories';}}} as any,'status',()=>current),undefined);
  const emitted:any[]=[];const cards=new ActivityCards(x=>emitted.push(x),()=>true);
  cards.flush();cards.beginBatch();cards.endBatch();cards.flush();
  assert.equal(emitted.length,0);cards.stop();
});
test("all display fields are sanitized before card persistence and activity browsing",()=>{
  const sanitize=(x:string)=>withoutPaths(redactSecrets(x).text);
  const secret='api_key=synthetic-secret-123456';const path='/home/alice/.pi/agent/sessions/private.jsonl';
  const record={blockId:path,project:path,topic:secret,summary:path+' '+secret};
  let data:any;const cards=new ActivityCards(x=>data=x,()=>true,sanitize);
  cards.saved('summary',[record]);cards.saved('vector',[record],1,secret,2);cards.flush();cards.stop();
  const feed=new ActivityFeed(80,sanitize);feed.add({...record,type:'vector',model:secret});
  for(const result of [JSON.stringify(data),JSON.stringify(feed.recent()),cardLines(data,true).join('\n')]) {
    assert.ok(!result.includes('synthetic-secret-123456'));assert.ok(!result.includes(path));
  }
});
test("actual card renderer respects Chinese narrow/wide terminal widths",()=>{
  const theme={fg:(_color:string,text:string)=>`\x1b[37m${text}\x1b[39m`,bg:(_color:string,text:string)=>`\x1b[40m${text}\x1b[49m`,bold:(text:string)=>`\x1b[1m${text}\x1b[22m`};let renderer:any;
  registerMemoryCards({registerEntryRenderer:(_type:string,r:any)=>renderer=r} as any);
  for(const expanded of [false,true])for(const width of [12,30,80]) {
    const component=renderer({data:{summaries:1,vectors:1,model:'text-embedding-3-large',dimensions:3072,at:1,
      records:[{type:'summary',blockId:'b1',topic:'中文摘要主题'.repeat(10),summary:'内容'.repeat(100)}]}},{expanded},theme);
    const lines=component.render(width);
    assert.equal(lines.length,1);
    assert.ok(lines.every((line:string)=>visibleWidth(line)<=width));
    component.invalidate();assert.ok(component.render(width).length>0);
  }
  for(const data of [undefined,{summaries:0,vectors:1,records:[],at:1},{summaries:0,vectors:0,records:[],state:'resumed',at:1}]) {
    assert.equal(renderer({data},{expanded:false},theme),undefined,'old vector-only/recovery entries have no blank UI row');
  }
});
test("bounded activity observers cannot break processing; non-TUI menu never requests terminal dialogs",async()=>{
  const feed=new ActivityFeed(3);let changes=0;const off=feed.subscribe(()=>changes++);
  for(let i=0;i<10;i++)feed.add({type:'summary',blockId:`b${i}`});
  assert.equal(feed.recent(100).length,3);off();feed.add({type:'state',blockId:''});assert.equal(changes,10);
  assert.equal(preview('\x1b[31m中\n文\x00'),'中 文');
  let notices=0;assert.equal(await memoryMenu({mode:'rpc',hasUI:true,ui:{notify:()=>notices++,select:()=>{throw Error('not allowed');}}} as any,'status',()=>true),undefined);
  assert.equal(notices,1);
});
test("summary/vector events only follow successful commit; duplicate scans and failed writes stay silent",async()=>{
  const dir=mkdtempSync(join(tmpdir(),'memory-events-'));
  configureForTests({dbPath:join(dir,'test.db'),logPath:join(dir,'log')});await loadSqlite();
  const store=new MemoryDb(join(dir,'test.db'));store.open();let summaries=0,vectors=0;
  store.onStored=(_rows,count)=>summaries+=count;
  const file=join(dir,'source.acp.json');
  const source=(id:string)=>writeFileSync(file,JSON.stringify({blocks:[{blockId:id,summary:'synthetic summary',topic:'test'}]}));
  try {
    source('b1');assert.equal((await store.ingestSourceFile(file,{kind:'pi'},true)).inserted,1);assert.equal(summaries,1);
    await store.ingestSourceFile(file,{kind:'pi'},true);assert.equal(summaries,1);
    store.db.exec("CREATE TRIGGER block_failure BEFORE INSERT ON blocks WHEN new.block_id='b2' BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
    source('b2');assert.equal((await store.ingestSourceFile(file,{kind:'pi'},true)).ok,false);assert.equal(summaries,1);
    const hybrid=new HybridMemory(store,{...defaults,enabled:true,dimensions:2},x=>x,{embed:async()=>[[1,0]]} as any,()=>true,rows=>vectors+=rows.length);
    store.db.exec("CREATE TRIGGER vector_failure BEFORE INSERT ON memory_vectors BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
    await assert.rejects(hybrid.backfill(1));assert.equal(vectors,0);
    store.db.exec('DROP TRIGGER vector_failure');await hybrid.backfill(1);assert.equal(vectors,1);
    await hybrid.backfill(1);assert.equal(vectors,1);
    store.db.prepare('UPDATE blocks SET created_at=1').run();
    const maxId=store.db.prepare('SELECT max(id) AS n FROM blocks').get().n;
    store.db.exec('DROP TRIGGER block_failure');source('b2');await store.ingestSourceFile(file,{kind:'pi'},true);
    store.db.prepare('UPDATE blocks SET created_at=1').run();
    const removed=store.prune(0,Date.now(),maxId);assert.equal(removed.removedBlocks,1);assert.equal(removed.remainingBlocks,1);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
