import { describe, expect, test } from "bun:test";
import { createEventBus, createReadTool } from "@earendil-works/pi-coding-agent";
import { buildPiWorkspaceStatus, getPiRemoteStateForSession, installPiRemoteExtension } from "../src/pi/host-extension.ts";
import { resolvePiRuntimeAssembly, PI_REMOTE_RUNTIME_VERSION } from "../src/pi/assembly.ts";

describe("Pi + BC workspace status", () => {
  test("reports local Pi when disconnected", () => {
    const status = buildPiWorkspaceStatus({ selected: false });
    expect(status.mode).toBe("local");
    expect(status.transport).toBe("not-selected");
    expect(status.assembly).toBeNull();
    expect(status.remoteWorkspaceTools).toEqual([]);
  });
  test("reports the core-only worker and local BC boundary", async () => {
    const assembly = await resolvePiRuntimeAssembly({ tools: [{ ...createReadTool("/tmp"), sourceInfo: { source: "builtin", path: "<builtin:read>", scope: "temporary", origin: "top-level" } }] });
    const state = { selected: true, assembly, cwd: "/remote/project", scope: { isClosed: false } as never, ownershipVerified: true, ready: { type: "ready" as const, protocolVersion: 1, host: "pi" as const, hostVersion: assembly.host.version, toolRuntimeVersion: PI_REMOTE_RUNTIME_VERSION, tools: [...assembly.tools], capabilities: { assembly: assembly.request } } };
    const status = buildPiWorkspaceStatus(state);
    expect(status.mode).toBe("remote");
    expect(status.assembly?.plugins).toEqual([]);
    expect(status.remoteWorkspaceTools).toEqual(["read"]);
    expect(status.componentToolGroups).toHaveLength(1);
    expect(status.routing.executionRuntime).toContain("BC control plane remains local");
    expect(assembly.executionRuntime.local).toBe("Pi + billion-context:pi-native");
    expect(status.note).toContain("BC context");
    expect(JSON.stringify(status)).not.toMatch(/BCP|billion-context-pi/);
    expect(buildPiWorkspaceStatus({ ...state, ownershipVerified: false }).mode).toBe("unavailable");
    expect(buildPiWorkspaceStatus({ ...state, scope: { isClosed: true } as never }).remoteWorkspaceTools).toEqual([]);
  });
  test("publishes read-only identity and never falls back to local on remote failure", async () => {
    const events = createEventBus();
    await installPiRemoteExtension({ events, registerTool() {}, registerCommand() {}, on() {} } as never);
    const state = getPiRemoteStateForSession(events);
    const read = () => { let result: any; events.emit('fuyao:workspace-identity', { accept(value: unknown) { result = value; } }); return result; };
    expect(read().mode).toBe('local');
    state.selected = true;
    expect(read().mode).toBe('unavailable');
    state.assembly = await resolvePiRuntimeAssembly({ tools: [{ ...createReadTool('/tmp'), sourceInfo: { source: 'builtin', path: '<builtin:read>', scope: 'temporary', origin: 'top-level' } }] });
    state.scope = { isClosed: false } as never; state.ownershipVerified = true; state.cwd = '/remote/project';
    state.connectOptions = { target: 'test-host', port: 2222, identity: '/private/key' } as never;
    expect(read()).toMatchObject({ mode: 'remote', target: 'test-host', port: 2222, root: '/remote/project' });
    expect(JSON.stringify(read())).not.toContain('private');
    state.connectionError = 'offline'; expect(read().mode).toBe('unavailable');
  });
  test("current BC names appear in tools and the selected-workspace prompt only", async () => {
    const events = createEventBus(), tools = new Map<string, any>(), handlers = new Map<string, Function>();
    await installPiRemoteExtension({ events, registerTool(tool: any) { tools.set(tool.name, tool); }, registerCommand() {}, on(name: string, handler: Function) { handlers.set(name, handler); } } as never);
    const state = getPiRemoteStateForSession(events);
    const prompt = handlers.get("before_agent_start")!;
    expect(tools.get("remote_connect").description).toContain("Billion Context (BC)");
    expect(tools.get("remote_connect").description).not.toMatch(/BCP|billion-context-pi/);
    expect(prompt({ systemPrompt: "BASE" })).toBeUndefined();
    state.selected = true; state.cwd = "/remote/project";
    state.connectOptions = { target: "test-host", displayTarget: "test-host" } as never;
    const text = prompt({ systemPrompt: "BASE" }).systemPrompt;
    expect(text).toContain("BASE\n\nSSH WORKSPACE: test-host:/remote/project");
    expect(text).toContain("BC context tools, delegate orchestration and sessions stay LOCAL.");
    expect(text).toContain("No local fallback on transport loss.");
    expect(text).not.toMatch(/BCP|billion-context-pi/);
    state.selected = false;
    expect(prompt({ systemPrompt: "BASE" })).toBeUndefined();
  });
  test("registers only controls before a connection", async () => {
    const tools: string[] = [], commands: string[] = [], handlers: string[] = [];
    await installPiRemoteExtension({ events: createEventBus(), registerTool(tool: { name: string }) { tools.push(tool.name); }, registerCommand(name: string) { commands.push(name); }, on(name: string) { handlers.push(name); } } as never);
    expect(tools.sort()).toEqual(["remote_connect", "remote_exit", "remote_workspace_status"]);
    expect(commands.sort()).toEqual(["remote-connect", "remote-exit", "remote-status"]);
    for (const name of ["tool_call", "tool_result", "session_shutdown", "before_agent_start", "user_bash"]) expect(handlers).toContain(name);
  });
});
