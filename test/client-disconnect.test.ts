import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { RemoteRuntimeClient } from "../src/client.ts";
import type { RemoteRuntimeHandshake } from "../src/runtime-contract.ts";
const handshake: RemoteRuntimeHandshake = { host: "pi", hostVersion: "test", runtimeVersion: "fixture", requestedTools: ["read"], validateReady(ready) { expect(ready.host).toBe("pi"); } };

describe("remote runtime disconnects", () => {
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
});
