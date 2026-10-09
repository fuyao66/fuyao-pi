import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import fastMode from "../src/index.ts";
import statusline from "../../statusline/src/statusline.ts";
import { DEFAULT_STATUSLINE_CONFIG } from "../../statusline/src/settings.ts";

for (const fastFirst of [false, true]) test(`Fast is inline, extra rows stay hidden and lifecycle works (fast first: ${fastFirst})`, async () => {
  const dir = await mkdtemp(join(tmpdir(), "fuyao-fast-footer-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  let footer: { render(width: number): string[]; dispose(): void } | undefined;
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    await writeFile(join(dir, "settings.json"), "{}");
    await writeFile(join(dir, "keybindings.json"), '{"pi-gpt-fast-mode":[]}');
    await writeFile(join(dir, "pi-statusline.json"), JSON.stringify({ ...DEFAULT_STATUSLINE_CONFIG, showExtensionStatuses: false, segments: ["model", "fast", "context"] }));
    const handlers = new Map<string, Function[]>();
    const commands = new Map<string, { handler: Function }>();
    const statuses = new Map<string, string>();
    let renders = 0;
    const pi = {
      on: (name: string, handler: Function) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
      registerCommand: (name: string, registration: { handler: Function }) => commands.set(name, registration),
      registerShortcut: () => {},
      getThinkingLevel: () => "high",
      exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }),
    } as unknown as ExtensionAPI;
    if (fastFirst) { fastMode(pi); statusline(pi); }
    else { statusline(pi); fastMode(pi); }
    const ctx = {
      cwd: dir, mode: "tui", model: { provider: "cpa", id: "gpt-5.6-sol", contextWindow: 400000 },
      sessionManager: { getEntries: () => [] },
      getContextUsage: () => ({ percent: 25, tokens: 100000, contextWindow: 400000 }),
      ui: {
        notify: () => {},
        setStatus: (key: string, value: string | undefined) => {
          if (value === undefined) statuses.delete(key); else statuses.set(key, value);
          renders++;
        },
        setFooter: (factory?: Function) => {
          footer?.dispose(); footer = undefined;
          if (factory) footer = factory({ requestRender: () => { renders++; } }, { fg: (_: string, text: string) => text } as Theme,
            { getGitBranch: () => undefined, getExtensionStatuses: () => statuses, onBranchChange: () => () => {} });
        },
      },
    } as unknown as ExtensionContext;
    const emit = async (name: string, event: unknown = {}) => {
      for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
    };
    await emit("session_start");
    statuses.set("acp-sub-agents", "sub-agents ↑455k ↓5.4k");
    expect(footer!.render(180)).toHaveLength(1);
    expect(footer!.render(180)[0]).not.toContain("Fast");
    expect(statuses.has("pi-gpt-fast-mode")).toBe(false);
    const mainBefore = footer!.render(180)[0];
    const beforeToggle = renders;
    await commands.get("fast")!.handler("", ctx);
    expect(renders).toBeGreaterThan(beforeToggle);
    expect(footer!.render(180)[0]).toContain("⚡ Fast");
    expect(footer!.render(180)[0]).not.toContain("⚡  Fast");
    expect(footer!.render(180)[0]).not.toContain("Fast ON");
    for (const width of [12, 24, 80, 180]) {
      const lines = footer!.render(width);
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      expect(lines.join(" ").replace(/\x1b\[[0-9;]*m/g, "").replace(/\s/g, "")).toContain("⚡Fast");
      expect(lines.join(" ")).not.toContain("sub-agents");
      if (width >= 80) expect(lines).toHaveLength(1);
    }
    ctx.model = { ...ctx.model!, provider: "other" };
    await emit("model_select", { model: ctx.model });
    expect(footer!.render(180)[0]).not.toContain("Fast");
    expect(statuses.has("pi-gpt-fast-mode")).toBe(false);
    ctx.model = { ...ctx.model!, provider: "cpa" };
    await emit("model_select", { model: ctx.model });
    expect(footer!.render(180)[0]).toContain("⚡ Fast");
    await commands.get("fast")!.handler("", ctx);
    expect(footer!.render(180)[0]).toBe(mainBefore); // no blank block or separator remains
    expect(statuses.has("pi-gpt-fast-mode")).toBe(false);
    expect(statuses.get("acp-sub-agents")).toBe("sub-agents ↑455k ↓5.4k");
    await emit("session_shutdown");
    expect(footer).toBeUndefined();
    expect(statuses.has("pi-gpt-fast-mode")).toBe(false);
    expect(statuses.get("acp-sub-agents")).toBe("sub-agents ↑455k ↓5.4k");
  } finally {
    footer?.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
