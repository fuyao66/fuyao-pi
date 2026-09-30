import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { displayRecord, preview, type MemoryRecord } from "./activity.js";

export const MEMORY_CARD = "fuyao-memory-activity";
export interface ActivityCard {
  summaries: number; vectors: number; records: (MemoryRecord & { type: "summary" | "vector" })[];
  model?: string; dimensions?: number; state?: "backoff" | "resumed"; at: number;
  outcome?: "completed" | "retry" | "failed";
}
export function cardLines(card: ActivityCard, expanded: boolean): string[] {
  const lines = [card.outcome === "completed" ? "Memory · Batch complete" : "Memory · Background activity"];
  if (card.summaries || card.vectors) lines.push(`Summaries indexed: ${card.summaries} · Vectors saved: ${card.vectors}`);
  if (card.vectors) lines.push(`${preview(card.model)} · ${card.dimensions} dimensions`);
  if (card.outcome === "retry") lines.push("Saved data is retained; remaining vectors will retry in the background.");
  if (card.outcome === "failed") lines.push("Vector backfill failed. Saved data is retained; please retry.");
  if (card.state) lines.push(card.state === "backoff" ? "Embedding unavailable; retrying with backoff. Keyword search remains available." : "Backoff ended; background indexing is resuming or complete.");
  // Same source/block appears once, even when both indexing and embedding committed.
  const combined = new Map<string, typeof card.records[number]>();
  card.records.forEach((row, i) => {
    const key = row.identity ?? `unidentified-${i}`;
    const previous = combined.get(key);
    combined.set(key, { ...row, type: previous?.type === "vector" ? "vector" : row.type });
  });
  const allRecords = [...combined.values()];
  const records = expanded ? allRecords : allRecords.slice(0, 3);
  for (const row of records) {
    lines.push(`· ${row.type === "vector" ? "Vector" : "Summary"} ${preview(row.project, 40)} / ${preview(row.topic || row.blockId, 80)}${row.truncated ? " [prefix only]" : ""}`);
    if (expanded) lines.push(`  ${preview(row.blockId, 40)} · ${preview(row.summary, 200)}`);
  }
  if (!expanded && allRecords.length > records.length) lines.push(`${allRecords.length - records.length} more entries; expand to view`);
  if (expanded) lines.push(`Batch · ${new Date(card.at).toLocaleString("en-GB")}`);
  return lines;
}
export function registerMemoryCards(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<ActivityCard>(MEMORY_CARD, (entry, { expanded }, theme) => {
    if (!entry.data) return undefined;
    const box = new Box(1, 1, text => theme.bg("customMessageBg", text));
    const lines = cardLines(entry.data, expanded);
    box.addChild(new Text(theme.fg("accent", theme.bold(lines[0])), 0, 0));
    box.addChild(new Text(lines.slice(1).map(line => theme.fg("dim", line)).join("\n"), 0, 0));
    return box;
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
  const labels = ["Browse memories", "Session activity", "Rescan sources", "Backfill vectors", "View sources", "Prune old memories"];
  const selected = await ctx.ui.select(`Memory · Manage\n${status}`, labels);
  if (!current()) return undefined;
  return ["browse", "activity", "rescan", "embed backfill", "sources", "prune"][labels.indexOf(selected ?? "")];
}
