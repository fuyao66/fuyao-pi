import { describe, expect, test } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { BcpLocalArtifacts, guardDelegateCwd } from "../src/pi/integrations/bcp-local.ts";
import { createBcpConnectionInheritance, BCP_REMOTE_ENV, isInheritedBcpChild } from "../src/pi/integrations/bcp-inheritance.ts";
import { getPiRemoteOwnershipErrors, installPiRemoteExtension, getPiRemoteStateForSession } from "../src/pi/host-extension.ts";
import { resolvePiRuntimeAssembly } from "../src/pi/assembly.ts";
import { createReadTool, createEventBus } from "@earendil-works/pi-coding-agent";

async function spec() {
  const tool = createReadTool("/tmp");
  const assembly = await resolvePiRuntimeAssembly({ tools: [{ ...tool, sourceInfo: { source: "builtin", path: "<builtin:read>", scope: "temporary", origin: "top-level" } }] });
  return { ownerToken: "test-owner", assembly: assembly.request, tools: assembly.tools, connectOptions: { target: "host", displayTarget: "host" }, workerPath: "/worker", cwd: "/remote" };
}

describe("BC stays local while workspace tools are remote", () => {
  test("routes only dedicated artifacts and explicit successful decompress exports", () => {
    const artifacts = new BcpLocalArtifacts();
    expect(artifacts.isLocalRead({ path: join(tmpdir(), "acp-delegate/run.out") })).toBe(true);
    expect(artifacts.isLocalRead({ path: join(homedir(), ".cache/pi/acp-decompress/b1.txt") })).toBe(true);
    for (const path of ["/tmp/bash-output.txt", "/tmp/project/file", "/workspace/file", "relative.txt", join(tmpdir(), "acp-delegate/../secret")]) expect(artifacts.isLocalRead({ path })).toBe(false);
    artifacts.observe("decompress", [{ type: "text", text: "[Block b1 content — 3 item(s)]\nContent (100 chars) written to: /tmp/custom-export.txt\nUse the read tool to access it." }], false);
    expect(artifacts.isLocalRead({ path: "/tmp/custom-export.txt" })).toBe(true);
    expect(artifacts.isLocalRead({ path: "/tmp/injected.txt" })).toBe(false);
    artifacts.observe("bash", [{ type: "text", text: "Block b1 written to /tmp/forged.txt." }], false);
    expect(artifacts.isLocalRead({ path: "/tmp/forged.txt" })).toBe(false);
  });
  test("rejects inline, failed, wrong-tool and legacy export lookalikes", () => {
    const artifacts = new BcpLocalArtifacts();
    const receipt = "[Block b2 content — 2 item(s), full]\nContent (11000 chars) written to: /tmp/new-export.txt\nUse the read tool to access it.";
    for (const [tool, text, failed] of [
      ["read", receipt, false], ["decompress", receipt, true],
      ["decompress", `${receipt}\nextra restored text`, false],
      ["decompress", `Restored message quotes:\n${receipt}`, false],
      ["decompress", "Block b2 written to /tmp/new-export.txt.", false],
    ] as const) {
      artifacts.observe(tool, [{ type: "text", text }], failed);
      expect(artifacts.isLocalRead({ path: "/tmp/new-export.txt" })).toBe(false);
    }
    artifacts.observe("decompress", [{ type: "text", text: receipt }], false);
    expect(artifacts.isLocalRead({ path: "/tmp/new-export.txt" })).toBe(true);
    expect(artifacts.isLocalRead({ path: "/tmp/neighbor.txt" })).toBe(false);
  });
  test("keeps delegate process cwd local and rejects unrelated cwd", () => {
    const args: Record<string, unknown> = { cwd: "/remote" };
    expect(guardDelegateCwd(args, "/local", "/remote")).toBeUndefined();
    expect(args.cwd).toBe("/local");
    expect(guardDelegateCwd({ cwd: "/other" }, "/local", "/remote")?.block).toBe(true);
  });
  test("restricted delegates verify source without requiring a status tool", () => {
    const tool = { name: "read", exposure: "direct" as const, description: "read", parameters: createReadTool("/tmp").parameters, sourceInfo: { source: "extension", path: "/bridge.js", scope: "temporary" as const, origin: "top-level" as const } };
    expect(getPiRemoteOwnershipErrors([tool], [tool], new Set(["read"]), "/bridge.js")).toEqual([]);
    expect(getPiRemoteOwnershipErrors([tool], [tool], new Set(["read"]), "/other.js")).toEqual(["read"]);
  });
  test("invalid inherited connections block tools, delegates and user shell", async () => {
    const handlers = new Map<string, Function>();
    const events = createEventBus();
    await installPiRemoteExtension({ events, registerTool() {}, registerCommand() {}, on(name: string, handler: Function) { handlers.set(name, handler); } } as never, { inheritedChild: true });
    expect(getPiRemoteStateForSession(events).selected).toBe(true);
    for (const toolName of ["read", "write", "bash", "powershell", "acp_delegate"]) {
      const result = handlers.get("tool_call")!({ toolName, input: {} }, { cwd: "/local" });
      expect(result.block).toBe(true);
    }
    await expect(handlers.get("user_bash")!()).rejects.toThrow("disabled");
    const state = getPiRemoteStateForSession(events);
    Object.assign(state, { scope: { isClosed: false }, ownershipVerified: true, ready: { tools: [{ name: "read" }] } });
    expect(handlers.get("tool_call")!({ toolName: "write", input: {} }, { cwd: "/local" }).block).toBe(true);
  });
  test("publishes an owned snapshot and keeps a dispatcher for queued delegates", async () => {
    const keys = ["PI_CLI_PATH", BCP_REMOTE_ENV, "PI_BCP_REMOTE_OWNER", "PI_BCP_REMOTE_OWNER_PID", "PI_BCP_REMOTE_REAL_CLI", "PI_BCP_REMOTE_EXTENSION", "PI_BCP_REMOTE_PREVIOUS_CLI"];
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    try {
      process.env.PI_CLI_PATH = "/custom-cli.js";
      const inheritance = createBcpConnectionInheritance({ launcher: "/launcher.js", extension: "/bridge.js", cli: "/pi-cli.js" });
      const value = await spec();
      inheritance.publish(value);
      expect(process.env.PI_CLI_PATH).toBe("/launcher.js");
      expect(process.env.PI_BCP_REMOTE_REAL_CLI).toBe("/custom-cli.js");
      expect(inheritance.read()).toEqual(value);
      expect(isInheritedBcpChild()).toBe(false);
      expect(() => inheritance.claim("other")).toThrow("Another Pi session");
      process.env.PI_BCP_REMOTE_OWNER_PID = "-1";
      expect(isInheritedBcpChild()).toBe(true);
      inheritance.clear(value.ownerToken);
      expect(inheritance.hasSpec()).toBe(true);
      process.env.PI_BCP_REMOTE_OWNER_PID = String(process.pid);
      // Reload creates a new backend closure; restoration must survive that.
      createBcpConnectionInheritance({ launcher: "/launcher.js", extension: "/bridge.js", cli: "/pi-cli.js" }).clear(value.ownerToken);
      expect(process.env.PI_CLI_PATH).toBe("/launcher.js");
      expect(process.env.PI_BCP_REMOTE_REAL_CLI).toBe("/custom-cli.js");
      expect(inheritance.hasSpec()).toBe(false);
      inheritance.publish(value);
      expect(process.env.PI_BCP_REMOTE_REAL_CLI).toBe("/custom-cli.js");
      inheritance.clear(value.ownerToken);
      process.env[BCP_REMOTE_ENV] = "{}";
      expect(() => inheritance.read()).toThrow("Invalid inherited");
    } finally {
      for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    }
  });
  test("launcher forces the bridge into the child CLI", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-launcher-"));
    try {
      const cli = join(cwd, "fake-cli.mjs");
      await writeFile(cli, "console.log(JSON.stringify(process.argv.slice(2)));\n");
      const extension = join(cwd, "bridge.mjs");
      await writeFile(extension, "export default function () {}\n");
      const launcher = join(import.meta.dir, "../src/pi/bcp-launcher.ts");
      const child = Bun.spawn(["node", launcher, "--tools", "read"], { env: { ...process.env, PI_BCP_REMOTE_REAL_CLI: cli, PI_BCP_REMOTE_EXTENSION: extension, PI_BCP_REMOTE_CONNECTION: "{}" }, stdout: "pipe", stderr: "pipe" });
      expect(await child.exited).toBe(0);
      expect(JSON.parse(await new Response(child.stdout).text())).toEqual(["--extension", extension, "--tools", "read"]);
      await writeFile(extension, "throw new Error('BROKEN BRIDGE');\n");
      const broken = Bun.spawn(["node", launcher], { env: { ...process.env, PI_BCP_REMOTE_REAL_CLI: cli, PI_BCP_REMOTE_EXTENSION: extension, PI_BCP_REMOTE_CONNECTION: "{}" }, stdout: "pipe", stderr: "pipe" });
      expect(await broken.exited).not.toBe(0);
      expect(await new Response(broken.stdout).text()).toBe("");
      const local = Bun.spawn(["node", launcher, "--tools", "read"], { env: { ...process.env, PI_BCP_REMOTE_REAL_CLI: cli, PI_BCP_REMOTE_CONNECTION: undefined, PI_BCP_REMOTE_OWNER: undefined }, stdout: "pipe", stderr: "pipe" });
      expect(await local.exited).toBe(0);
      expect(JSON.parse(await new Response(local.stdout).text())).toEqual(["--tools", "read"]);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
