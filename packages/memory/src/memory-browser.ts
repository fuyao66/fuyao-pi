import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, ScrollView, SelectList, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { preview } from "./activity.js";

export interface BrowserRow {
  id: string; title: string; project: string; blockId: string; date: string; vector: string;
}
export interface BrowserDetail extends BrowserRow { summary: string }
/** Preserve paragraphs, unlike the one-line activity preview. Never execute terminal controls. */
export function cleanBody(text: string): string {
  return String(text ?? "").replace(/\r\n/g, "\n")
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\t/g, "    ");
}
/** Bounded list, lazy full-detail lookup. Rendering never reads the database. */
export class MemoryBrowser {
  private list: SelectList;
  private listHeight = 0;
  private selected = 0;
  private detail?: BrowserDetail;
  private deleted = false;
  private scroll: ScrollView;
  private text = new Text("", 0, 0);
  constructor(private rows: BrowserRow[], private load: (id: string) => BrowserDetail | undefined,
    private theme: Pick<Theme, "fg" | "bold">, private height: () => number,
    private redraw: () => void, private done: () => void,
    private current: () => boolean, private title = "已存记忆") {
    this.scroll = new ScrollView(this.text, { scrollbar: "hidden" });
    this.rebuild(5);
  }
  private rebuild(height: number): void {
    this.listHeight = height;
    this.list = new SelectList(this.rows.map((row, index) => ({ value: row.id,
      label: `${index + 1}. ${preview(row.title || row.blockId, 160)}` })), height,
      { selectedPrefix: t => this.theme.fg("accent", t), selectedText: t => this.theme.fg("accent", t),
        description: t => this.theme.fg("muted", t), scrollInfo: t => this.theme.fg("dim", t), noMatch: t => this.theme.fg("dim", t) });
    this.list.setSelectedIndex(this.selected);
    this.list.onSelectionChange = item => { this.selected = this.rows.findIndex(row => row.id === item.value); };
    this.list.onSelect = item => {
      if (!this.current()) { this.done(); return; }
      try {
        this.detail = this.load(item.value);
        this.deleted = !this.detail;
        if (this.detail) this.rows[this.selected] = { ...this.detail };
        this.text.setText(cleanBody(this.detail?.summary ?? "这条记忆已删除或不再可用。"));
      } catch {
        this.detail = undefined; this.deleted = true;
        this.text.setText("读取失败。按 Esc 返回后重试。");
      }
      this.scroll.scrollToStart();
    };
    this.list.onCancel = this.done;
  }
  render(width: number): string[] {
    const h = Math.max(1, Math.floor(this.height()));
    const clip = (line: string) => truncateToWidth(line, Math.max(1, width));
    const header = this.theme.fg("accent", this.theme.bold(`Memory / ${this.title}`));
    if (h < 7) return ["终端太矮，请增高窗口", "Esc 返回 / 关闭"].slice(0, h).map(clip);
    if (!this.detail && !this.deleted) {
      const available = Math.max(1, h - 7);
      if (available !== this.listHeight) this.rebuild(available);
      const row = this.rows[this.selected];
      const lines = [header, this.theme.fg("dim", `最近 ${this.rows.length} 条 · 仅显示标题，Enter 查看正文`), "",
        ...(this.rows.length ? this.list.render(Math.max(1, width)) : ["暂无记录"]), "",
        row ? this.theme.fg("muted", `${preview(row.project, 30)} · ${preview(row.blockId, 40)} · ${preview(row.date, 25)} · ${preview(row.vector, 50)}`) : "",
        this.theme.fg("dim", width < 40 ? "↑↓选 Enter看 Esc关" : "↑↓ 选择  Enter 详情  Esc 关闭")];
      return lines.slice(0, h).map(clip);
    }
    const d = this.detail;
    const bodyHeight = Math.max(1, h - 6);
    const body = this.scroll.render(Math.max(1, width));
    this.scroll.updateLayout(body.length, bodyHeight, this.redraw);
    const top = this.scroll.scrollTop;
    return [header, this.theme.fg("accent", preview(d?.title || d?.blockId || "记录已删除", 200)),
      this.theme.fg("muted", d ? `${preview(d.project)} · ${preview(d.blockId, 40)} · ${preview(d.date, 25)} · ${preview(d.vector, 40)}` : ""), "",
      ...body.slice(top, top + bodyHeight),
      this.theme.fg("dim", `正文 ${Math.min(top + 1, body.length)}–${Math.min(top + bodyHeight, body.length)}/${body.length} 行`),
      this.theme.fg("dim", width < 40 ? "↑↓滚 PgUp/Dn页 Esc返" : "↑↓ 滚动  PgUp/PgDn 翻页  Esc 返回")].slice(0, h).map(clip);
  }
  handleInput(data: string): void {
    if (!this.current()) { this.done(); return; }
    if (!this.detail && !this.deleted) this.list.handleInput(data);
    else if (matchesKey(data, Key.escape)) { this.detail = undefined; this.deleted = false; }
    else if (matchesKey(data, Key.up)) this.scroll.scrollBy(-1);
    else if (matchesKey(data, Key.down)) this.scroll.scrollBy(1);
    else if (matchesKey(data, Key.pageUp)) this.scroll.scrollBy(-Math.max(1, this.scroll.viewportHeight));
    else if (matchesKey(data, Key.pageDown)) this.scroll.scrollBy(Math.max(1, this.scroll.viewportHeight));
    else if (matchesKey(data, Key.home)) this.scroll.scrollToStart();
    else if (matchesKey(data, Key.end)) this.scroll.scrollToEnd();
    this.redraw();
  }
  invalidate(): void { this.text.invalidate(); this.list.invalidate(); }
}
export async function showMemoryBrowser(ctx: ExtensionContext, rows: BrowserRow[], load: (id: string) => BrowserDetail | undefined,
  current: () => boolean, ownClose: (close?: () => void) => void, title?: string): Promise<void> {
  if (ctx.mode !== "tui" || !ctx.hasUI) { ctx.ui?.notify?.(`Memory：${rows.length} 条近期记录；请在终端中打开 /memory 浏览详情。`, "info"); return; }
  try {
    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      ownClose(() => done());
      return new MemoryBrowser(rows, load, theme, () => Math.max(1, Math.min(28, tui.terminal.rows - 4)),
        () => tui.requestRender(), () => done(), current, title);
    }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "90%" } });
  } finally { ownClose(undefined); }
}
