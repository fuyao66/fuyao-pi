import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import statusline from "../src/statusline.js";
import { DEFAULT_STATUSLINE_CONFIG } from "../src/settings.js";

test("native footer factory renders responsive rows and disposes on shutdown, without model calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fuyao-statusline-lifecycle-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const handlers = new Map<string, Function>();
  let footer: { render(width: number): string[]; dispose(): void } | undefined;
  let unsubscribed = 0;
  const commands: string[] = [];
  const statuses = new Map<string, string>();
  try {
    await writeFile(join(dir, "pi-statusline.json"), JSON.stringify({ ...DEFAULT_STATUSLINE_CONFIG, segments: ["model", "thinking", "context", "cache"] }));
    const pi = {
      on: (name: string, handler: Function) => { handlers.set(name, handler); },
      registerCommand: (name: string) => { commands.push(name); },
      getThinkingLevel: () => "high",
      exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }),
    } as unknown as ExtensionAPI;
    statusline(pi);
    const ctx = {
      cwd: dir, mode: "tui", model: { id: "gpt-6.1-sol", contextWindow: 400000 },
      sessionManager: { getEntries: () => [{ type: "message", message: { role: "assistant", usage: { input: 10, cacheRead: 90, cacheWrite: 0 } } }] },
      getContextUsage: () => ({ percent: 25, tokens: 100000, contextWindow: 400000 }),
      ui: {
        notify: () => {}, setStatus: () => {},
        setFooter: (factory?: Function) => {
          footer?.dispose(); footer = undefined;
          if (factory) footer = factory({ requestRender: () => {} }, { fg: (_: string, s: string) => s } as Theme,
            { getGitBranch: () => undefined, getExtensionStatuses: () => statuses, onBranchChange: () => () => { unsubscribed++; } });
        },
      },
    } as unknown as ExtensionContext;
    handlers.get("session_start")!({}, ctx);
    expect(commands).toContain("statusline");
    const wide = footer!.render(180); expect(wide.length).toBe(1);
    const narrow = footer!.render(50); expect(narrow.length).toBe(2);
    for (const line of narrow) expect(visibleWidth(line)).toBeLessThanOrEqual(50);
    expect(narrow.join("\n")).toContain("CHavg 90.0%");
    statuses.set("usage", "📊 中文 ready");
    for (const width of [1, 2, 12, 50]) {
      for (const line of footer!.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
    handlers.get("session_shutdown")!({}, ctx);
    expect(footer).toBeUndefined(); expect(unsubscribed).toBe(1);
  } finally {
    footer?.dispose();
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});
