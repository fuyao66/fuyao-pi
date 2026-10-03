import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { localPlugins, mergeProfile, packageIdentity, rebaseFilters, setup } from "../scripts/setup.ts";

const sources = ["npm:billion-context-pi@0.1.83", "npm:@juicesharp/rpiv-todo@2.11.0"];
const upstreamUi = [
  "git:github.com/beautifulrem/pi-sakura-cyberdeck",
  "git:https://github.com/beautifulrem/pi-sakura-cyberdeck.git@abc",
  "git:ssh://git@github.com/beautifulrem/pi-sakura-cyberdeck.git",
  "ssh://git@github.com/beautifulrem/pi-sakura-cyberdeck.git",
  "git:https://github.com/beautifulrem/pi-sakura-cyberdeck.git#main",
  "git@github.com:beautifulrem/pi-sakura-cyberdeck.git",
];
const root = "/workspace/fuyao-pi";
const agentDir = "/home/test/.pi/agent";
const locals = localPlugins.map(name => `${root}/packages/${name}`);

describe("personal Pi profile", () => {
  test("normalizes pinned npm and shorthand Git sources", () => {
    expect(packageIdentity("npm:@juicesharp/rpiv-todo@2.11.0", agentDir)).toBe("npm:@juicesharp/rpiv-todo");
    for (const source of upstreamUi) expect(packageIdentity(source, agentDir)).toBe("git:github.com/beautifulrem/pi-sakura-cyberdeck");
    expect(packageIdentity("./plugin", agentDir)).toBe(`local:${agentDir}/plugin`);
  });

  test("preserves private settings, unknown packages and third-party filters; replaces old bridge once", () => {
    const existing = {
      defaultProvider: "private-provider", retry: { maxRetries: 3 }, extensions: ["./custom.ts"],
      packages: ["npm:billion-context-pi", "/workspace/pi-ssh-remote/packages/pi", "npm:unrelated", { source: "npm:@juicesharp/rpiv-todo", extensions: [] }, "git:github.com/beautifulrem/pi-sakura-cyberdeck"],
    };
    const result = mergeProfile(existing, { retry: { maxRetries: 20 }, theme: "sakura-macaron" }, sources, root, agentDir);
    expect(result.defaultProvider).toBe("private-provider");
    expect(result.retry).toEqual({ maxRetries: 3 });
    expect(result.extensions).toEqual(["./custom.ts"]);
    expect(result.packages).toEqual([sources[0], ...locals, { source: sources[1], extensions: [] }, "npm:unrelated"]);
    expect(mergeProfile(result, {}, sources, root, agentDir)).toEqual(result);
    expect(existing.packages[1]).toBe("/workspace/pi-ssh-remote/packages/pi");
  });

  test("replaces upstream UI sources with the in-repo UI, without duplicate loading", () => {
    const packages = [...upstreamUi, "npm:pi-sakura-cyberdeck@1.1.5", `${root}/packages/ui`, "/workspace/pi-ssh-remote/packages/ui"];
    const result = mergeProfile({ packages }, {}, sources, root, agentDir);
    expect(result.packages).toEqual([sources[0], ...locals, sources[1]]);
  });

  test("replaces upstream and standalone Advisor declarations without duplicates", () => {
    const packages = ["npm:@juicesharp/rpiv-advisor@2.11.0", { source: "npm:@fuyao/pi-advisor", extensions: [] }, `${root}/packages/advisor`, "/workspace/pi-ssh-remote/packages/advisor"];
    expect(mergeProfile({ packages }, {}, sources, root, agentDir).packages).toEqual([sources[0], ...locals, sources[1]]);
  });

  test("replaces Memory git aliases and standalone fork without duplicate tools", () => {
    const packages = ["git:https://github.com/tjp72/pi-billion-memory.git@52e5a01", "git:github.com/tjp72/pi-billion-memory", "git@github.com:tjp72/pi-billion-memory.git", "npm:@fuyao/pi-memory", `${root}/packages/memory`, "npm:unrelated"];
    const result = mergeProfile({ packages }, {}, sources, root, agentDir);
    expect(result.packages).toEqual([sources[0], ...locals, sources[1], "npm:unrelated"]);
    expect(mergeProfile(result, {}, sources, root, agentDir)).toEqual(result);
  });

  test("migrates root filters to children and is idempotent", () => {
    const filtered = { source: root, extensions: ["!packages/ui/extensions/matrix/index.ts", "!packages/ui/extensions/dual-quota/index.ts"], themes: [] };
    const result = mergeProfile({ packages: [filtered] }, {}, sources, root, agentDir);
    for (const name of localPlugins) {
      expect(result.packages).toContainEqual({ source: `${root}/packages/${name}`,
        extensions: [`!${root}/packages/ui/extensions/matrix/index.ts`, `!${root}/packages/ui/extensions/dual-quota/index.ts`], themes: [] });
    }
    expect(result.packages).toHaveLength(sources.length + localPlugins.length);
    expect(mergeProfile(result, {}, sources, root, agentDir)).toEqual(result);
  });

  test("rebases include, exclude and exact filters without widening includes", () => {
    expect(rebaseFilters(["packages/advisor/**", "!./packages/ui/**", "+packages/ui/extensions/header/index.ts", "-packages/ui/extensions/matrix/index.ts", "*.ts"], root)).toEqual([
      `${root}/packages/advisor/**`, `!${root}/packages/ui/**`, `+${root}/packages/ui/extensions/header/index.ts`, `-${root}/packages/ui/extensions/matrix/index.ts`, "*.ts",
    ]);
    const result = mergeProfile({ packages: [{ source: root, extensions: [] }] }, {}, sources, root, agentDir);
    for (const name of localPlugins) expect(result.packages).toContainEqual({ source: `${root}/packages/${name}`, extensions: [] });
    expect(() => rebaseFilters("bad", root)).toThrow();
  });

  test("removes the empty root entry without changing existing children or unrelated packages", () => {
    const children = locals.map(source => ({ source, extensions: ["!extensions/matrix/index.ts"] }));
    const result = mergeProfile({ packages: [sources[0], ...children, { source: root }, sources[1], "npm:unrelated"] }, {}, sources, root, agentDir);
    expect(result.packages).toEqual([sources[0], ...children, sources[1], "npm:unrelated"]);
    expect(mergeProfile(result, {}, sources, root, agentDir)).toEqual(result);
  });

  test("keeps child resource filters on subsequent setup", () => {
    const child = { source: `${root}/packages/ui`, extensions: ["!extensions/matrix/index.ts"] };
    const result = mergeProfile({ packages: [child] }, {}, sources, root, agentDir);
    expect(result.packages).toContainEqual(child);
    expect(mergeProfile(result, {}, sources, root, agentDir)).toEqual(result);
  });

  test("relocates legacy child filters and removes the legacy root entry", () => {
    const result = mergeProfile({ packages: [
      { source: "/workspace/pi-ssh-remote", themes: ["-/workspace/pi-ssh-remote/themes/a.json"] },
      { source: "/workspace/pi-ssh-remote/packages/ui", extensions: ["-/workspace/pi-ssh-remote/packages/ui/extensions/matrix/index.ts"] },
    ] }, {}, sources, root, agentDir);
    expect(result.packages!.map(e => typeof e === "string" ? e : e.source)).not.toContain(root);
    expect(result.packages).toContainEqual({ source: `${root}/packages/ui`, extensions: [`-${root}/packages/ui/extensions/matrix/index.ts`] });
    expect(() => rebaseFilters(["!{index.ts,packages/ui/**}"], root)).toThrow(/manual/);
  });

  test("Pi resource resolution preserves enabled paths across split, including delta mode", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "fuyao-split-resolve-"));
    try {
      const entries = ["packages/remote-ssh/index.ts", "packages/advisor/index.ts", "packages/memory/index.ts", "packages/ui/extensions/matrix/index.ts", "packages/ui/extensions/header/index.ts"];
      for (const entry of entries) {
        await mkdir(join(tmp, entry, ".."), { recursive: true });
        await writeFile(join(tmp, entry), "export default () => {};");
      }
      for (const name of localPlugins) await writeFile(join(tmp, "packages", name, "package.json"), JSON.stringify({ pi: {
        extensions: entries.filter(p => p.startsWith(`packages/${name}/`)).map(p => './' + p.slice(`packages/${name}/`.length)),
      } }));
      const enabled = async (packages: any[]) => {
        const manager = new DefaultPackageManager({ cwd: tmp, agentDir: join(tmp, "agent"), settingsManager: SettingsManager.inMemory({ packages }) });
        const resolved = await manager.resolve(() => Promise.resolve("error"));
        return resolved.extensions.filter(x => x.enabled).map(x => x.path).sort();
      };
      for (const filters of [undefined, [], ["!packages/ui/extensions/matrix/index.ts"], ["packages/advisor/**"], ["+packages/advisor/index.ts"], ["!*.ts", "+packages/advisor/index.ts"], ["-packages/ui/extensions/matrix/index.ts"]]) {
        for (const autoload of [undefined, false]) {
          const entry = { source: tmp, ...(filters === undefined ? {} : { extensions: filters }), ...(autoload === undefined ? {} : { autoload }) };
          await writeFile(join(tmp, "package.json"), JSON.stringify({ pi: { extensions: entries } }));
          const before = await enabled([entry]);
          const split = mergeProfile({ packages: [entry] }, {}, sources, tmp, join(tmp, "agent"));
          await writeFile(join(tmp, "package.json"), JSON.stringify({ pi: { extensions: [] } }));
          const after = await enabled(split.packages!.filter(p => (typeof p === 'string' ? p : p.source).startsWith(tmp)));
          expect(after).toEqual(before);
        }
      }
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });

  test("rejects malformed package settings", () => {
    expect(() => mergeProfile({ packages: "bad" } as any, {}, sources, root, agentDir)).toThrow();
    expect(() => mergeProfile({ packages: [{}] } as any, {}, sources, root, agentDir)).toThrow();
  });

  test("preview is read-only; apply backs up, writes privately and is idempotent", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "fuyao-pi-setup-"));
    try {
      const repo = join(tmp, "repo"), agent = join(tmp, "agent");
      await mkdir(join(repo, "config"), { recursive: true });
      await mkdir(join(repo, "packages/remote-ssh/dist"), { recursive: true });
      await writeFile(join(repo, "packages/remote-ssh/dist/pi-extension.js"), "");
      await writeFile(join(repo, "config/settings.json"), '{"theme":"sakura-macaron"}');
      await writeFile(join(repo, "config/plugins.json"), JSON.stringify({ packages: sources }));
      const acp = join(tmp, "home", ".pi", "acp.json");
      await setup(agent, false, repo, acp);
      expect((await readdir(tmp)).sort()).toEqual(["repo"]);
      await mkdir(agent);
      await mkdir(join(tmp, "home", ".pi"), { recursive: true });
      await writeFile(acp, '{"debug":true,"autoUpdate":true}\n');
      const original = '{"defaultModel":"private-model","customSecret":"do-not-export"}\n';
      await writeFile(join(agent, "settings.json"), original);
      await writeFile(join(agent, "auth.json"), "untouched");
      const result = await setup(agent, true, repo, acp);
      expect(await readFile(result.backup!, "utf8")).toBe(original);
      expect(await readFile(result.acpBackup!, "utf8")).toBe('{"debug":true,"autoUpdate":true}\n');
      expect((await stat(result.backup!)).mode & 0o777).toBe(0o600);
      expect((await stat(result.acpBackup!)).mode & 0o777).toBe(0o600);
      expect((await stat(join(agent, "settings.json"))).mode & 0o777).toBe(0o600);
      const written = JSON.parse(await readFile(join(agent, "settings.json"), "utf8"));
      expect(written.customSecret).toBe("do-not-export");
      expect(JSON.parse(await readFile(acp, "utf8"))).toEqual({ debug: true, autoUpdate: false });
      expect(await readFile(join(agent, "auth.json"), "utf8")).toBe("untouched");
      expect((await setup(agent, true, repo, acp)).changed).toBe(false);
      expect((await readdir(agent)).length).toBe(3);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
});
