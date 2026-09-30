import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, ScrollView, SelectList, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
    private current: () => boolean, private title = "Saved memories") {
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
        this.text.setText(cleanBody(this.detail?.summary ?? "This memory was deleted or is no longer available."));
      } catch {
        this.detail = undefined; this.deleted = true;
        this.text.setText("Unable to load this memory. Press Esc and try again.");
      }
      this.scroll.scrollToStart();
    };
    this.list.onCancel = this.done;
  }
  render(width: number): string[] {
    width = Math.max(1, Math.floor(width));
    const height = Math.max(1, Math.floor(this.height()));
    if (width < 8 || height < 3) return [truncateToWidth("Too small · Esc", width)];
    const innerWidth = width - 4;
    const border = (text: string) => this.theme.fg("border", text);
    const lines = this.renderContent(innerWidth, height - 2);
    return [border(`╭${"─".repeat(width - 2)}╮`), ...lines.map(line => {
      const clipped = truncateToWidth(line, innerWidth);
      return border("│") + " " + clipped + " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped))) + " " + border("│");
    }), border(`╰${"─".repeat(width - 2)}╯`)];
  }
  private renderContent(width: number, h: number): string[] {
    const clip = (line: string) => truncateToWidth(line, Math.max(1, width));
    const header = this.theme.fg("accent", this.theme.bold(`Memory / ${this.title}`));
    if (h < 7) return ["Increase terminal height", "Esc Back / Close"].slice(0, h).map(clip);
    if (!this.detail && !this.deleted) {
      const available = Math.max(1, h - 7);
      if (available !== this.listHeight) this.rebuild(available);
      const row = this.rows[this.selected];
      const lines = [header, this.theme.fg("dim", `Latest ${this.rows.length} · Enter to read`), "",
        ...(this.rows.length ? this.list.render(Math.max(1, width)) : ["No entries yet"]), "",
        row ? this.theme.fg("muted", `${preview(row.project, 30)} · ${preview(row.blockId, 40)} · ${preview(row.date, 25)} · ${preview(row.vector, 50)}`) : "",
        this.theme.fg("dim", width < 40 ? "↑↓ Enter:Read Esc:Close" : "↑↓ Select  Enter Details  Esc Close")];
      return lines.slice(0, h).map(clip);
    }
    const d = this.detail;
    const bodyHeight = Math.max(1, h - 6);
    const body = this.scroll.render(Math.max(1, width));
    this.scroll.updateLayout(body.length, bodyHeight, this.redraw);
    const top = this.scroll.scrollTop;
    return [header, this.theme.fg("accent", preview(d?.title || d?.blockId || "Deleted memory", 200)),
      this.theme.fg("muted", d ? `${preview(d.project)} · ${preview(d.blockId, 40)} · ${preview(d.date, 25)} · ${preview(d.vector, 40)}` : ""), "",
      ...body.slice(top, top + bodyHeight),
      this.theme.fg("dim", `Lines ${Math.min(top + 1, body.length)}–${Math.min(top + bodyHeight, body.length)}/${body.length}`),
      this.theme.fg("dim", width < 40 ? "↑↓ PgUp/Dn Esc:Back" : "↑↓ Scroll  PgUp/PgDn Page  Esc Back")].slice(0, h).map(clip);
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
  if (ctx.mode !== "tui" || !ctx.hasUI) { ctx.ui?.notify?.(`Memory: ${rows.length} recent entries. Open /memory in TUI mode to browse details.`, "info"); return; }
  try {
    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      ownClose(() => done());
      return new MemoryBrowser(rows, load, theme, () => Math.max(1, Math.min(28, tui.terminal.rows - 4)),
        () => tui.requestRender(), () => done(), current, title);
    }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "90%" } });
  } finally { ownClose(undefined); }
}
