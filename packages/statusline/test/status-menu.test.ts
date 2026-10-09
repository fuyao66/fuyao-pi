import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { handleStatuslineCommand, type StatuslineCommandOptions } from "../src/commands.ts";
import { loadStatuslineSettings } from "../src/settings.ts";

const document = {
  segments: ["model", "fast", "context"],
  palettePreset: "custom",
  palette: { model: { fg: "#F5DEED", bg: "#432C45" } },
  segmentText: { model: { prefix: "M ", suffix: "" } },
  futureSetting: "preserved",
};

async function fixture(run: (f: {
  path: string;
  notices: string[];
  ctx: ExtensionCommandContext;
  options: StatuslineCommandOptions;
  controller: AbortController;
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "fuyao-status-menu-"));
  try {
    const path = join(dir, "pi-statusline.json");
    await writeFile(path, `${JSON.stringify(document, null, "\t")}\n`);
    let loaded = loadStatuslineSettings(path);
    const notices: string[] = [];
    const controller = new AbortController();
    let screen = 0;
    const ctx = {
      mode: "tui", hasUI: true,
      ui: {
        notify: (text: string) => notices.push(text),
        // Exercise the real menu navigator/action handler without rendering a terminal.
        custom: async () => ({ kind: "activate", itemId: screen++ % 2 === 0 ? "advanced" : "extensionStatuses" }),
      },
    } as unknown as ExtensionCommandContext;
    const options: StatuslineCommandOptions = {
      settingsPath: path, getLoaded: () => loaded,
      apply: next => { loaded = next; },
      getMenuOwner: () => ({ signal: controller.signal, isCurrent: () => !controller.signal.aborted }),
    };
    await run({ path, notices, ctx, options, controller });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("Advanced toggles extension rows and persists only the new setting, preserving custom fields", async () => {
  await fixture(async ({ path, notices, ctx, options }) => {
    expect(options.getLoaded().config.showExtensionStatuses).toBe(true);
    await handleStatuslineCommand("", ctx, options);
    expect(options.getLoaded().config.showExtensionStatuses).toBe(false);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...document, showExtensionStatuses: false });
    expect(notices.some(text => text === "Extension status rows hidden.")).toBe(true);
    await handleStatuslineCommand("", ctx, options);
    expect(options.getLoaded().config.showExtensionStatuses).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...document, showExtensionStatuses: true });
    expect(notices.some(text => text === "Extension status rows shown.")).toBe(true);
  });
});

test("save failure preserves the file and live footer without a success notice", async () => {
  await fixture(async ({ path, notices, ctx, options }) => {
    const before = await readFile(path, "utf8");
    options.save = () => { throw new Error("isolated write failure"); };
    await handleStatuslineCommand("", ctx, options);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(options.getLoaded().config.showExtensionStatuses).toBe(true);
    expect(notices.some(text => text.includes("was not saved: isolated write failure"))).toBe(true);
    expect(notices).not.toContain("Extension status rows hidden.");
  });
});

test("runtime apply failure rolls back the saved document and effective setting", async () => {
  await fixture(async ({ path, notices, ctx, options }) => {
    const before = await readFile(path, "utf8");
    const apply = options.apply;
    options.apply = (next, ctx) => {
      if (!next.config.showExtensionStatuses) throw new Error("isolated apply failure");
      apply(next, ctx);
    };
    await handleStatuslineCommand("", ctx, options);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(options.getLoaded().config.showExtensionStatuses).toBe(true);
    expect(notices.some(text => text.includes("isolated apply failure"))).toBe(true);
    expect(notices).not.toContain("Extension status rows hidden.");
  });
});

test("Back and Escape close the menu without changing file, live config or notices", async () => {
  await fixture(async ({ path, notices, ctx, options }) => {
    const before = await readFile(path, "utf8");
    const events = [
      { kind: "activate", itemId: "advanced" },
      { kind: "back" },
      { kind: "close" },
    ];
    ctx.ui.custom = (async () => events.shift()) as typeof ctx.ui.custom;
    await handleStatuslineCommand("", ctx, options);
    expect(events).toHaveLength(0);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(options.getLoaded().config.showExtensionStatuses).toBe(true);
    expect(notices).toEqual([]);
  });
});

test("an aborted menu owner cannot save a stale toggle", async () => {
  await fixture(async ({ path, notices, ctx, options, controller }) => {
    const before = await readFile(path, "utf8");
    let screen = 0;
    ctx.ui.custom = (async () => {
      if (screen++ === 0) return { kind: "activate", itemId: "advanced" };
      controller.abort();
      return { kind: "activate", itemId: "extensionStatuses" };
    }) as typeof ctx.ui.custom;
    await handleStatuslineCommand("", ctx, options);
    expect(await readFile(path, "utf8")).toBe(before);
    expect(options.getLoaded().config.showExtensionStatuses).toBe(true);
    expect(notices).not.toContain("Extension status rows hidden.");
  });
});
