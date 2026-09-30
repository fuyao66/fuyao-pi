import { test } from "node:test";
import assert from "node:assert/strict";
import { AutoEmbed, type AutoEmbedClock, type BackfillBatch } from "../src/auto-embed.ts";
function fixture(batch: () => Promise<BackfillBatch>, current = () => true) {
  let now = 0; let id = 0;
  const jobs = new Map<number, { callback: () => void; at: number }>();
  const clock: AutoEmbedClock = { now: () => now, schedule(callback, delay) { jobs.set(++id, { callback, at: now + delay }); return id; }, cancel(handle) { jobs.delete(handle as number); } };
  const auto = new AutoEmbed(batch, current, () => {}, clock);
  const advance = async (ms: number) => {
    now += ms;
    for (const [key, job] of [...jobs]) if (job.at <= now) { jobs.delete(key); job.callback(); }
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { auto, advance, jobs };
}
const result = (stored: number, pending = 0) => ({ uploaded: stored, stored, skipped: 0, status: { pending } });
test("triggers are nonblocking/coalesced, drain incrementally and restart for new summaries", async () => {
  let calls = 0;
  const f = fixture(async () => result(++calls <= 2 ? 20 : 0, calls === 1 ? 10 : 0));
  f.auto.trigger(); f.auto.trigger(); assert.equal(calls, 0); assert.equal(f.jobs.size, 1);
  await f.advance(1000); assert.equal(calls, 1);
  await f.advance(1000); assert.equal(calls, 2); assert.equal(f.auto.status().state, "idle");
  f.auto.trigger(); await f.advance(1000); assert.equal(calls, 3); assert.equal(f.jobs.size, 0);
});
test("failure retries are backed off and triggers cannot bypass delay", async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; throw new Error("provider unavailable"); });
  f.auto.trigger(); await f.advance(1000); assert.equal(f.auto.status().state, "backoff");
  f.auto.trigger(); await f.advance(29999); assert.equal(calls, 1);
  await f.advance(1); assert.equal(calls, 2); assert.equal(f.auto.status().retryInMs, 60000);
  f.auto.stop(); await f.advance(999999); assert.equal(calls, 2);
});
test("inflight triggers merge, no progress stops, stop/old generation prevent continuation", async () => {
  let release!: (x: BackfillBatch) => void; let valid = true; let calls = 0;
  const f = fixture(() => { calls++; return new Promise(r => { release = r; }); }, () => valid);
  f.auto.trigger(); await f.advance(1000); f.auto.trigger(); f.auto.trigger();
  assert.equal(calls, 1); release(result(0, 10)); await f.advance(0); assert.equal(f.jobs.size, 1);
  await f.advance(1000); release(result(0, 10)); await f.advance(0); assert.equal(f.jobs.size, 0);
  f.auto.trigger(); await f.advance(1000); valid = false; release(result(20, 100));
  await f.advance(0); assert.equal(f.jobs.size, 0); f.auto.trigger(); assert.equal(f.jobs.size, 0);
  const stopped = fixture(async () => result(20, 100)); stopped.auto.trigger(); stopped.auto.stop();
  await stopped.advance(2000); assert.equal(stopped.jobs.size, 0);
});
