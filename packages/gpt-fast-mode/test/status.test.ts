import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fastMode, { STATUS_KEY, formatFastStatus } from "../src/index.ts";

const supported = { provider: "cpa", id: "gpt-5.6-sol" };
const unsupported = { provider: "other", id: "gpt-5.6-sol" };

test("only enabled and eligible Fast publishes a single-space indicator", () => {
  expect(formatFastStatus(false, supported)).toBeUndefined();
  expect(formatFastStatus(true, supported)).toBe("⚡ Fast");
  expect(formatFastStatus(true, unsupported)).toBeUndefined();
  expect(formatFastStatus(true, undefined)).toBeUndefined();
  expect(formatFastStatus(true, supported, new Set())).toBeUndefined();
});

test("footer tracks command/shortcut, model selection, session reset and cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fuyao-fast-status-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    await writeFile(join(dir, "settings.json"), "{}");
    await writeFile(join(dir, "keybindings.json"), '{}');
    const handlers = new Map<string, Function>();
    let command: Function | undefined;
    let shortcut: Function | undefined;
    const statuses = new Map<string, string>();
    const notices: string[] = [];
    fastMode({
      on: (name: string, handler: Function) => handlers.set(name, handler),
      registerCommand: (_name: string, registration: { handler: Function }) => { command = registration.handler; },
      registerShortcut: (_key: string, registration: { handler: Function }) => { shortcut = registration.handler; },
    } as unknown as ExtensionAPI);
    const ctx = {
      mode: "tui", model: supported,
      ui: {
        setStatus: (key: string, value: string | undefined) => {
          if (value === undefined) statuses.delete(key); else statuses.set(key, value);
        },
        notify: (text: string) => { notices.push(text); },
      },
    };
    const status = () => statuses.get(STATUS_KEY);
    const start = () => handlers.get("session_start")!({}, ctx);
    start();
    expect(status()).toBeUndefined();
    await command!("", ctx);
    expect(status()).toBe("⚡ Fast");
    // Event model wins even if the context has not updated yet.
    handlers.get("model_select")!({ model: unsupported }, ctx);
    expect(status()).toBeUndefined();
    ctx.model = unsupported;
    expect(handlers.get("before_provider_request")!({ payload: { model: unsupported.id } }, ctx)).toBeUndefined();
    ctx.model = supported;
    handlers.get("model_select")!({ model: supported }, ctx);
    expect(status()).toBe("⚡ Fast");
    expect(handlers.get("before_provider_request")!({ payload: { model: supported.id } }, ctx)).toEqual({ model: supported.id, service_tier: "priority" });
    await shortcut!(ctx);
    expect(status()).toBeUndefined();
    expect(handlers.get("before_provider_request")!({ payload: { model: supported.id } }, ctx)).toBeUndefined();
    await command!("", ctx);
    start();
    expect(status()).toBeUndefined();
    await writeFile(join(dir, "settings.json"), JSON.stringify({ "pi-gpt-fast-mode": { enabled: true, models: [] } }));
    start();
    expect(status()).toBeUndefined();
    await writeFile(join(dir, "settings.json"), JSON.stringify({ "pi-gpt-fast-mode": { enabled: true } }));
    start();
    expect(status()).toBe("⚡ Fast");
    handlers.get("session_shutdown")!({}, ctx);
    expect(status()).toBeUndefined();
    // Lifecycle/model updates do not spam notifications.
    expect(notices).toHaveLength(3);
    for (const mode of ["print", "json", "rpc"]) {
      const headless = { ...ctx, mode, ui: { ...ctx.ui, setStatus: () => { throw new Error("non-TUI status call"); } } };
      handlers.get("session_start")!({}, headless);
      handlers.get("model_select")!({ model: supported }, headless);
      await shortcut!(headless);
      handlers.get("session_shutdown")!({}, headless);
    }
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
