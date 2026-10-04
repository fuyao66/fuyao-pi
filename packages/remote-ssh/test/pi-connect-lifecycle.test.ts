import { expect, test } from "bun:test";
import { createBashToolDefinition, createEventBus } from "@earendil-works/pi-coding-agent";
import { getPiRemoteStateForSession, installPiRemoteExtension } from "../src/pi/host-extension.ts";
import { workspaceBinding } from "../src/pi/workspace-binding.ts";

async function fixture() {
  const events = createEventBus();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const handlers = new Map<string, any>();
  const builtin = { ...createBashToolDefinition("/tmp"), sourceInfo: { source: "builtin", path: "<builtin:bash>", scope: "temporary", origin: "top-level" } };
  await installPiRemoteExtension({ events,
    getAllTools() { return [builtin]; }, getActiveTools() { return ["bash"]; },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    on(name: string, handler: any) { handlers.set(name, handler); },
  } as never);
  return { tools, commands, handlers, state: getPiRemoteStateForSession(events), binding: workspaceBinding(events) };
}

test("connection reserves domain before awaits and failed preparation stays fail-closed", async () => {
  const f = await fixture();
  const connect = f.tools.get("remote_connect");
  const pending = connect.execute("connect", { target: "-invalid" }, undefined, undefined, { cwd: "/tmp" });
  const failure = pending.catch((error: unknown) => error);
  expect(f.state.selected).toBe(true);
  expect(f.binding.phase).toBe("connecting");
  for (const toolName of ["bash", "write", "powershell", "acp_delegate"]) {
    expect(f.handlers.get("tool_call")({ toolName, input: {} }, { cwd: "/tmp" }).block).toBe(true);
  }
  await expect(connect.execute("duplicate", { target: "host" })).rejects.toThrow("already in progress");
  await expect(f.tools.get("remote_exit").execute("exit", {})).rejects.toThrow("connection is in progress");
  await expect(f.handlers.get("user_bash")()).rejects.toThrow("disabled");
  expect(await failure).toBeInstanceOf(Error);
  expect(f.state.connecting).toBeUndefined();
  expect(f.state.selected).toBe(true);
  expect(f.binding.phase).toBe("unavailable");
  expect(f.handlers.get("tool_call")({ toolName: "bash", input: {} }, {}).block).toBe(true);
});

test("connect honors cancellation and releases the transition reservation", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const pending = f.tools.get("remote_connect").execute("connect", { target: "host" }, controller.signal, undefined, { cwd: "/tmp" });
  const failure = pending.catch((error: unknown) => error);
  controller.abort(new Error("cancel connection"));
  expect(String(await failure)).toContain("cancel connection");
  expect(f.state.connecting).toBeUndefined();
  expect(f.binding.phase).toBe("unavailable");
  expect(f.state.selected).toBe(true);
  expect(f.handlers.get("tool_call")({ toolName: "bash", input: {} }, {}).block).toBe(true);
});

test("session shutdown invalidates preparation without resurrecting remote state", async () => {
  const f = await fixture();
  const pending = f.tools.get("remote_connect").execute("connect", { target: "host" }, undefined, undefined, { cwd: "/tmp" });
  const failure = pending.catch((error: unknown) => error);
  await f.handlers.get("session_shutdown")({ reason: "quit" });
  expect(String(await failure)).toContain("obsolete");
  expect(f.state.selected).toBe(false);
  expect(f.state.connecting).toBeUndefined();
  expect(f.binding.phase).toBe("local");
});
