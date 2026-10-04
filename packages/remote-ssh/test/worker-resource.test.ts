import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { resolvePiRuntimeAssembly } from "../src/pi/assembly.ts";
import { createReadTool, createWriteTool, createEditTool, createBashTool, createGrepTool, createFindTool, createLsTool } from "@earendil-works/pi-coding-agent";
import { PROTOCOL_VERSION, type Message } from "../src/protocol.ts";
import { terminateProcess } from "../src/process-lifecycle.ts";

async function fixture() {
  const proc = spawn("bun", ["packages/remote-ssh/src/pi-worker.ts"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  const messages: Message[] = [];
  proc.stdin.on("error", () => {});
  let stderr = "";
  proc.stderr.on("data", (chunk) => { stderr += chunk; });
  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line) => { messages.push(JSON.parse(line)); });
  const send = (message: unknown) => proc.stdin.write(JSON.stringify(message) + "\n");
  const wait = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() > deadline || proc.exitCode !== null) throw new Error(`worker fixture failed: ${stderr} ${JSON.stringify(messages)}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const assembly = await resolvePiRuntimeAssembly({ tools: [createReadTool("/tmp"), createWriteTool("/tmp"), createEditTool("/tmp"), createBashTool("/tmp"), createGrepTool("/tmp"), createFindTool("/tmp"), createLsTool("/tmp")].map((tool) => ({ ...tool,
    sourceInfo: { source: "builtin" as const, path: `<builtin:${tool.name}>`, scope: "temporary" as const, origin: "top-level" as const },
  })) });
  send({ type: "initialize", protocolVersion: PROTOCOL_VERSION, host: "pi", hostVersion: "test", runtimeVersion: "1.0.0", tools: assembly.tools.map((tool) => tool.name), cwd: "/tmp", assembly: assembly.request });
  try { await wait(() => messages.some((m) => m.type === "ready")); }
  catch (error) { rl.close(); await terminateProcess(proc); throw error; }
  return { proc, messages, wait, send, async close() { rl.close(); await terminateProcess(proc); } };
}

const execute = (id: string) => ({ type: "execute", id, tool: "bash", toolCallId: id, args: { command: "sleep 30" } });

test("worker rejects duplicate active ids at the transport boundary", async () => {
  const f = await fixture();
  const dir = await mkdtemp(join(tmpdir(), "worker-shutdown-"));
  const path = join(dir, "must-not-exist");
  try {
    // One write forces all three requests into the transport's buffered frames.
    f.proc.stdin.write([execute("duplicate"), execute("duplicate"),
      { type: "execute", id: "late-write", tool: "write", toolCallId: "late-write", args: { path, content: "unsafe" } },
    ].map((request) => JSON.stringify(request) + "\n").join(""));
    await f.wait(() => f.messages.some((m) => m.type === "error" && m.error.name === "DuplicateRequest"));
    await f.wait(() => f.proc.exitCode !== null);
    await expect(access(path)).rejects.toThrow();
  } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
}, 10_000);

test("worker bounds active executions and cancels accepted requests", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 33; i++) f.send(execute(String(i)));
    await f.wait(() => f.messages.some((m) => m.type === "error" && m.id === "32" && m.error.name === "Busy"));
    for (let i = 0; i < 32; i++) f.send({ type: "cancel", id: String(i) });
    await f.wait(() => f.messages.filter((m) => m.type === "error" && m.id && m.id !== "32").length === 32);
    f.send({ type: "shutdown" });
    await f.wait(() => f.proc.exitCode !== null);
  } finally { await f.close(); }
}, 10_000);

test("worker handles broken stdout without an unhandled EPIPE", async () => {
  const f = await fixture();
  try {
    const exited = once(f.proc, "close");
    f.proc.stdout.destroy();
    f.send({ type: "execute", id: "output", tool: "bash", toolCallId: "output", args: { command: "printf response" } });
    const [code] = await exited;
    expect(code).toBe(0);
  } finally { await f.close(); }
}, 10_000);
