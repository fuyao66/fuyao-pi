import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureForTests, sanitizeSource, loadSources, loadSqlite, MemoryDb } from '../src/extension.js';
import { memoryPaths, proxySessionsDir } from '../src/paths.js';

test('runtime only accepts proxy sessions and registered history, not legacy adapters', async () => {
 const root=await mkdtemp(join(tmpdir(),'bili-runtime-boundary-'));
 let db: MemoryDb | undefined;
 try {
  configureForTests({legacyOffline:false,dbPath:join(root,'db'),sourcesPath:join(root,'missing-sources'),logPath:join(root,'log')});
  const rule={id:'fixture',root,pattern:'*.json'};
  for(const adapter of ['pi-sidecar','opencode-acp']) assert.equal(sanitizeSource({...rule,adapter}),null);
  for(const adapter of ['bili-session','memory-history']) assert.ok(sanitizeSource({...rule,adapter}));
  assert.deepEqual((await loadSources()).map(s=>s.adapter),['bili-session','memory-history']);
  await loadSqlite(); db=new MemoryDb(join(root,'db'));db.open();
  const file=join(root,'legacy.json');await writeFile(file,JSON.stringify({blocks:[{blockId:'b1',summary:'must not ingest'}]}));
  const result=await db.ingestSourceFile(file,{kind:'pi'},true);
  assert.equal(result.ok,false);assert.match(result.error!,/offline migration/);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM blocks').get().n,0);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM source_watermarks').get().n,0);
 } finally {db?.close();await rm(root,{recursive:true,force:true});}
});

test('new Memory paths are independent and proxy paths follow documented precedence',()=>{
 const paths=memoryPaths('/fixture');
 assert.equal(paths.config,'/fixture/.pi/bili-memory/config.json');
 assert.equal(paths.embeddings,'/fixture/.pi/bili-memory/embedding.json');
 assert.equal(proxySessionsDir({},'/fixture'),'/fixture/.local/share/billion-context/sessions');
 assert.equal(proxySessionsDir({XDG_DATA_HOME:'/data'},'/fixture'),'/data/billion-context/sessions');
 assert.equal(proxySessionsDir({BILI_SESSIONS_DIR:'/custom',XDG_DATA_HOME:'/data'},'/fixture'),'/custom');
 assert.notEqual(paths.history,proxySessionsDir({},'/fixture'));
});
