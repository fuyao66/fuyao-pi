import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompressionScan } from '../src/compression-scan.ts';

test('compression scans coalesce, retain triggers during IO, retry finitely and cancel', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, release!: () => void, current = true;
  const scan = new CompressionScan(async () => { calls++; if (calls === 1) await new Promise<void>(r => release = r); }, () => current);
  const tick = async () => { t.mock.timers.tick(250); for (let i=0;i<8;i++) await Promise.resolve(); };
  scan.trigger(); scan.trigger(); assert.equal(calls,0);
  await tick(); assert.equal(calls,1);
  scan.trigger(); release(); for (let i=0;i<8;i++) await Promise.resolve();
  await tick(); await tick(); await tick(); assert.equal(calls,4);
  await tick(); assert.equal(calls,4);
  scan.trigger(); current=false; await tick(); assert.equal(calls,4);
  current=true; scan.trigger(); scan.stop(); await tick(); assert.equal(calls,4);
});

test('temporary scan failure gets bounded follow-up attempts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls=0, errors=0;
  const scan=new CompressionScan(async()=>{calls++;if(calls<3)throw Error('delayed sidecar');},()=>true,()=>errors++);
  scan.trigger();
  for(let i=0;i<8;i++){t.mock.timers.tick(250);for(let j=0;j<8;j++)await Promise.resolve();}
  assert.equal(calls,3);assert.equal(errors,2);scan.stop();
});
