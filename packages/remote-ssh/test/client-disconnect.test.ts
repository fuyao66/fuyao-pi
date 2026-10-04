import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { RemoteRuntimeClient } from "../src/client.ts";
import type { RemoteRuntimeHandshake } from "../src/runtime-contract.ts";
const handshake: RemoteRuntimeHandshake = { host: "pi", hostVersion: "test", runtimeVersion: "fixture", requestedTools: ["read"], validateReady(ready) { expect(ready.host).toBe("pi"); } };

describe("remote runtime disconnects", () => {
  test("missing executable rejects ready instead of crashing the host", async () => {
    const client = new RemoteRuntimeClient({ command: ["/nonexistent/pi-remote-worker"] });
    await expect(client.initialize("/unused", handshake)).rejects.toThrow();
    expect(client.isClosed).toBe(true);
    await client.close();
  });

  test("closed worker stdin cannot crash the host on a later write", async () => {
    const client = new RemoteRuntimeClient({ command: ["node", "-e", `
      const fs = require('node:fs');
      fs.closeSync(0);
      console.log(JSON.stringify({ type: 'ready', protocolVersion: 1, host: 'pi', tools: [] }));
      setInterval(() => {}, 1000);
    `] });
    try {
      await client.initialize("/unused", handshake);
      await expect(client.execute("read", "broken-pipe", { payload: "x".repeat(1024 * 1024) })).rejects.toThrow();
      expect(client.isClosed).toBe(true);
    } finally { await client.kill(); }
  });

  test("stdout EOF rejects pending work even when worker stays alive", async () => {
    const client = new RemoteRuntimeClient({ command: ["node", "-e", `
      console.log(JSON.stringify({ type: 'ready', protocolVersion: 1, host: 'pi', tools: [] }));
      process.stdin.once('data', () => { setTimeout(() => process.stdout.end(), 30); });
      setInterval(() => {}, 1000);
    `] });
    try {
      await client.initialize("/unused", handshake);
      await expect(client.execute("read", "eof", {})).rejects.toThrow("stdout closed");
      expect(client.isClosed).toBe(true);
    } finally { await client.kill(); }
  });

  test("unresponsive cancellation closes all pending calls", async () => {
    const client = new RemoteRuntimeClient({ cancelTimeoutMs: 20, command: ["bun", join(import.meta.dir, "fixtures/hanging-worker.ts")] });
    try {
      await client.initialize("/unused", handshake);
      const controller = new AbortController();
      const first = client.execute("read", "cancel", {}, controller.signal);
      const second = client.execute("read", "sibling", {});
      const outcomes = Promise.allSettled([first, second]);
      controller.abort();
      for (const outcome of await outcomes) {
        expect(outcome.status).toBe("rejected");
        if (outcome.status === "rejected") expect(String(outcome.reason)).toContain("cancellation timed out");
      }
      expect(client.isClosed).toBe(true);
    } finally { await client.kill(); }
  });

  test("bounds pending requests without disconnecting accepted calls", async () => {
    const client = new RemoteRuntimeClient({ command: ["bun", join(import.meta.dir, "fixtures/hanging-worker.ts")] });
    await client.initialize("/unused", handshake);
    try {
      const calls = Array.from({ length: 32 }, (_, i) => client.execute("read", String(i), {}));
      const outcomes = Promise.allSettled(calls);
      await expect(client.execute("read", "excess", {})).rejects.toThrow("request limit");
      expect(client.isClosed).toBe(false);
      await client.kill();
      expect((await outcomes).every((result) => result.status === "rejected")).toBe(true);
    } finally { await client.kill(); }
  });

  test("force cleanup reaps a worker ignoring SIGTERM", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-term-ignore-"));
    const pidFile = join(dir, "pid");
    const client = new RemoteRuntimeClient({ command: ["bun", "-e", `
      process.on('SIGTERM', () => {});
      await Bun.write(${JSON.stringify(pidFile)}, String(process.pid));
      console.log(JSON.stringify({ type: 'ready', protocolVersion: 1, host: 'pi', tools: [] }));
      process.stdin.resume(); setInterval(() => {}, 1000);
    `] });
    let pid: number | undefined;
    try {
      await client.initialize("/unused", handshake);
      pid = Number(await readFile(pidFile, "utf8"));
      await client.kill();
      expect(() => process.kill(pid!, 0)).toThrow();
      await client.close();
    } finally {
      await client.kill();
      if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("initialization error terminates the worker even after logical closure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "worker-init-error-"));
    const pidFile = join(dir, "pid");
    const client = new RemoteRuntimeClient({ command: ["bun", "-e", `
      await Bun.write(${JSON.stringify(pidFile)}, String(process.pid));
      console.log(JSON.stringify({type:'error',error:{name:'Mismatch',message:'rejected'}}));
      setInterval(() => {}, 1000);
    `] });
    let pid: number | undefined;
    try {
      await expect(client.initialize("/unused", handshake)).rejects.toThrow("Mismatch");
      pid = Number(await readFile(pidFile, "utf8"));
      client.kill(); client.kill();
      let alive = true;
      for (let i = 0; i < 100; i++) {
        try { process.kill(pid, 0); } catch { alive = false; break; }
        await Bun.sleep(10);
      }
      expect(alive).toBe(false);
    } finally {
      client.kill();
      if (pid) { try { process.kill(pid, "SIGKILL"); } catch {} }
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("keeps the client connected after a command exits with 141", async () => {
    const client = new RemoteRuntimeClient({
      command: ["bun", "-e", `
        const { createInterface } = require("node:readline");
        const { encodeMessage, PROTOCOL_VERSION } = await import(${JSON.stringify(join(import.meta.dir, "../src/protocol.ts"))});
        let calls = 0;
        for await (const line of createInterface({ input: process.stdin })) {
          const request = JSON.parse(line);
          if (request.type === "initialize") process.stdout.write(encodeMessage({
            type: "ready", protocolVersion: PROTOCOL_VERSION, host: "pi",
            hostVersion: "test", runtimeVersion: "fixture", tools: [{ name: "read", description: "fixture" }]
          }));
          if (request.type === "execute") {
            calls++;
            if (calls === 1) process.stdout.write(encodeMessage({ type: "error", id: request.id, error: { name: "Error", message: "Command exited with code 141" } }));
            else process.stdout.write(encodeMessage({ type: "result", id: request.id, result: { content: [{ type: "text", text: "still connected" }], details: {} } }));
          }
        }
      `],
    });
    try {
      await client.initialize("/remote/workspace", handshake);
      await expect(client.execute("read", "sigpipe", { path: "ignored" })).rejects.toThrow("Command exited with code 141");
      await expect(client.execute("read", "after-sigpipe", { path: "ignored" })).resolves.toMatchObject({ content: [{ text: "still connected" }] });
      expect(client.isClosed).toBe(false);
    } finally { await client.close().catch(() => client.kill()); }
  });

  test("rejects a pending tool call without local fallback", async () => {
    const client = new RemoteRuntimeClient({
      command: ["bun", join(import.meta.dir, "fixtures/hanging-worker.ts")],
    });
    await client.initialize("/remote/workspace", handshake);
    const pending = client.execute("read", "pending-read", {
      path: "file.txt",
    });
    client.kill();
    await expect(pending).rejects.toThrow(/Remote runtime (?:killed|exited)/);
    await expect(
      client.execute("read", "later-read", { path: "file.txt" }),
    ).rejects.toThrow("disconnected");
  });

  test("kills a worker that ignores graceful shutdown past the deadline", async () => {
    const client = new RemoteRuntimeClient({
      command: ["bun", join(import.meta.dir, "fixtures/stubborn-worker.ts")],
    });
    await client.initialize("/remote/workspace", handshake);

    await expect(client.close(20)).rejects.toThrow(
      "Remote runtime shutdown timed out after 20ms",
    );
    expect(client.isClosed).toBe(true);
  });

  test("makes repeated graceful closes single-flight after stdin has ended", async () => {
    const client = new RemoteRuntimeClient({
      command: ["bun", "-e", `
        const { createInterface } = require("node:readline");
        const { encodeMessage, PROTOCOL_VERSION } = await import(${JSON.stringify(join(import.meta.dir, "../src/protocol.ts"))});
        for await (const line of createInterface({ input: process.stdin })) {
          const request = JSON.parse(line);
          if (request.type === "initialize") process.stdout.write(encodeMessage({
            type: "ready", protocolVersion: PROTOCOL_VERSION, host: "pi",
            hostVersion: "test", runtimeVersion: "fixture", tools: []
          }));
          if (request.type === "shutdown") process.exit(0);
        }
      `],
    });
    await client.initialize("/remote/workspace", handshake);
    await Promise.all([client.close(), client.close(), client.close()]);
    expect(client.isClosed).toBe(true);
  });
});
