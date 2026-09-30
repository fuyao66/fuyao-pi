import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { cleanBody, MemoryBrowser, showMemoryBrowser, type BrowserRow } from "../src/memory-browser.ts";
const theme = { fg: (_: string, s: string) => s, bold: (s: string) => s } as any;
const row: BrowserRow = { id: "1", title: "Corrected activity card approach 中文", project: "workspace", blockId: "b21", date: "2026/9/29", vector: "向量就绪" };
const summary = "TASK AS OF THIS BLOCK: synthetic sample\n\n中文正文保持换行\n" + "long_identifier_".repeat(200) + "\n完整尾部_END";
test("list omits body; Enter loads full paragraphs; End reaches tail; Escape returns then exits", () => {
  let loaded = 0, closed = 0;
  const browser = new MemoryBrowser([row], () => { loaded++; return {...row, summary}; }, theme, () => 18, () => {}, () => {closed++;}, () => true);
  assert.ok(!browser.render(60).join("\n").includes("TASK AS")); assert.equal(loaded,0);
  browser.handleInput("\r"); assert.equal(loaded,1);
  assert.match(browser.render(60).join("\n"),/TASK AS/);
  browser.handleInput("\x1b[F"); assert.match(browser.render(60).join("\n"),/完整尾部_END/);
  browser.handleInput("\x1b"); assert.ok(!browser.render(60).join("\n").includes("TASK AS"));
  browser.handleInput("\x1b"); assert.equal(closed,1);
});
test("narrow widths, resize, empty/deleted records, and expired session", () => {
  let h=18, valid=true, closed=0;
  const browser=new MemoryBrowser([row],()=>({...row, summary}),theme,()=>h,()=>{},()=>{closed++;},()=>valid);
  for(const w of [1,8,20,40,80]) {
    for(const height of [3,8,18]) {h=height; for(const l of browser.render(w)) assert.ok(visibleWidth(l)<=w); assert.ok(browser.render(w).length<=h);}
  }
  h=18; browser.handleInput("\r"); for(const w of [1,8,20,40]) for(const l of browser.render(w)) assert.ok(visibleWidth(l)<=w);
  valid=false; browser.handleInput("\x1b[B"); assert.equal(closed,1);
  const empty=new MemoryBrowser([],()=>undefined,theme,()=>18,()=>{},()=>{},()=>true);
  assert.match(empty.render(60).join("\n"),/暂无记录/);
  const deleted=new MemoryBrowser([row],()=>undefined,theme,()=>18,()=>{},()=>{},()=>true);
  deleted.handleInput("\r"); assert.match(deleted.render(60).join("\n"),/已删除/);
});
test("loader errors stay in overlay; refreshed detail updates status; small height is explicit", () => {
  const broken=new MemoryBrowser([row],()=>{throw Error('SQLITE_BUSY private detail');},theme,()=>18,()=>{},()=>{},()=>true);
  assert.doesNotThrow(()=>broken.handleInput('\r'));
  assert.match(broken.render(60).join('\n'),/读取失败/);
  assert.ok(!broken.render(60).join('').includes('SQLITE_BUSY'));
  const view=new MemoryBrowser([{...row,project:'long_project_'.repeat(10),vector:'待嵌入'}],()=>({...row,summary}),theme,()=>18,()=>{},()=>{},()=>true);
  assert.match(view.render(60).join('\n'),/Corrected activity/);
  view.handleInput('\r'); view.handleInput('\x1b'); assert.match(view.render(80).join('\n'),/向量就绪/);
  const tiny=new MemoryBrowser([row],()=>({...row,summary}),theme,()=>4,()=>{},()=>{},()=>true);
  tiny.handleInput('\r'); assert.match(tiny.render(40).join('\n'),/终端太矮/);
});
test("body removes terminal escapes without flattening paragraphs; non-TUI never opens custom", async () => {
  assert.equal(cleanBody("a\n\n\x1b[31mb\x1b[0m\x1b]52;c;bad\x07\n尾"),"a\n\nb\n尾");
  let notified="";
  await showMemoryBrowser({mode:"rpc",hasUI:true,ui:{notify:(s:string)=>{notified=s;},custom:()=>{throw Error('unexpected');}}} as any,[row],()=>undefined,()=>true,()=>{});
  assert.match(notified,/终端/); assert.ok(!notified.includes("TASK AS"));
});
