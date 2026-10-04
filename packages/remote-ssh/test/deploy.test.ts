import { describe, expect, test } from "bun:test";
import { SUPPORTED_PLATFORMS, prepareRemoteWorker } from "../src/deploy.ts";
import { rm, readlink, writeFile, readFile, chmod, readdir } from "node:fs/promises";
import { join } from "node:path";
import { deploymentFixture } from "./fixtures/deployment.ts";

describe("remote bundle deployment", () => {
  test("cached bundle uses two SSH commands, repairs link and handles quoted home", async () => {
    const f = await deploymentFixture();
    try {
      const prepared = await prepareRemoteWorker(f.options, f.bundle);
      expect(prepared.home).toBe(f.home);
      expect(await readlink(join(f.workerDir, "photon.wasm"))).toBe(join(f.companionDir, "photon.wasm"));
      expect(await f.commands()).toEqual(["ssh", "ssh"]);
      await Promise.all([prepareRemoteWorker(f.options, f.bundle), prepareRemoteWorker(f.options, f.bundle)]);
      expect((await f.commands()).length).toBe(6);
    } finally { await f.close(); }
  });
  for (const missing of ["worker", "companion", "both"]) test(`uploads missing ${missing} and returns to hot path`, async () => {
    const f = await deploymentFixture();
    try {
      if (missing !== "companion") await rm(f.workerDir, { recursive: true });
      if (missing !== "worker") await rm(f.companionDir, { recursive: true });
      await prepareRemoteWorker(f.options, f.bundle);
      expect(await readFile(join(f.workerDir, "worker-linux-x64"), "utf8")).toBe("synthetic-worker");
      expect(await readFile(join(f.workerDir, "photon.wasm"), "utf8")).toBe("synthetic-wasm");
      const before = (await f.commands()).length;
      await prepareRemoteWorker(f.options, f.bundle);
      expect((await f.commands()).length - before).toBe(2);
    } finally { await f.close(); }
  });
  test("rejects malformed probe and cache output instead of treating it as a miss", async () => {
    const f = await deploymentFixture();
    try {
      const ssh = join(f.bin, "ssh");
      await writeFile(ssh, "#!/bin/sh\nprintf 'unexpected-banner\\n'\n");
      await expect(prepareRemoteWorker(f.options, f.bundle)).rejects.toThrow("Invalid remote platform probe response");
      await writeFile(ssh, `#!/bin/sh\nfor arg do command=$arg; done\ncase "$command" in uname*) printf 'Linux\\nx86_64\\n/tmp' ;; *) printf 'unexpected-banner' ;; esac\n`);
      await expect(prepareRemoteWorker(f.options, f.bundle)).rejects.toThrow("Unexpected remote worker check response");
    } finally { await f.close(); }
  });
  test("slow cache cleanup cannot fail an otherwise ready bundle", async () => {
    const f = await deploymentFixture();
    try {
      await writeFile(join(f.bin, "ls"), "#!/bin/sh\nsleep 15\n");
      await chmod(join(f.bin, "ls"), 0o700);
      const start = performance.now();
      expect((await prepareRemoteWorker(f.options, f.bundle)).home).toBe(f.home);
      expect(performance.now() - start).toBeLessThan(6000);
      expect(await f.commands()).toEqual(["ssh", "ssh"]);
    } finally { await f.close(); }
  }, 10000);
  test("failed hash validation never activates an upload", async () => {
    const f = await deploymentFixture();
    try {
      await rm(f.workerDir, { recursive: true });
      await writeFile(join(f.artifacts, "worker-linux-x64"), "corrupt-upload");
      await expect(prepareRemoteWorker(f.options, f.bundle)).rejects.toThrow("Worker activation failed");
      await expect(readFile(join(f.workerDir, "worker-linux-x64"))).rejects.toThrow();
      expect((await readdir(f.workerDir)).filter((name) => name.includes(".upload-"))).toEqual([]);
    } finally { await f.close(); }
  });
});

test("deployment abort promptly terminates the current SSH probe", async () => {
  const f = await deploymentFixture("30");
  const controller = new AbortController();
  try {
    const pending = prepareRemoteWorker({ ...f.options, signal: controller.signal }, f.bundle);
    const failure = pending.catch((error: unknown) => error);
    setTimeout(() => controller.abort(new Error("cancel deployment")), 25);
    expect(String(await failure)).toContain("cancel deployment");
    const commands = await f.commands();
    expect(commands).toEqual(["ssh"]);
  } finally { await f.close(); }
}, 5_000);

test("failed companion hash validation removes temporary uploads", async () => {
  const f = await deploymentFixture();
  try {
    await rm(f.companionDir, { recursive: true });
    await writeFile(join(f.artifacts, "photon-x64"), "corrupt-companion");
    await expect(prepareRemoteWorker(f.options, f.bundle)).rejects.toThrow("activation failed");
    expect((await readdir(f.companionDir)).filter((name) => name.includes(".upload-"))).toEqual([]);
  } finally { await f.close(); }
});

describe("remote worker platform mapping", () => {
  test("maps Linux/aarch64 to arm64 worker", () => {
    expect(SUPPORTED_PLATFORMS["Linux/aarch64"]).toBe("arm64");
  });

  test("maps Linux/x86_64 to x64 worker", () => {
    expect(SUPPORTED_PLATFORMS["Linux/x86_64"]).toBe("x64");
  });

  test("rejects unsupported platforms", () => {
    expect(SUPPORTED_PLATFORMS["Darwin/arm64"]).toBeUndefined();
    expect(SUPPORTED_PLATFORMS["Linux/riscv64"]).toBeUndefined();
  });
});
