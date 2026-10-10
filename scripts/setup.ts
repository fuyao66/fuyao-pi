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

// Advisor source is retained, but disabled during the Billion Context migration.
export const localPlugins = ["remote-ssh", "bili-memory", "statusline", "gpt-fast-mode"] as const;
const resourceTypes = ["extensions", "themes", "skills", "prompts"] as const;

// Pi patterns match package-relative paths, absolute paths and (for globs) basenames.
// Make root-relative patterns absolute before moving them to a child package.
export function rebaseFilters(patterns: unknown, root: string): string[] {
  if (!Array.isArray(patterns) || patterns.some(p => typeof p !== "string")) {
    throw new Error("Invalid resource filters; refusing to migrate settings");
  }
  return patterns.map((pattern: string) => {
    const prefix = /^[!+-]/.test(pattern) ? pattern[0]! : "";
    const value = pattern.slice(prefix.length);
    const target = value.replace(/^\.\//, "");
    if (/[{}()]/.test(target)) throw new Error("Complex root resource patterns require manual child-package migration");
    if (!target.includes("/") && prefix !== "+" && prefix !== "-") return pattern;
    return prefix + (isAbsolute(target) ? target : `${root}/${target}`);
  });
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
  // Retire the old UI and suspend Advisor; setup must not silently re-enable it.
  const replacedIds = new Set([
    "git:https://github.com/beautifulrem/pi-sakura-cyberdeck.git", "npm:pi-sakura-cyberdeck",
    resolve(root, "packages/ui"), resolve(legacyRoot, "packages/ui"),
    "npm:@juicesharp/rpiv-advisor", "npm:@fuyao/pi-advisor",
    resolve(root, "packages/advisor"), resolve(legacyRoot, "packages/advisor"),
    "git:https://github.com/tjp72/pi-billion-memory.git", "npm:pi-billion-memory", "npm:@fuyao/pi-memory",
    resolve(root, "packages/memory"), resolve(legacyRoot, "packages/memory"),
    "npm:@fuyao/bili-memory", resolve(root, "packages/bili-memory"), resolve(legacyRoot, "packages/bili-memory"),
    "npm:@narumitw/pi-statusline", "npm:@fuyao/pi-statusline",
    resolve(root, "packages/statusline"), resolve(legacyRoot, "packages/statusline"),
    "npm:@tunnckocore/pi-gpt-fast-mode", "npm:@fuyao/pi-gpt-fast-mode",
    "git:github.com/tunnckoCore/pi-gpt-fast-mode",
    resolve(root, "packages/gpt-fast-mode"), resolve(legacyRoot, "packages/gpt-fast-mode"),
  ].map(identity));
  const managedIds = new Set(sources.map(identity));
  // These Goal packages register the same commands/tools; never retain both.
  if (managedIds.has("npm:@narumitw/pi-goal")) replacedIds.add("npm:@schovest/pi-goal");
  if (managedIds.has("npm:billion-context")) {
    replacedIds.add("npm:billion-context-pi");
    replacedIds.add("git:github.com/ranxianglei/billion-context-pi");
  }
  const findOld = (source: string) => old.find((e) => identity(sourceOf(e)) === identity(source));
  const pin = (source: string): PackageEntry => {
    const previous = findOld(source) ?? (identity(source) === "npm:@narumitw/pi-goal"
      ? old.find(entry => identity(sourceOf(entry)) === "npm:@schovest/pi-goal") : undefined);
    if (identity(source) === 'npm:billion-context') {
      const legacy = old.filter(entry => ['npm:billion-context-pi', 'git:github.com/ranxianglei/billion-context-pi'].includes(identity(sourceOf(entry))));
      // Filters target different files in the new package. Never silently widen a
      // disabled or selectively enabled compressor; require an explicit decision.
      if (!previous && legacy.some(entry => typeof entry === 'object' &&
        (entry.autoload === false || resourceTypes.some(type => entry[type] !== undefined)))) {
        throw new Error('Legacy BCP has explicit resource filters; choose Billion Context enablement before applying setup');
      }
    }
    // Preserve explicit resource filters on third-party packages.
    return typeof previous === "object" ? { ...previous, source } : source;
  };
  const relocatePath = (pattern: string): string => pattern.replace(`${legacyRoot}/`, `${root}/`)
    .replace(`${root}/packages/memory/`, `${root}/packages/bili-memory/`);
  const relocate = (entry: PackageEntry, source: string): PackageEntry => {
    if (typeof entry === "string") return source;
    const result: Exclude<PackageEntry, string> = { ...entry, source };
    for (const type of resourceTypes) {
      if (entry[type] === undefined) continue;
      if (!Array.isArray(entry[type]) || entry[type].some(p => typeof p !== "string")) throw new Error("Invalid resource filters");
      result[type] = entry[type].map(relocatePath);
    }
    return result;
  };
  const previousRoot = findOld(root) ?? findOld(legacyRoot);
  const children = localPlugins.map((name): PackageEntry => {
    const source = resolve(root, "packages", name);
    const previous = findOld(source) ?? findOld(resolve(legacyRoot, "packages", name)) ??
      (name === "bili-memory" ? findOld(resolve(root, "packages/memory")) ?? findOld(resolve(legacyRoot, "packages/memory")) : undefined);
    if (previous) return relocate(previous, source);
    if (typeof previousRoot !== "object") return source;
    const entry: PackageEntry = { source };
    if (previousRoot.autoload !== undefined) entry.autoload = previousRoot.autoload;
    const previousBase = identity(previousRoot.source) === identity(legacyRoot) ? legacyRoot : root;
    for (const type of resourceTypes) {
      if (previousRoot[type] !== undefined) {
        entry[type] = rebaseFilters(previousRoot[type], previousBase).map(relocatePath);
      }
    }
    return Object.keys(entry).length > 1 ? entry : source;
  });
  // Billion Context must load before the remote bridge. Reserved root resources are not loaded.
  const packages: PackageEntry[] = [pin(sources[0]!), ...children, ...sources.slice(1).map(pin)];
  for (const entry of old) {
    const id = identity(sourceOf(entry));
    if (!managedIds.has(id) && !localIds.has(id) && !replacedIds.has(id)) packages.push(entry);
  }
  const next: Settings = { ...defaults, ...existing, packages };
  // The removed theme cannot be resolved after its package is retired.
  if (next.theme === "sakura-macaron") next.theme = "fuyao-soft";
  // Also retire explicit file entries from the known local UI directories.
  for (const type of ["extensions", "themes"] as const) {
    const entries = next[type];
    if (!Array.isArray(entries)) continue;
    next[type] = entries.filter(entry => {
      if (typeof entry !== "string") return true;
      const path = packageIdentity(entry, agentDir);
      return ![root, legacyRoot].some(base => path.startsWith(`local:${resolve(base, "packages/ui")}/`));
    });
  }
  const themePath = resolve(root, "themes/fuyao-soft.json");
  const themes = next.themes;
  if (themes !== undefined && (!Array.isArray(themes) || themes.some(entry => typeof entry !== "string"))) {
    throw new Error("settings.themes must be an array of paths");
  }
  const themeIds = new Set([themePath, resolve(legacyRoot, "themes/fuyao-soft.json")].map(identity));
  next.themes = [...((themes as string[] | undefined) ?? []).filter(entry =>
    !themeIds.has(identity(entry))), themePath];
  return next;
}

type BiliSettings = Record<string, unknown>;

export function billionConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.BILI_CONFIG_FILE
    ? resolve(env.BILI_CONFIG_FILE)
    : resolve(env.XDG_CONFIG_HOME || resolve(home, '.config'), 'billion-context/billion-context.json');
}

