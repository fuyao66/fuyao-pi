export interface MemoryRecord {
  identity?: string; blockId: string; project?: string; topic?: string; summary?: string; truncated?: boolean;
}
export type MemoryActivity = MemoryRecord & {
  type: "summary" | "vector" | "state" | "error"; at: number; message?: string;
  model?: string; dimensions?: number;
};
/** Plain, bounded display text: never render provider bodies or terminal controls. */
export function preview(value: unknown, limit = 120): string {
  return String(value ?? "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}
export function displayRecord(event: MemoryRecord, sanitize: (text: string) => string): MemoryRecord {
  return { identity: /^[a-f0-9]{64}$/.test(event.identity ?? "") ? event.identity : undefined, blockId: preview(sanitize(event.blockId), 60), project: preview(sanitize(event.project ?? ""), 60),
    topic: preview(sanitize(event.topic ?? ""), 100), summary: preview(sanitize(event.summary ?? ""), 200),
    truncated: event.truncated };
}
export class ActivityFeed {
  private events: MemoryActivity[] = [];
  private listeners = new Set<() => void>();
  constructor(private readonly capacity = 80, private sanitize: (text: string) => string = text => text) {}
  add(event: Omit<MemoryActivity, "at">): void {
    const item: MemoryActivity = { ...event, ...displayRecord(event, this.sanitize), at: Date.now(),
      message: preview(this.sanitize(event.message ?? "")), model: preview(this.sanitize(event.model ?? ""), 100) };
    this.events.push(item); this.events = this.events.slice(-this.capacity);
    for (const listener of this.listeners) { try { listener(); } catch { /* Observers never fail storage. */ } }
  }
  recent(limit = 8): MemoryActivity[] { return this.events.slice(-limit).reverse().map(x => ({ ...x })); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  clear(): void { this.events = []; }
}
export function activityLine(event: MemoryActivity): string {
  const time = new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false });
  const label = { summary: "摘要入库", vector: "向量保存", state: "后台状态", error: "处理异常" }[event.type];
  return `${time} ${label} · ${event.message || [event.project, event.topic || event.blockId].filter(Boolean).join(" / ")}${event.truncated ? " [前缀截断]" : ""}`;
}
