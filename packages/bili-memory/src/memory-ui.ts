import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { displayRecord, preview, type MemoryRecord } from "./activity.js";

export const MEMORY_CARD = "fuyao-memory-activity";
export interface ActivityCard {
  summaries: number; vectors: number; records: (MemoryRecord & { type: "summary" | "vector" })[];
  model?: string; dimensions?: number; state?: "backoff" | "resumed"; at: number;
  outcome?: "completed" | "retry" | "failed";
}
export function cardLines(card: ActivityCard, _expanded = false): string[] {
  const parts = ["Memory"];
  if (card.summaries) parts.push(`Indexed ${card.summaries} summaries`);
  if (card.vectors) parts.push(`Saved ${card.vectors} vectors`);
  if (card.outcome === "retry" || card.state === "backoff") parts.push("Embedding pending; retrying");
  else if (card.outcome === "failed") parts.push("Embedding failed; please retry");
  else if (card.state === "resumed" && !card.summaries && !card.vectors) parts.push("Embedding resumed");
  return [parts.join(" · ")];
}
export function registerMemoryCards(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<ActivityCard>(MEMORY_CARD, (entry, { expanded }, theme) => {
    if (!entry.data) return undefined;
    const line = cardLines(entry.data, expanded)[0];
    return { render: (width: number) => [truncateToWidth(theme.fg("dim", line), Math.max(1, width))], invalidate() {} };
  });
}
/** Coalesced display-only entries: no model messages, no continuation, no widgets. */
export class ActivityCards {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private card: ActivityCard = this.empty();
  private lastBackoff = false;
  private batch?: ActivityCard;
  constructor(private emit: (card: ActivityCard) => void, private current: () => boolean,
    private sanitize: (text: string) => string = text => text, private delay = 750,
    private automatic = false) {}
  beginBatch(): boolean {
    if (this.stopped || !this.current() || this.batch) return false;
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    this.batch = this.card; this.card = this.empty();
    return true;
  }
  endBatch(failed = false): void {
    const batch = this.batch; this.batch = undefined;
    if (!batch) return;
    batch.outcome = failed ? this.automatic ? "retry" : "failed" : "completed";
    if (failed && this.automatic && !this.lastBackoff) { batch.state = "backoff"; this.lastBackoff = true; }
    else if (!failed && this.lastBackoff) { batch.state = "resumed"; this.lastBackoff = false; }
    this.deliver(batch);
    if (!this.automatic && (this.card.summaries || this.card.vectors)) this.arm();
    // New summaries collected during HTTP belong to the next batch, not this one.
  }
  private deliver(card: ActivityCard): void {
    if (!this.stopped && this.current() && (card.summaries || card.vectors || card.state || card.outcome === "failed")) {
      try { this.emit(card); } catch { /* Rendering must never break indexing. */ }
    }
  }
  private empty(): ActivityCard { return { summaries: 0, vectors: 0, records: [], at: Date.now() }; }
  saved(type: "summary" | "vector", records: MemoryRecord[], count = records.length, model?: string, dimensions?: number): void {
    if (this.stopped || !this.current() || !count) return;
    const target = type === "vector" && this.batch ? this.batch : this.card;
    if (type === "summary") target.summaries += count; else target.vectors += count;
    if (model) { target.model = preview(this.sanitize(model)); target.dimensions = dimensions; }
    for (const row of records) target.records.push({ ...displayRecord(row, this.sanitize), type });
    target.records = target.records.slice(-12);
    if ((!this.automatic || this.lastBackoff) && !this.batch) {
      if (this.lastBackoff) this.card.outcome = "retry";
      this.arm();
    }
  }
  state(state: string): void {
    if (this.stopped || !this.current()) return;
    if (this.automatic) {
      // Batch completion owns normal feedback. During backoff don't retain new
      // summary notices for minutes; they are stored but their vectors must wait.
      if (state === "idle" && !this.batch) this.flush();
      if (state === "backoff") {
        this.card.outcome = "retry";
        if (!this.lastBackoff) { this.card.state = "backoff"; this.lastBackoff = true; }
        this.flush();
      }
      return;
    }
    if (state === "backoff" && !this.lastBackoff) { this.card.state = "backoff"; this.lastBackoff = true; this.arm(); }
    else if ((state === "idle" || state === "scheduled") && this.lastBackoff) { this.card.state = "resumed"; this.lastBackoff = false; this.arm(); }
  }
  private arm(): void {
    if (!this.timer) { this.timer = setTimeout(() => this.flush(), this.delay); this.timer.unref(); }
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    const card = this.card; this.card = this.empty();
    this.deliver(card);
  }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.card = this.empty(); this.batch = undefined; }
}

/** One discoverable entry point; dialogs stay out of model context. */
export async function memoryMenu(ctx: ExtensionContext, status: string, current: () => boolean): Promise<string | undefined> {
  if (!ctx.hasUI || ctx.mode !== "tui") { ctx.ui?.notify?.(status, "info"); return undefined; }
  const labels = ["Browse memories", "Session activity", "Vector status", "Rescan sources", "Backfill vectors", "View sources", "Prune old memories"];
  const selected = await ctx.ui.select(`Memory · Manage\n${status}`, labels);
  if (!current()) return undefined;
  return ["browse", "activity", "embed status", "rescan", "embed backfill", "sources", "prune"][labels.indexOf(selected ?? "")];
}
