import { describe, expect, test } from "bun:test";
import { createEventBus, createReadTool } from "@earendil-works/pi-coding-agent";
import { buildPiWorkspaceStatus, getPiRemoteStateForSession, installPiRemoteExtension } from "../src/pi/host-extension.ts";
import { resolvePiRuntimeAssembly, PI_REMOTE_RUNTIME_VERSION } from "../src/pi/assembly.ts";

describe("Pi + BCP workspace status", () => {
  test("reports local Pi when disconnected", () => {
    const status = buildPiWorkspaceStatus({ selected: false });
    expect(status.mode).toBe("local");
    expect(status.transport).toBe("not-selected");
    expect(status.assembly).toBeNull();
    expect(status.remoteWorkspaceTools).toEqual([]);
  });
  test("reports the core-only worker and local BCP boundary", async () => {
    const assembly = await resolvePiRuntimeAssembly({ tools: [{ ...createReadTool("/tmp"), sourceInfo: { source: "builtin", path: "<builtin:read>", scope: "temporary", origin: "top-level" } }] });
    const state = { selected: true, assembly, cwd: "/remote/project", scope: { isClosed: false } as never, ownershipVerified: true, ready: { type: "ready" as const, protocolVersion: 1, host: "pi" as const, hostVersion: assembly.host.version, toolRuntimeVersion: PI_REMOTE_RUNTIME_VERSION, tools: [...assembly.tools], capabilities: { assembly: assembly.request } } };
    const status = buildPiWorkspaceStatus(state);
    expect(status.mode).toBe("remote");
    expect(status.assembly?.plugins).toEqual([]);
    expect(status.remoteWorkspaceTools).toEqual(["read"]);
    expect(status.componentToolGroups).toHaveLength(1);
    expect(status.routing.executionRuntime).toContain("BCP control plane remains local");
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
  test("registers only controls before a connection", async () => {
    const tools: string[] = [], commands: string[] = [], handlers: string[] = [];
    await installPiRemoteExtension({ events: createEventBus(), registerTool(tool: { name: string }) { tools.push(tool.name); }, registerCommand(name: string) { commands.push(name); }, on(name: string) { handlers.push(name); } } as never);
    expect(tools.sort()).toEqual(["remote_connect", "remote_exit", "remote_workspace_status"]);
    expect(commands.sort()).toEqual(["remote-connect", "remote-exit", "remote-status"]);
    for (const name of ["tool_call", "tool_result", "session_shutdown", "before_agent_start", "user_bash"]) expect(handlers).toContain(name);
  });
});
