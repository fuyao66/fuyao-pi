export interface BackfillBatch { uploaded: number; stored: number; skipped: number; status: { pending: number } }
export interface AutoEmbedClock {
  now(): number;
  schedule(callback: () => void, delay: number): unknown;
  cancel(handle: unknown): void;
}
const clock: AutoEmbedClock = {
  now: Date.now,
  schedule(callback, delay) { const timer = setTimeout(callback, delay); timer.unref(); return timer; },
  cancel(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
};
/** One background batch per tick. Triggers coalesce and never defeat failure backoff. */
export class AutoEmbed {
  private timer: unknown;
  private running = false;
  private stopped = false;
  private requested = false;
  private failures = 0;
  private nextAt = 0;
  constructor(private batch: () => Promise<BackfillBatch>, private current: () => boolean,
    private report: (message: string) => void = () => {}, private time: AutoEmbedClock = clock) {}
  status() {
    return { state: this.stopped ? "stopped" : this.running ? "running" : this.timer !== undefined
      ? this.failures ? "backoff" : "scheduled" : "idle", failures: this.failures,
      retryInMs: Math.max(0, this.nextAt - this.time.now()) };
  }
  trigger(): void {
    if (this.stopped || !this.current()) return;
    this.requested = true;
    if (!this.running && this.timer === undefined) this.arm();
  }
  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) this.time.cancel(this.timer);
    this.timer = undefined;
  }
  private arm(): void {
    this.timer = this.time.schedule(() => { this.timer = undefined; void this.tick(); },
      Math.max(1000, this.nextAt - this.time.now()));
  }
  private async tick(): Promise<void> {
    if (this.stopped || !this.current()) return;
    this.running = true;
    this.requested = false;
    try {
      const result = await this.batch();
      if (this.stopped || !this.current()) return;
      this.failures = 0; this.nextAt = 0;
      if (result.stored > 0) this.report(`auto embedding: stored=${result.stored}, pending=${result.status.pending}`);
      // Honor a fresh ingestion signal even after a pruned/no-progress batch.
      // Pending alone never repeats a no-progress pass.
      this.requested = this.requested || (result.stored > 0 && result.status.pending > 0);
    } catch {
      if (this.stopped || !this.current()) return;
      this.failures++;
      this.nextAt = this.time.now() + Math.min(300000, 30000 * 2 ** Math.min(this.failures - 1, 4));
      this.requested = true;
      this.report("auto embedding paused; retrying with bounded backoff");
    } finally {
      this.running = false;
      if (this.requested && !this.stopped && this.current()) this.arm();
    }
  }
}