/** Ordinary upgrades are reviewed; critical-defect repairs remain enabled by user choice. */
export function mergeBillionConfig(existing: BiliSettings): BiliSettings {
  return { ...existing, autoUpdate: false, advisoryCheck: true };
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

export async function setup(
  agentDir: string,
  apply: boolean,
  root = repoRoot,
  biliPath = billionConfigPath(),
): Promise<{ changed: boolean; backup?: string; biliBackup?: string }> {
  const target = resolve(agentDir, "settings.json");
  const defaults = JSON.parse(await readFile(resolve(root, "config/settings.json"), "utf8")) as Settings;
  const manifest = JSON.parse(await readFile(resolve(root, "config/plugins.json"), "utf8")) as { packages: string[] };
  if (!Array.isArray(manifest.packages) || !manifest.packages[0]?.startsWith("npm:billion-context@")) {
    throw new Error("Profile must load pinned Billion Context first");
  }
  const original = await readOptional(target);
  const existing = original === undefined ? {} : JSON.parse(original);
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) throw new Error("settings.json must be an object");
  const next = mergeProfile(existing, defaults, manifest.packages, root, agentDir);
  const settingsChanged = JSON.stringify(existing) !== JSON.stringify(next);

  const originalBili = await readOptional(biliPath);
  const existingBili = originalBili === undefined ? {} : JSON.parse(originalBili) as BiliSettings;
  if (!existingBili || typeof existingBili !== "object" || Array.isArray(existingBili)) throw new Error("billion-context.json must be an object");
  const nextBili = mergeBillionConfig(existingBili);
  const biliChanged = JSON.stringify(existingBili) !== JSON.stringify(nextBili);
  const changed = settingsChanged || biliChanged;

  console.log(`${apply ? "Apply" : "Preview"}: ${target}`);
  console.log("Managed packages (unrelated packages/preferences preserved; retired UI removed; Advisor disabled; Memory uses an in-repo fork):");
  for (const entry of next.packages ?? []) console.log(`  ${sourceOf(entry)}${typeof entry === "object" ? " (filtered)" : ""}`);
  console.log(`Billion Context: ordinary auto-update off; critical-defect auto-repair on (${biliPath}). Repairs may change the pinned runtime version.`);
  if (process.env.ACP_AUTO_UPDATE !== undefined || process.env.BILI_ADVISORY_CHECK !== undefined) {
    console.log('Warning: ACP_AUTO_UPDATE / BILI_ADVISORY_CHECK environment overrides take precedence over this file.');
  }
  if (!apply || !changed) {
    console.log(changed ? "No files changed. Use --apply after reviewing the profile." : "Profile already configured.");
    return { changed };
  }
  // Only a built entry can be installed. No downloads or model calls are made here.
  await access(resolve(root, "packages/remote-ssh/dist/pi-extension.js"));
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(resolve(biliPath, ".."), { recursive: true, mode: 0o700 });
  const backup = settingsChanged && original !== undefined ? `${target}.bak-fuyao-pi-${randomUUID()}` : undefined;
  const biliBackup = biliChanged && originalBili !== undefined ? `${biliPath}.bak-fuyao-pi-${randomUUID()}` : undefined;
  if (backup) await writeFile(backup, original!, { mode: 0o600, flag: "wx" });
  if (biliBackup) await writeFile(biliBackup, originalBili!, { mode: 0o600, flag: "wx" });
  if (settingsChanged) {
    const temporary = `${target}.tmp-${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
    await chmod(target, 0o600);
  }
  if (biliChanged) {
    const temporary = `${biliPath}.tmp-${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(nextBili, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, biliPath);
    await chmod(biliPath, 0o600);
  }
  console.log(backup ? `Backup: ${backup}` : settingsChanged ? "Created settings.json" : "Settings already configured");
  console.log(biliBackup ? `Billion Context backup: ${biliBackup}` : biliChanged ? `Created ${biliPath}` : "Billion Context update policy already configured");
  console.log("Settings configured; dependencies have NOT been downloaded. Run pi install <exact-source> for changed manifest entries (pinned npm sources are skipped by pi update --extensions), then restart Pi.");
  return { changed, backup, biliBackup };
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
