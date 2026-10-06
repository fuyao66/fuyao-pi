import { expect, test } from "bun:test";
import type { ExtensionContext, SessionEntry, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderStatusline, renderExtensionStatusline, type RuntimeState } from "../src/render.js";
import { renderPowerlineStatusline } from "../src/powerline.js";
import { DEFAULT_STATUSLINE_CONFIG } from "../src/settings.js";
import { summarizeFooterUsage } from "../src/usage.js";
import type { RenderSegment } from "../src/types.js";

const plain = (s: string) => s.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
const entry = (input: number, cacheRead: number, cacheWrite = 0, type = "message"): SessionEntry => ({
  type, message: { role: "assistant", usage: { input, cacheRead, cacheWrite, output: 0 } },
  usage: { input, cacheRead, cacheWrite, output: 0 },
} as unknown as SessionEntry);

test("cache average is weighted by all prompt tokens, includes nested/summary usage, and survives empty errors", () => {
  const nested = entry(100, 200); if (nested.type === "message") (nested.message as unknown as { role: string }).role = "toolResult";
  const summary = summarizeFooterUsage([entry(100, 900), entry(90, 10), nested, entry(20, 80, 10, "compaction"), entry(0, 0)]);
  expect(summary.cacheRead).toBe(1190);
  expect(summary.cacheHitRate).toBeCloseTo(1190 / 1510 * 100, 8);
  expect(summarizeFooterUsage([entry(0, 0)]).cacheHitRate).toBeUndefined();
});

const runtime: RuntimeState = { turnCount: 0, activeTools: new Map(), isStreaming: false, thinkingLevel: "high", duplicateExtensions: [], extensionStatusIconAliases: new Map() };
const footer = { getGitBranch: () => "main", getAvailableProviderCount: () => 1, getExtensionStatuses: () => new Map(), onBranchChange: () => () => {} };
const config = { ...DEFAULT_STATUSLINE_CONFIG, segments: ["model", "thinking", "cwd", "context", "cache", "time"] as const };
function render(width: number, tokens: number | null = 104000, percent: number | null = 26) {
  const ctx = { cwd: "/workspace/中文项目", model: { id: "gpt-6.1-sol", contextWindow: 400000 }, getContextUsage: () => ({ tokens, percent, contextWindow: 400000 }), sessionManager: { getEntries: () => [entry(100, 900), entry(90, 10)] } } as unknown as ExtensionContext;
  return renderStatusline(width, ctx, footer, {} as Theme, { ...config, segments: [...config.segments] }, runtime);
}
test("context shows percentage and used/window, cache displays cumulative average", () => {
  const line = plain(render(220));
  expect(line).toContain("26.0% 104k/400k");
  expect(line).toContain("CHavg 82.7%");
  expect(plain(render(220, null, null))).toContain("? ?/400k");
  // Do not conceal Pi's over-window estimates by clamping them.
  expect(plain(render(220, 600000, 150))).toContain("150.0% 600k/400k");
});

test("responsive footer fits one or two lines, retains every field when resized", () => {
  const wide = render(220);
  expect(wide.split("\n")).toHaveLength(1);
  const fullWidth = visibleWidth(wide);
  let found = false;
  for (let width = Math.ceil(fullWidth / 2); width < fullWidth; width++) {
    const lines = render(width).split("\n");
    if (lines.length !== 2) continue;
    found = true;
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    for (const text of ["gpt 6.1-sol", "high", "中文项目", "26.0% 104k/400k", "CHavg 82.7%"])
      expect(plain(lines.join("\n"))).toContain(text);
    break;
  }
  expect(found).toBe(true);
  expect(render(220).split("\n")).toHaveLength(1);
});

test("extremely narrow rows wrap instead of dropping segments, including ANSI and CJK", () => {
  const items: RenderSegment[] = [
    { name: "model", text: "MODELunique", color: "accent", block: "header" },
    { name: "cwd", text: "中文项目", color: "accent", block: "directory" },
    { name: "cache", text: "CACHEunique", color: "accent", block: "runtime" },
  ];
  for (const trueColor of [true, false]) {
    for (const width of [1, 2, 8, 16, 32]) {
      const result = renderPowerlineStatusline(width, items, DEFAULT_STATUSLINE_CONFIG, trueColor);
      for (const line of result.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      const text = plain(result).replace(/\n/g, "");
      expect(text).toContain("MODELunique"); expect(text).toContain("CACHEunique");
      if (width >= 2) expect(text).toContain("中文项目");
    }
  }
});

test("uncached sessions explicitly show 0%, while empty usage has no rate", () => {
  const ctx = { model: { id: "model" }, sessionManager: { getEntries: () => [entry(200, 0)] } } as unknown as ExtensionContext;
  const cacheConfig = { ...DEFAULT_STATUSLINE_CONFIG, segments: ["cache"] as const };
  const render = () => plain(renderStatusline(120, ctx, footer, {} as Theme, { ...cacheConfig, segments: [...cacheConfig.segments] }, runtime));
  expect(render()).toContain("CHavg 0.0%");
  ctx.sessionManager.getEntries = () => [entry(0, 0)];
  expect(render()).toBe("");
});

test("oversized directory wraps the full line without decoration-only rows", () => {
  const items: RenderSegment[] = [
    { name: "model", text: "short", color: "accent", block: "header" },
    { name: "cwd", text: "x".repeat(90), color: "accent", block: "directory" },
    { name: "context", text: "26.0% 104k/400k", color: "accent", block: "runtime" },
  ];
  const lines = renderPowerlineStatusline(80, items, DEFAULT_STATUSLINE_CONFIG).split("\n");
  expect(lines).toHaveLength(2);
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
  expect(plain(lines.join(""))).toContain("x".repeat(90));
});

test("wrapped branch PR status is not repeated, including OSC links", () => {
  for (const reference of ["#123", "\x1b]8;;https://example.test/pr/123\x07#123\x1b]8;;\x07"]) {
    const data = { ...footer, getGitBranch: () => "longbranch".repeat(5), getExtensionStatuses: () => new Map([["github-pr", `PR ${reference}: checks pending (2)`]]) };
    const ctx = { sessionManager: { getEntries: () => [] } } as unknown as ExtensionContext;
    const config = { ...DEFAULT_STATUSLINE_CONFIG, segments: ["branch"] as const };
    const mainLine = renderStatusline(24, ctx, data, {} as Theme, { ...config, segments: [...config.segments] }, runtime);
    expect(mainLine.split("\n").length).toBeGreaterThan(1);
    const theme = { fg: (_: string, text: string) => text } as Theme;
    expect(renderExtensionStatusline(24, data, theme, { ...config, segments: [...config.segments] }, runtime, mainLine)).toEqual([]);
    expect(renderExtensionStatusline(80, data, theme, { ...config, segments: [] }, runtime, "model").join("")).toContain("#123");
  }
});

test("explicit line breaks are preserved", () => {
  const result = renderPowerlineStatusline(220, [{ name: "model", text: "model", color: "accent", block: "header" }, { name: "line_break" }, { name: "context", text: "context", color: "accent", block: "runtime" }], DEFAULT_STATUSLINE_CONFIG);
  expect(result.split("\n")).toHaveLength(2);
});
