import type { ChildProcess } from "node:child_process";

/** Reap the local transport even when it ignores SIGTERM. Never reject from cleanup. */
export function terminateProcess(proc: ChildProcess, graceMs = 250): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      proc.stdin?.destroy();
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      resolve();
      return;
    }
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(killTimer);
      clearTimeout(reapTimer);
      proc.removeListener("close", done);
      resolve();
    };
    proc.once("close", done);
    // Logical transport closure and OS process exit are different boundaries.
    if (proc.exitCode === null && proc.signalCode === null) {
      try { proc.kill("SIGTERM"); } catch { /* already exited */ }
      killTimer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          try { proc.kill("SIGKILL"); } catch { /* already exited */ }
        }
      }, graceMs);
    }
    // Descendants may retain inherited pipes after the direct child exits.
    // Bound pipe cleanup too; this does not claim to kill remote grandchildren.
    reapTimer = setTimeout(() => {
      proc.stdin?.destroy();
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      done();
    }, graceMs + 2_000);
  });
}

export const MAX_ACTIVE_REMOTE_EXECUTIONS = 32;

/** Reject excess queued output rather than buffering unbounded protocol traffic. */
export const MAX_QUEUED_PROTOCOL_BYTES = 32 * 1024 * 1024;
