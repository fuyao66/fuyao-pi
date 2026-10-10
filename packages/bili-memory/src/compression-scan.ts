/** Coalesce compress completions without blocking tools. BC persistence may be
 * delayed; bounded follow-up passes cover unavailable native session files. */
export class CompressionScan {
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private stopped = false;
  private remaining = 0;
  constructor(private scan: () => Promise<void>, private current: () => boolean,
    private report: () => void = () => {}, private delay = 250) {}
  trigger(): void {
    if (this.stopped || !this.current()) return;
    this.remaining = 3;
    if (!this.running && !this.timer) this.arm();
  }
  stop(): void {
    this.stopped = true; this.remaining = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private arm(): void {
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(); }, this.delay);
    this.timer.unref();
  }
  private async run(): Promise<void> {
    if (this.stopped || !this.current()) return;
    this.running = true; this.remaining--;
    try { await this.scan(); } catch { if (this.current() && !this.stopped) this.report(); }
    finally {
      this.running = false;
      if (!this.stopped && this.current() && this.remaining > 0) this.arm();
    }
  }
}
