import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadTool, createWriteTool, createEditTool, createBashTool, createGrepTool, createFindTool, createLsTool } from "@earendil-works/pi-coding-agent";
import { createPiWorkerRuntime } from "../src/pi/worker-runtime.ts";
import { resolvePiRuntimeAssembly, validatePiReadyMessage, restorePiRuntimeAssembly } from "../src/pi/assembly.ts";

function coreTools() {
  return [createReadTool("/tmp"), createWriteTool("/tmp"), createEditTool("/tmp"), createBashTool("/tmp"), createGrepTool("/tmp"), createFindTool("/tmp"), createLsTool("/tmp")]
    .map((tool) => ({ ...tool, sourceInfo: { source: "builtin" as const, path: "<builtin>", scope: "user" as const, origin: "top-level" as const } }));
}
export async function coreAssembly() {
  return resolvePiRuntimeAssembly({ tools: coreTools() });
}

describe("fixed Pi core worker", () => {
  test("runs native tools with remote cwd and an exact handshake", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pi-core-"));
    const assembly = await coreAssembly();
    const runtime = await createPiWorkerRuntime(cwd, assembly.request);
    const execute = (tool: string, args: Record<string, unknown>, signal?: AbortSignal) => runtime.execute({ type: "execute", id: tool, toolCallId: tool, tool, args }, signal);
    try {
      validatePiReadyMessage(assembly, runtime.manifest);
      await execute("write", { path: "base.txt", content: "before\n" });
      await execute("edit", { path: "base.txt", oldText: "before", newText: "after" });
      expect(await readFile(join(cwd, "base.txt"), "utf8")).toBe("after\n");
      expect(JSON.stringify(await execute("read", { path: "base.txt" }))).toContain("after");
      expect(JSON.stringify(await execute("bash", { command: "pwd" }))).toContain(cwd);
      const failed = await execute("bash", { command: "set -o pipefail; yes | head -n 1 >/dev/null" }) as { isError: boolean; structuredContent: { exit_code: number }; content: unknown };
      expect(failed.isError).toBe(true);
      expect(failed.structuredContent.exit_code).toBe(141);
      expect(JSON.stringify(failed.content)).toContain("Command exited with code 141");
      expect(JSON.stringify(await execute("bash", { command: "pwd" }))).toContain(cwd);
      expect(JSON.stringify(await execute("ls", { path: "." }))).toContain("base.txt");
      await expect(execute("acp_delegate", {})).rejects.toThrow("not admitted");
      const controller = new AbortController();
      controller.abort();
      await expect(execute("bash", { command: "sleep 30" }, controller.signal)).rejects.toThrow();
    } finally { await runtime.close(); await rm(cwd, { recursive: true, force: true }); }
    await expect(execute("read", { path: "base.txt" })).rejects.toThrow("closed");
  });
  test("keeps RPIV UI/session tools local without changing the worker contract", async () => {
    const baseline = await coreAssembly();
    const core = coreTools();
    const local = ["todo", "ask_user_question"].map((name) => ({
      name, description: "Local session/UI tool", parameters: createReadTool("/tmp").parameters,
      sourceInfo: { source: "extension" as const, path: `/rpiv/${name}.ts`, scope: "user" as const, origin: "top-level" as const },
    }));
    const assembly = await resolvePiRuntimeAssembly({ tools: [...core, ...local] });
    expect(assembly.request).toEqual(baseline.request);
    const runtime = await createPiWorkerRuntime("/tmp", assembly.request);
    try {
      for (const tool of local) {
        expect(assembly.knownWorkspaceTools.has(tool.name)).toBe(false);
        await expect(runtime.execute({ type: "execute", id: tool.name, toolCallId: tool.name, tool: tool.name, args: {} })).rejects.toThrow("not admitted");
      }
    } finally { await runtime.close(); }
  });
  test("rejects changed identity, extensions and invalid cwd", async () => {
    const assembly = await coreAssembly();
    expect(() => restorePiRuntimeAssembly({ ...assembly.request, id: "tampered" }, assembly.tools)).toThrow("ID");
    await expect(resolvePiRuntimeAssembly({ tools: [{ ...createReadTool("/tmp"), sourceInfo: { source: "extension", path: "/other.ts", scope: "user", origin: "top-level" } }] })).rejects.toThrow("unsupported extension");
    await expect(createPiWorkerRuntime("relative", assembly.request)).rejects.toThrow("absolute directory");
    const extra = { ...assembly.request, components: [...assembly.request.components, { id: "plugin", kind: "plugin" as const, version: "1", contractVersion: "1" }] };
    expect(() => restorePiRuntimeAssembly(extra, assembly.tools)).toThrow("fixed Pi core");
  });
});
