import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

/** Only BCP's own read artifacts are local; never exempt /tmp or ~/.cache wholesale. */
export class BcpLocalArtifacts {
  private readonly exported = new Set<string>();
  private readonly roots = [join(tmpdir(), "acp-delegate"), join(homedir(), ".cache/pi/acp-decompress")];
  isLocalRead(args: unknown): boolean {
    if (!args || typeof args !== "object" || !("path" in args) || typeof args.path !== "string") return false;
    const path = args.path.startsWith("~/") ? join(homedir(), args.path.slice(2)) : args.path;
    if (!isAbsolute(path)) return false;
    const normalized = resolve(path);
    return this.exported.has(normalized) || this.roots.some((root) => normalized.startsWith(`${root}${sep}`));
  }
  observe(name: string, content: readonly { type: string; text?: string }[], isError: boolean): void {
    if (name !== "decompress" || isError) return;
    // BCP 0.1.82 reports an export in its first line. Do not scan restored payload text.
    const first = content.find((item) => item.type === "text")?.text?.split("\n", 1)[0];
    const match = first?.match(/^(?:Block|Message) .+ written to (\/.*)\.$/);
    if (match) this.exported.add(resolve(match[1]));
  }
}

/** BCP spawns Node locally: a remote cwd must never become child_process.spawn.cwd. */
export function guardDelegateCwd(input: Record<string, unknown>, localCwd: string, remoteCwd: string): { block: true; reason: string } | undefined {
  const requested = input.cwd;
  if (requested !== undefined && requested !== "" && requested !== localCwd && requested !== remoteCwd) {
    return { block: true, reason: "Remote delegates inherit the current SSH cwd. Omit cwd (other directories are not supported); use absolute remote paths in the task." };
  }
  input.cwd = localCwd;
}
