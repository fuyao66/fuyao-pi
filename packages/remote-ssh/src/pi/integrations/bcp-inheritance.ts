import type { PiRemoteConnectionInheritance, PiRemoteConnectionInheritanceSpec } from "./connection-inheritance.ts";
import { restorePiRuntimeAssembly } from "../assembly.ts";

export const BCP_REMOTE_ENV = "PI_BCP_REMOTE_CONNECTION";
const OWNER = "PI_BCP_REMOTE_OWNER";
const PID = "PI_BCP_REMOTE_OWNER_PID";
const CLI = "PI_BCP_REMOTE_REAL_CLI";
const EXTENSION = "PI_BCP_REMOTE_EXTENSION";
const PREVIOUS_CLI = "PI_BCP_REMOTE_PREVIOUS_CLI";

export function isInheritedBcpChild(): boolean {
  return (process.env[OWNER] !== undefined || process.env[BCP_REMOTE_ENV] !== undefined) && process.env[PID] !== String(process.pid);
}

/** BCP 0.1.82 copies process.env and honors PI_CLI_PATH. One root owner per process. */
export function createBcpConnectionInheritance(paths: { launcher: string; extension: string; cli: string }): PiRemoteConnectionInheritance {
  return {
    hasSpec: () => process.env[BCP_REMOTE_ENV] !== undefined,
    hasRootOwner: () => process.env[OWNER] !== undefined,
    read() {
      const raw = process.env[BCP_REMOTE_ENV];
      if (raw === undefined) return undefined;
      const spec = JSON.parse(raw) as PiRemoteConnectionInheritanceSpec;
      if (!spec || typeof spec.ownerToken !== "string" || !spec.ownerToken || spec.ownerToken !== process.env[OWNER] || !spec.assembly || !Array.isArray(spec.tools) || !spec.connectOptions || typeof spec.connectOptions.target !== "string" || typeof spec.connectOptions.displayTarget !== "string" || typeof spec.workerPath !== "string" || !spec.workerPath.startsWith("/") || typeof spec.cwd !== "string" || !spec.cwd.startsWith("/")) throw new Error("Invalid inherited BCP SSH connection");
      restorePiRuntimeAssembly(spec.assembly, spec.tools);
      return spec;
    },
    claim(owner) {
      if (process.env[OWNER] && process.env[OWNER] !== owner) throw new Error("Another Pi session owns BCP remote inheritance");
      if (!process.env[OWNER]) {
        const previousCli = process.env[PREVIOUS_CLI] === undefined ? process.env.PI_CLI_PATH : JSON.parse(process.env[PREVIOUS_CLI]) as string | null;
        process.env[PREVIOUS_CLI] = JSON.stringify(previousCli ?? null);
        process.env[CLI] = previousCli || paths.cli;
        process.env[EXTENSION] = paths.extension;
        process.env[OWNER] = owner;
        process.env[PID] = String(process.pid);
        process.env.PI_CLI_PATH = paths.launcher;
      }
    },
    publish(spec) {
      this.claim(spec.ownerToken);
      process.env[BCP_REMOTE_ENV] = JSON.stringify(spec);
    },
    clear(owner) {
      if (!owner || process.env[OWNER] !== owner || process.env[PID] !== String(process.pid)) return;
      // BCP resolves PI_CLI_PATH only when a queued launch gets a slot, but captured
      // its child env at submission. Keep the dispatcher for this process lifetime.
      // New local delegates pass through; queued remote delegates retain their bridge.
      for (const key of [OWNER, PID, BCP_REMOTE_ENV]) delete process.env[key];
    },
  };
}
