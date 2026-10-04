import { copyFile, mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { createReadTool, createWriteTool, createEditTool, createBashTool, createFindTool, createGrepTool, createLsTool, DefaultResourceLoader, SettingsManager, SessionManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import { RemoteRuntimeClient } from "../src/client.ts";
import { resolvePiRuntimeAssembly } from "../src/pi/assembly.ts";

// No model or SSH server needed: exercise the actual compiled worker, then a restricted
// Pi child loading the built extension over an ssh process shim (not a transport mock).
const root = resolve(import.meta.dir, "..");
const worker = process.env.PI_SMOKE_WORKER ?? join(root, `dist/worker-linux-${process.arch}`);
const cwd = await mkdtemp(join(tmpdir(), "pi-fixed-smoke-"));
const saved = { ...process.env };
let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
const isolatedWorker = join(cwd, "worker");
await copyFile(worker, isolatedWorker);
await chmod(isolatedWorker, 0o755);
await copyFile(join(root, "dist/photon_rs_bg.wasm"), join(cwd, "photon_rs_bg.wasm"));
const client = new RemoteRuntimeClient({ command: [isolatedWorker], cwd });
try {
  const tools = [createReadTool(cwd), createWriteTool(cwd), createEditTool(cwd), createBashTool(cwd), createFindTool(cwd), createGrepTool(cwd), createLsTool(cwd)];
  const assembly = await resolvePiRuntimeAssembly({ tools: tools.map((tool) => ({ ...tool, sourceInfo: { source: "builtin", path: `<builtin:${tool.name}>`, scope: "temporary", origin: "top-level" } })) });
  await client.initialize(cwd, assembly.handshake);
  await client.execute("write", "write", { path: "probe.txt", content: "remote-original\n" });
  await client.execute("edit", "edit", { path: "probe.txt", edits: [{ oldText: "original", newText: "modified" }] });
  for (const [tool, args, text] of [
    ["read", { path: "probe.txt" }, "remote-modified"],
    ["bash", { command: "pwd" }, cwd],
    ["ls", { path: "." }, "probe.txt"],
    ["grep", { pattern: "remote-modified", path: "." }, "probe.txt"],
    ["find", { pattern: "*.txt", path: "." }, "probe.txt"],
  ] as const) assert.ok(JSON.stringify(await client.execute(tool, tool, args)).includes(text), tool);
  await writeFile(join(cwd, "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/AP8AAP8FAAH/+lyI0QAAAABJRU5ErkJggg==", "base64"));
  const image = await client.execute("read", "image", { path: "pixel.png" });
  assert.ok(JSON.stringify(image).includes('"type":"image"'), JSON.stringify(image));
  // 3000x1 synthetic PNG exceeds Pi's default inline width and forces Photon resizing.
  await writeFile(join(cwd, "wide.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAC7gAAAABCAYAAABO1+M+AAAAJUlEQVR4nO3DQQ0AAAwDofNvupOxDyS0mqqqqqqqqqqqqqqqfj+cQlnqxmLa0gAAAABJRU5ErkJggg==", "base64"));
  const resized = JSON.stringify(await client.execute("read", "resize", { path: "wide.png" }));
  assert.ok(resized.includes('"type":"image"') && resized.includes("original 3000x1, displayed at"), resized);
  await assert.rejects(client.execute("read", "invalid", { path: 42 }));
  const controller = new AbortController();
  const slow = client.execute("bash", "cancel", { command: "sleep 10" }, controller.signal);
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(slow);
  assert.ok(JSON.stringify(await client.execute("read", "after-cancel", { path: "probe.txt" })).includes("remote-modified"));
  await client.close();
  const mismatch = new RemoteRuntimeClient({ command: [isolatedWorker], cwd });
  try {
    const wrongAssembly = await resolvePiRuntimeAssembly({ tools: tools.map(tool => ({ ...tool, sourceInfo: { source: "builtin", path: `<builtin:${tool.name}>`, scope: "temporary", origin: "top-level" } })), hostVersion: "0.0.0" });
    await assert.rejects(mismatch.initialize(cwd, wrongAssembly.handshake));
  } finally { mismatch.kill(); }
  const bin = join(cwd, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "ssh"), `#!/bin/sh\nexec '${worker.replaceAll("'", "'\"'\"'")}'\n`);
  await chmod(join(bin, "ssh"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.PI_BCP_REMOTE_OWNER = "smoke-owner";
  process.env.PI_BCP_REMOTE_OWNER_PID = "-1";
  process.env.PI_BCP_REMOTE_CONNECTION = JSON.stringify({ ownerToken: "smoke-owner", assembly: assembly.request, tools: assembly.tools, connectOptions: { target: "smoke-host", displayTarget: "smoke-host" }, workerPath: worker, cwd });
  const local = join(cwd, "local");
  await mkdir(local);
  await writeFile(join(local, "probe.txt"), "WRONG_LOCAL_FILE");
  const settingsManager = SettingsManager.inMemory({});
  const resourceLoader = new DefaultResourceLoader({ cwd: local, agentDir: local, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: [join(root, "dist/pi-extension.js")] });
  await resourceLoader.reload();
  ({ session } = await createAgentSession({ cwd: local, agentDir: local, settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(local), tools: ["read", "bash"] }));
  await session.bindExtensions({ mode: "print" });
  assert.deepEqual(session.getActiveToolNames().sort(), ["bash", "read"]);
  const gate = await session.extensionRunner.emitToolCall({ type: "tool_call", toolCallId: "child-read", toolName: "read", input: { path: "probe.txt" } });
  assert.ok(!gate?.block, JSON.stringify(gate));
  const result = await session.getToolDefinition("read")!.execute("child-read", { path: "probe.txt" }, undefined, undefined, session.extensionRunner.createToolContext("child-read", undefined));
  assert.ok(JSON.stringify(result).includes("remote-modified"), JSON.stringify(result));
  assert.ok(!JSON.stringify(result).includes("WRONG_LOCAL_FILE"));
  console.log("PASS: compiled core tools + built extension inherited restricted Pi child (SSH process shim)");
} finally {
  if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
  client.kill();
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
  await rm(cwd, { recursive: true, force: true });
}
