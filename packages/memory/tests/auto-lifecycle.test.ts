import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("real extension scans trigger background startup/incremental embedding; delegates and shutdown stop it", () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-auto-lifecycle-"));
  mkdirSync(join(dir, ".pi"));
  writeFileSync(join(dir, ".pi/fuyao-memory-embedding.json"), JSON.stringify({ enabled: true, autoBackfill: true,
    baseUrl: "https://example.invalid/v1", dimensions: 2, apiKeyEnv: "TEST_AUTO_KEY" }));
  try {
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import {join} from 'node:path';
      const {default:factory,loadSqlite,MemoryDb,configureForTests}=await import('./packages/memory/src/extension.ts');
      const source=join(process.env.HOME,'allowed.json');
      const {writeFileSync}=await import('node:fs'); writeFileSync(source,'{}');
      writeFileSync(join(process.env.HOME,'.pi/sources'),JSON.stringify({id:'test',adapter:'pi-sidecar',root:process.env.HOME,pattern:'allowed.json'}));
      configureForTests({dbPath:join(process.env.HOME,'.pi/memory.db'),sourcesPath:join(process.env.HOME,'.pi/sources'),logPath:join(process.env.HOME,'.pi/log'),scanOnStartup:false});
      await loadSqlite(); const seed=new MemoryDb(join(process.env.HOME,'.pi/memory.db')); seed.open();
      seed.db.prepare("INSERT INTO sources(source_file,kind,project) VALUES(?,'pi','test')").run(source);
      const add=(id)=>seed.db.prepare("INSERT INTO blocks(source_file,kind,block_id,summary) VALUES(?,'pi',?,'synthetic summary')").run(source,id);
      add('b1');
      let uploads=0;
      globalThis.fetch=async (_url,opts)=>{const input=JSON.parse(opts.body).input; uploads+=input.length; return new Response(JSON.stringify({data:input.map((_,index)=>({index,embedding:[1,0]}))}));};
      const handlers=new Map(),commands=new Map(),cards=[];
      const pi={on:(name,fn)=>handlers.set(name,fn),registerTool:()=>{},registerCommand:(name,c)=>commands.set(name,c),registerEntryRenderer:()=>{},appendEntry:(_type,data)=>cards.push(data)};
      let allowDelete=false,confirms=0;
      const ctx={mode:'tui',hasUI:true,cwd:process.cwd(),sessionManager:{getSessionFile:()=>null},ui:{notify:()=>{},confirm:async()=>{confirms++;return allowDelete;},select:async()=>undefined}};
      await factory(pi);
      const start=Date.now(); await handlers.get('session_start')({},ctx);
      assert.ok(Date.now()-start<500); assert.equal(uploads,0);
      const wait=()=>new Promise(r=>setTimeout(r,1400));
      await wait(); assert.equal(uploads,1);
      await new Promise(r=>setTimeout(r,800)); assert.equal(cards.length,1); assert.equal(cards[0].vectors,1);
      add('b2'); await handlers.get('agent_settled')({},ctx); await wait(); assert.equal(uploads,2);
      await new Promise(r=>setTimeout(r,800)); assert.equal(cards.length,2);
      add('b3');
      const before=cards.length;
      writeFileSync(join(process.env.HOME,'.pi/sources'),JSON.stringify({id:'overlap',adapter:'opencode-acp',root:process.env.HOME,pattern:'allowed.json'}));
      await handlers.get('agent_settled')({},ctx); await wait(); assert.equal(uploads,2,'different adapter cannot authorize retained pi blocks');
      writeFileSync(join(process.env.HOME,'.pi/sources'),JSON.stringify({id:'test',adapter:'pi-sidecar',root:process.env.HOME,pattern:'allowed.json'}));
      await handlers.get('agent_settled')({},ctx); await handlers.get('session_shutdown')({},ctx); await wait(); assert.equal(uploads,2);
      process.env.PI_ACP_DELEGATE_DEPTH='1'; await factory(pi); await handlers.get('session_start')({},ctx); await wait(); assert.equal(uploads,2);
      assert.equal(cards.length,before,'shutdown and delegates do not emit stale cards');
      seed.db.prepare('UPDATE blocks SET summary=? WHERE block_id=?').run('full detail '.repeat(100)+'DETAIL_TAIL','b3');
      let browserOutput='';
      ctx.ui.custom=async(build)=>{ const theme={fg:(_c,s)=>s,bold:s=>s}; const view=build({terminal:{rows:24},requestRender:()=>{}},theme,{},()=>{});
        assert.ok(!view.render(60).join('').includes('DETAIL_TAIL')); view.handleInput('\\r'); view.render(60); view.handleInput('\\x1b[F'); browserOutput=view.render(60).join(''); };
      await commands.get('memory').handler('browse',ctx); assert.match(browserOutput,/DETAIL_TAIL/);
      seed.db.prepare('UPDATE blocks SET created_at=1 WHERE block_id=?').run('b1');
      await commands.get('memory').handler('prune 30',ctx);assert.equal(confirms,1);assert.equal(seed.db.prepare('SELECT count(*) AS n FROM blocks').get().n,3);
      allowDelete=true; await commands.get('memory').handler('prune 30',ctx);assert.equal(confirms,2);assert.equal(seed.db.prepare('SELECT count(*) AS n FROM blocks').get().n,2);
      await handlers.get('session_shutdown')({},ctx); seed.close();
    `], { cwd: process.cwd(), env: { ...process.env, HOME: dir, FUYAO_MEMORY_EMBEDDING_DISABLED: "0", TEST_AUTO_KEY: "synthetic", PI_ACP_DELEGATE_DEPTH: "0" }, encoding: "utf8", timeout: 20000 });
    assert.equal(child.status, 0, child.stderr + child.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
