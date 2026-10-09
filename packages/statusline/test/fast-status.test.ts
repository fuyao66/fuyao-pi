import { expect, test } from "bun:test";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderStatusline, renderExtensionStatusline, type RuntimeState } from "../src/render.ts";
import { normalizeStatuslineConfig } from "../src/settings.ts";
import { segmentPaletteForPreset } from "../src/presets/index.ts";
import { PALETTE_NAMES, type SegmentName } from "../src/types.ts";
import { inferInformationProfile } from "../src/information-profiles.ts";

const plain = (s: string) => s.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
const runtime: RuntimeState = { turnCount: 0, activeTools: new Map(), isStreaming: false, thinkingLevel: "high", duplicateExtensions: [], extensionStatusIconAliases: new Map() };
const ctx = { model: { id: "gpt-5.6-sol" }, sessionManager: { getEntries: () => [] } } as unknown as ExtensionContext;
const theme = { fg: (_: string, s: string) => s } as Theme;
const data = (statuses: Map<string, string>) => ({ getGitBranch: () => null, getAvailableProviderCount: () => 1, getExtensionStatuses: () => statuses, onBranchChange: () => () => {} });

test("Fast segment normalizes, has preset colors and defaults without altering existing custom fields", () => {
  const old = normalizeStatuslineConfig({ segments: ["model"], palettePreset: "custom", palette: { model: { fg: "#F5DEED", bg: "#432C45" } } });
  expect(old.diagnostics).toEqual([]);
  expect(old.config.showExtensionStatuses).toBe(true); // existing configs retain upstream behavior
  expect(old.config.segments).toEqual(["model"]);
  expect(old.config.palette.model).toEqual({ fg: "#f5deed", bg: "#432c45" });
  for (const name of PALETTE_NAMES) expect(segmentPaletteForPreset(name).fast).toEqual(segmentPaletteForPreset(name).thinking);
  const normalized = normalizeStatuslineConfig({ segments: ["model", "fast"], showExtensionStatuses: false, segmentText: { fast: { prefix: "⚡ ", suffix: "!" } } });
  expect(normalized.diagnostics).toEqual([]);
  expect(normalized.config.segments).toEqual(["model", "fast"]);
  expect(normalized.config.showExtensionStatuses).toBe(false);
  expect(normalized.config.segmentText.fast).toEqual({ prefix: "⚡ ", suffix: "!" });
  const invalid = normalizeStatuslineConfig({ showExtensionStatuses: "false" });
  expect(invalid.config.showExtensionStatuses).toBe(true);
  expect(invalid.diagnostics.map(d => d.path)).toContain("showExtensionStatuses");
});

test("old information profiles remain unchanged custom layouts until explicitly reselected", () => {
  const previousBalanced: SegmentName[] = ["model", "thinking", "cwd", "branch", "tools", "context", "time"];
  const previousDetailed: SegmentName[] = ["provider", "model", "thinking", "cwd", "branch", "tools", "context", "tokens", "cache", "cost", "time"];
  for (const segments of [previousBalanced, previousDetailed]) {
    const { config, diagnostics } = normalizeStatuslineConfig({ segments });
    expect(diagnostics).toEqual([]);
    expect(config.segments).toEqual(segments);
    expect(config.segments).not.toContain("fast");
    expect(inferInformationProfile(config.segments)).toBe("custom");
  }
});

test("enabled Fast is inline once, with unknown/missing statuses left alone", () => {
  const { config } = normalizeStatuslineConfig({ segments: ["model", "fast"] });
  const statusesWithFast = new Map([["pi-gpt-fast-mode", "⚡ Fast"], ["sub-agents", "sub-agents ↑455k ↓5.4k"]]);
  const inlineFooter = data(statusesWithFast);
  const main = renderStatusline(180, ctx, inlineFooter, theme, config, runtime);
  expect(plain(main)).toContain("⚡ Fast");
  expect(plain(main)).not.toContain("⚡  Fast");
  const extra = plain(renderExtensionStatusline(180, inlineFooter, theme, config, runtime, main).join(" "));
  expect(extra).not.toContain("Fast");
  expect(extra).toContain("455k");
  for (const value of [undefined, "unexpected fast plugin text"]) {
    const statuses = new Map<string, string>();
    if (value !== undefined) statuses.set("pi-gpt-fast-mode", value);
    const footer = data(statuses);
    const main = renderStatusline(180, ctx, footer, theme, config, runtime);
    expect(plain(main)).not.toContain("Fast");
    if (value !== undefined) expect(plain(renderExtensionStatusline(180, footer, theme, config, runtime, main).join(""))).toContain(value);
  }
  // Explicitly excluding the segment preserves the old separate-row fallback.
  const statuses = new Map([["pi-gpt-fast-mode", "⚡ Fast"]]);
  const footer = data(statuses);
  const configWithoutFast = { ...config, segments: ["model"] as const };
  expect(plain(renderExtensionStatusline(180, footer, theme, { ...configWithoutFast, segments: [...configWithoutFast.segments] }, runtime, "model").join(""))).toContain("⚡ Fast");
});

test("missing Fast leaves no empty segment, decoration or blank row", () => {
  const { config } = normalizeStatuslineConfig({ segments: ["model", "fast"] });
  const footer = data(new Map());
  const withoutFast = { ...config, segments: ["model"] as SegmentName[] };
  for (const width of [12, 24, 80, 180]) {
    expect(renderStatusline(width, ctx, footer, theme, config, runtime)).toBe(
      renderStatusline(width, ctx, footer, theme, withoutFast, runtime),
    );
  }
  const fastOnly = { ...config, segments: ["fast"] as SegmentName[] };
  expect(renderStatusline(180, ctx, footer, theme, fastOnly, runtime)).toBe("");
  expect(renderExtensionStatusline(180, footer, theme, fastOnly, runtime, "")).toEqual([]);
});

test("hiding only the extension rows preserves inline Fast and other main fields, including resizing", () => {
  const { config } = normalizeStatuslineConfig({ segments: ["model", "fast"], showExtensionStatuses: false });
  const statuses = new Map([["pi-gpt-fast-mode", "⚡ Fast"], ["sub-agents", "sub-agents ↑455k ↓5.4k"]]);
  const footer = data(statuses);
  for (const width of [12, 24, 80, 180]) {
    const main = renderStatusline(width, ctx, footer, theme, config, runtime);
    for (const line of main.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    expect(plain(main).replace(/\s/g, "")).toContain("⚡Fast");
    expect(renderExtensionStatusline(width, footer, theme, config, runtime, main)).toEqual([]);
  }
  expect([...statuses.keys()]).toEqual(["pi-gpt-fast-mode", "sub-agents"]); // no hook/status deletion
});
