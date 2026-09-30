import { access, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";

type PackageEntry = string | { source: string; [key: string]: unknown };
type Settings = Record<string, unknown> & { packages?: PackageEntry[] };
export const repoRoot = resolve(import.meta.dir, "..");

function sourceOf(entry: PackageEntry): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.source === "string") return entry.source;
  throw new Error("Invalid package declaration; refusing to modify settings");
}

// Normalize the source forms used by this profile, including Pi's shorthand Git URLs.
export function packageIdentity(source: string, agentDir: string): string {
  if (source.startsWith("npm:")) {
    const name = source.slice(4);
    const version = name.indexOf("@", name.startsWith("@") ? 1 : 0);
    return `npm:${version < 0 ? name : name.slice(0, version)}`;
  }
  if (/^(git:|https?:\/\/|ssh:\/\/|git@)/.test(source)) {
    let url = source.replace(/^git:(?!\/\/)/, "");
    url = url.replace(/^(?:https?|ssh|git):\/\/(?:[^/@]+@)?/, "").replace(/^git@([^:]+):/, "$1/");
    url = url.split("#", 1)[0]!;
    const ref = url.indexOf("@", url.indexOf("/") + 1);
    if (ref >= 0) url = url.slice(0, ref);
    return `git:${url.replace(/\/$/, "").replace(/\.git$/, "")}`;
  }
  const path = source.startsWith("~/") ? resolve(homedir(), source.slice(2)) : resolve(agentDir, source);
  return `local:${path}`;
}

export function mergeProfile(existing: Settings, defaults: Settings, sources: string[], root: string, agentDir: string): Settings {
  if (existing.packages !== undefined && !Array.isArray(existing.packages)) throw new Error("settings.packages must be an array");
  const old = existing.packages ?? [];
  const identity = (s: string) => packageIdentity(s, agentDir);
  const legacyRoot = resolve(root, "../pi-ssh-remote");
  const localIds = new Set([
    root, resolve(root, "packages/remote-ssh"), resolve(root, "packages/pi"),
    legacyRoot, resolve(legacyRoot, "packages/pi"), resolve(legacyRoot, "packages/remote-ssh"),
  ].map(identity));
  // UI, Advisor and Memory are maintained in-tree; avoid duplicate patches/tools/commands.
  const replacedIds = new Set([
    "git:https://github.com/beautifulrem/pi-sakura-cyberdeck.git", "npm:pi-sakura-cyberdeck",
    resolve(root, "packages/ui"), resolve(legacyRoot, "packages/ui"),
    "npm:@juicesharp/rpiv-advisor", "npm:@fuyao/pi-advisor",
    resolve(root, "packages/advisor"), resolve(legacyRoot, "packages/advisor"),
    "git:https://github.com/tjp72/pi-billion-memory.git", "npm:pi-billion-memory", "npm:@fuyao/pi-memory",
    resolve(root, "packages/memory"), resolve(legacyRoot, "packages/memory"),
  ].map(identity));
  const managedIds = new Set(sources.map(identity));
  const findOld = (source: string) => old.find((e) => identity(sourceOf(e)) === identity(source));
  const pin = (source: string): PackageEntry => {
    const previous = findOld(source);
    // Preserve explicit resource filters on third-party packages.
    return typeof previous === "object" ? { ...previous, source } : source;
  };
  // BCP must load before the remote bridge. Remaining companions retain profile order.
  const packages: PackageEntry[] = [pin(sources[0]!), pin(root), ...sources.slice(1).map(pin)];
  for (const entry of old) {
    const id = identity(sourceOf(entry));
    if (!managedIds.has(id) && !localIds.has(id) && !replacedIds.has(id)) packages.push(entry);
  }
  return { ...defaults, ...existing, packages };
}

export async function setup(agentDir: string, apply: boolean, root = repoRoot): Promise<{ changed: boolean; backup?: string }> {
  const target = resolve(agentDir, "settings.json");
  const defaults = JSON.parse(await readFile(resolve(root, "config/settings.json"), "utf8")) as Settings;
  const manifest = JSON.parse(await readFile(resolve(root, "config/plugins.json"), "utf8")) as { packages: string[] };
  if (!Array.isArray(manifest.packages) || !manifest.packages[0]?.startsWith("npm:billion-context-pi@")) throw new Error("Profile must load pinned BCP first");
  let original: string | undefined;
  try { original = await readFile(target, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const existing = original === undefined ? {} : JSON.parse(original);
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) throw new Error("settings.json must be an object");
  const next = mergeProfile(existing, defaults, manifest.packages, root, agentDir);
  const changed = JSON.stringify(existing) !== JSON.stringify(next);
  console.log(`${apply ? "Apply" : "Preview"}: ${target}`);
  console.log("Managed packages (unrelated packages/preferences preserved; upstream UI / Advisor / Memory replaced by in-repo forks):");
  for (const source of [manifest.packages[0], root, ...manifest.packages.slice(1)]) console.log(`  ${source}`);
  if (!apply || !changed) {
    console.log(changed ? "No files changed. Use --apply after reviewing the profile." : "Profile already configured.");
    return { changed };
  }
  // Only a built entry can be installed. No downloads or model calls are made here.
  await access(resolve(root, "packages/remote-ssh/dist/pi-extension.js"));
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const backup = original === undefined ? undefined : `${target}.bak-fuyao-pi-${randomUUID()}`;
  if (backup) await writeFile(backup, original!, { mode: 0o600, flag: "wx" });
  const temporary = `${target}.tmp-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  await chmod(target, 0o600);
  console.log(backup ? `Backup: ${backup}` : "Created settings.json");
  console.log("Settings configured; dependencies have NOT been downloaded. Run pi update --extensions, then restart Pi with ACP_AUTO_UPDATE=0.");
  return { changed, backup };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let apply = false;
  let agentDir = process.env.PI_CODING_AGENT_DIR || resolve(homedir(), ".pi/agent");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--agent-dir" && args[i + 1] && !args[i + 1]!.startsWith("--")) agentDir = args[++i]!;
    else throw new Error("Usage: bun run setup [--apply] [--agent-dir /path/to/agent]");
  }
  agentDir = agentDir.startsWith("~/") ? resolve(homedir(), agentDir.slice(2)) : isAbsolute(agentDir) ? agentDir : resolve(agentDir);
  await setup(agentDir, apply);
}
