import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { displayRecord, preview, type MemoryRecord } from "./activity.js";

export const MEMORY_CARD = "fuyao-memory-activity";
export interface ActivityCard {
  summaries: number; vectors: number; records: (MemoryRecord & { type: "summary" | "vector" })[];
  model?: string; dimensions?: number; state?: "backoff" | "resumed"; at: number;
}
export function cardLines(card: ActivityCard, expanded: boolean): string[] {
  const lines = ["Memory · 自动记忆"];
  if (card.summaries) lines.push(`已索引 ${card.summaries} 条压缩摘要`);
  if (card.vectors) lines.push(`已保存 ${card.vectors} 条向量 · ${preview(card.model)} · ${card.dimensions} 维`);
  if (card.state) lines.push(card.state === "backoff" ? "Embedding 暂时失败，后台退避重试；关键词检索仍可用。" : "后台补建已退出退避；本轮处理结束或继续增量补建。");
  const records = expanded ? card.records : card.records.slice(0, 3);
  for (const row of records) {
    lines.push(`· ${row.type === "vector" ? "向量" : "摘要"} ${preview(row.project, 40)} / ${preview(row.topic || row.blockId, 80)}${row.truncated ? " [前缀截断]" : ""}`);
    if (expanded) lines.push(`  ${preview(row.blockId, 40)} · ${preview(row.summary, 200)}`);
  }
  if (!expanded && card.records.length > records.length) lines.push(`另有 ${card.records.length - records.length} 条详情，可展开查看`);
  if (expanded) lines.push(`本次处理 · ${new Date(card.at).toLocaleString("zh-CN")}`);
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
  constructor(private emit: (card: ActivityCard) => void, private current: () => boolean,
    private sanitize: (text: string) => string = text => text, private delay = 750) {}
  private empty(): ActivityCard { return { summaries: 0, vectors: 0, records: [], at: Date.now() }; }
  saved(type: "summary" | "vector", records: MemoryRecord[], count = records.length, model?: string, dimensions?: number): void {
    if (this.stopped || !this.current() || !count) return;
    if (type === "summary") this.card.summaries += count; else this.card.vectors += count;
    if (model) { this.card.model = preview(this.sanitize(model)); this.card.dimensions = dimensions; }
    for (const row of records) this.card.records.push({ ...displayRecord(row, this.sanitize), type });
    this.card.records = this.card.records.slice(-12);
    this.arm();
  }
  state(state: string): void {
    if (this.stopped || !this.current()) return;
    if (state === "backoff" && !this.lastBackoff) { this.card.state = "backoff"; this.lastBackoff = true; this.arm(); }
    else if ((state === "idle" || state === "scheduled") && this.lastBackoff) { this.card.state = "resumed"; this.lastBackoff = false; this.arm(); }
  }
  private arm(): void {
    if (!this.timer) { this.timer = setTimeout(() => this.flush(), this.delay); this.timer.unref(); }
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    const card = this.card; this.card = this.empty();
    if (!this.stopped && this.current() && (card.summaries || card.vectors || card.state)) {
      try { this.emit(card); } catch { /* Rendering must never break indexing. */ }
    }
  }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.card = this.empty(); }
}

/** One discoverable entry point; dialogs stay out of model context. */
export async function memoryMenu(ctx: ExtensionContext, status: string, current: () => boolean): Promise<string | undefined> {
  if (!ctx.hasUI || ctx.mode !== "tui") { ctx.ui?.notify?.(status, "info"); return undefined; }
  const labels = ["浏览已存记忆", "本次活动", "刷新扫描", "补齐向量", "查看来源", "清理旧记忆"];
  const selected = await ctx.ui.select(`Memory · 记忆管理\n${status}`, labels);
  if (!current()) return undefined;
  return ["browse", "activity", "rescan", "embed backfill", "sources", "prune"][labels.indexOf(selected ?? "")];
}
