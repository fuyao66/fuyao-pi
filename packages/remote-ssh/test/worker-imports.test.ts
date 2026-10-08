import { describe, expect, test } from "bun:test";
import { requireWorkerVersion, requireWorkerExport, workerImports } from "../scripts/worker-imports.ts";

describe("fixed worker build adapter", () => {
  test("rejects unreviewed versions and absent internal exports", () => {
    expect(() => requireWorkerVersion("1.1.0")).not.toThrow();
    expect(() => requireWorkerVersion("0.87.1")).toThrow("Review internal exports");
    expect(() => requireWorkerVersion("0.88.0")).toThrow("Review internal exports");
    expect(() => requireWorkerExport({}, "createReadTool")).toThrow("missing function");
    expect(() => requireWorkerExport({ createReadTool: 1 }, "createReadTool")).toThrow();
    expect(() => requireWorkerExport({ createReadTool() {} }, "createReadTool")).not.toThrow();
  });
  test("verifies installed internal modules before registering a build plugin", async () => {
    const plugin = await workerImports();
    expect(plugin.name).toBe("fixed-pi-worker-imports");
    expect(typeof plugin.setup).toBe("function");
  });
});
