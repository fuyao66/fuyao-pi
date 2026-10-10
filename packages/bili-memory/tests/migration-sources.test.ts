import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureLegacySources } from '../src/migration-sources.js';

test('legacy default source policy is captured explicitly; missing overrides never widen it', async () => {
 const home=await mkdtemp(join(tmpdir(),'bili-source-migration-'));
 try {
  const rules=(await captureLegacySources({},home)).trim().split('\n').map(s=>JSON.parse(s));
  assert.equal(rules.length,2);assert.equal(rules[0].root,join(home,'.pi/agent/sessions'));
  await assert.rejects(captureLegacySources({sourcesPath:'~/missing.jsonl'},home));
  await assert.rejects(captureLegacySources({sourcesPath:4},home));
  await mkdir(join(home,'.pi'));
  const original='{"id":"private","enabled":false}\n';
  await writeFile(join(home,'.pi/pi-billion-memory.sources.jsonl'),original);
  assert.equal(await captureLegacySources({},home),original);
  await writeFile(join(home,'explicit.jsonl'),'');
  assert.equal(await captureLegacySources({sourcesPath:'~/explicit.jsonl'},home),'');
 } finally {await rm(home,{recursive:true,force:true});}
});
