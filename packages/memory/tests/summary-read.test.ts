import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import factory, { configureForTests, loadSqlite } from '../src/extension.ts';
import { summaryPage } from '../src/summary-read.ts';

test('summary pages are bounded, Unicode-safe and revision-bound', () => {
  const text = 'A😀BCDE';
  const first = summaryPage(text, { offset: 0, chars: 2 });
  assert.equal(first.text, 'A'); assert.equal(first.nextOffset, 1);
  const second = summaryPage(text, { offset: 1, chars: 3, revision: first.revision });
  assert.equal(second.text, '😀B'); assert.equal(second.nextOffset, 4);
  assert.throws(() => summaryPage(text, { offset: 1, chars: 3 }), /requires the revision/);
  assert.throws(() => summaryPage(text + 'changed', { offset: 4, chars: 3, revision: first.revision }), /changed/);
  assert.throws(() => summaryPage(text, { offset: 2, chars: 3, revision: first.revision }), /splits/);
  assert.throws(() => summaryPage(text, { offset: 1, chars: 1, revision: first.revision }), /too small/);
  assert.equal(summaryPage('', { offset: 0, chars: 10 }).nextOffset, null);
});

test('summary mode reads stored evidence without raw logs, retains authorization and raw modes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memory-summary-'));
  const file = join(dir, 'session'), sidecar = file + '.acp.json', sources = join(dir, 'sources');
  const source = { id: 'test', adapter: 'pi-sidecar', root: dir, pattern: '*.acp.json' };
  const save = (summary: string) => writeFileSync(sidecar, JSON.stringify({ schemaVersion: 1,
    blocks: [{ blockId: 'b1', summary }] }));
  writeFileSync(sources, JSON.stringify(source)); save('A😀BCDE final conclusion');
  configureForTests({ dbPath: join(dir, 'db'), sourcesPath: sources, logPath: join(dir, 'log'),
    scanOnStartup: false, expandEnabled: true, expandMaxChars: 8 });
  await loadSqlite();
  const handlers = new Map<string, any>(), tools = new Map<string, any>();
  let generation = 0, scopeReads = 0, switchOnRead = 0;
  const pi: any = { events: { emit: (_n: string, m: any) => {
    if (++scopeReads === switchOnRead) generation++;
    m.accept({ mode: 'local', generation });
  } }, on: (n: string, f: any) => handlers.set(n, f), registerTool: (t: any) => tools.set(t.name, t),
    registerCommand: () => {}, registerEntryRenderer: () => {} };
  const ctx: any = { cwd: dir, sessionManager: { getSessionFile: () => file, getEntries: () => [] } };
  await factory(pi);
  try {
    await handlers.get('session_start')({}, ctx);
    const expand = (p: any, signal?: AbortSignal) => tools.get('memory_expand').execute('e', p, signal, undefined, ctx);
    const first = await expand({ block: 'b1', scope: 'all', mode: 'summary', chars: 2 });
    assert.equal(first.details.mode, 'summary'); assert.equal(first.details.returnedChars, 1);
    assert.ok(first.content[0].text.endsWith('\nA')); assert.equal(existsSync(file), false);
    const second = await expand({ block: 'b1', scope: 'all', mode: 'summary', offset: first.details.nextOffset,
      revision: first.details.revision, chars: 1000 });
    assert.equal(second.details.mode, 'summary'); assert.ok(second.details.returnedChars <= 8);
    assert.ok(second.content[0].text.includes('😀'));
    const continuation = await expand({ block: 'b1', scope: 'all', mode: 'summary', offset: 1 });
    assert.equal(continuation.details.mode, 'error');
    assert.equal((await expand({ block: 'b1', mode: 'summary' })).details.hits, 0, 'unknown workspace evidence is not current');
    assert.equal((await expand({ block: 'b1', scope: 'all', mode: 'list' })).details.mode, 'no-refs');
    assert.equal((await expand({ block: 'b1', scope: 'all', mode: 'full', select: [1] })).details.mode, 'no-refs');
    save('updated and much longer evidence');
    const changed = await expand({ block: 'b1', scope: 'all', mode: 'summary', offset: 1, revision: first.details.revision });
    assert.equal(changed.details.mode, 'error'); assert.match(changed.content[0].text, /changed/);
    const controller = new AbortController(); controller.abort();
    assert.equal((await expand({ block: 'b1', scope: 'all', mode: 'summary' }, controller.signal)).details.mode, 'error');
    scopeReads = 0; switchOnRead = 3;
    assert.equal((await expand({ block: 'b1', scope: 'all', mode: 'summary' })).details.mode, 'error');
    switchOnRead = 0;
    writeFileSync(sources, JSON.stringify({ ...source, enabled: false }));
    assert.equal((await expand({ block: 'b1', scope: 'all', mode: 'summary' })).details.hits, 0);
  } finally { await handlers.get('session_shutdown')({}, ctx); rmSync(dir, { recursive: true, force: true }); }
});
