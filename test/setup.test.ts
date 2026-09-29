import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeProfile, packageIdentity, setup } from "../scripts/setup.ts";

const sources = ["npm:billion-context-pi@0.1.82", "npm:@juicesharp/rpiv-todo@2.11.0"];
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
    expect(result.packages).toEqual([sources[0], root, { source: sources[1], extensions: [] }, "npm:unrelated"]);
    expect(mergeProfile(result, {}, sources, root, agentDir)).toEqual(result);
    expect(existing.packages[1]).toBe("/workspace/pi-ssh-remote/packages/pi");
  });

  test("replaces upstream UI sources with the in-repo UI, without duplicate loading", () => {
    const packages = [...upstreamUi, "npm:pi-sakura-cyberdeck@1.1.5", `${root}/packages/ui`, "/workspace/pi-ssh-remote/packages/ui"];
    const result = mergeProfile({ packages }, {}, sources, root, agentDir);
    expect(result.packages).toEqual([sources[0], root, sources[1]]);
  });

  test("preserves filters on the root package when setup is rerun", () => {
    const filtered = { source: root, extensions: ["!packages/ui/extensions/matrix/index.ts"], themes: [] };
    const result = mergeProfile({ packages: [filtered] }, {}, sources, root, agentDir);
    expect(result.packages).toEqual([sources[0], filtered, sources[1]]);
    expect(mergeProfile(result, {}, sources, root, agentDir)).toEqual(result);
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
      await setup(agent, false, repo);
      expect((await readdir(tmp)).sort()).toEqual(["repo"]);
      await mkdir(agent);
      const original = '{"defaultModel":"private-model","customSecret":"do-not-export"}\n';
      await writeFile(join(agent, "settings.json"), original);
      await writeFile(join(agent, "auth.json"), "untouched");
      const result = await setup(agent, true, repo);
      expect(await readFile(result.backup!, "utf8")).toBe(original);
      expect((await stat(result.backup!)).mode & 0o777).toBe(0o600);
      expect((await stat(join(agent, "settings.json"))).mode & 0o777).toBe(0o600);
      const written = JSON.parse(await readFile(join(agent, "settings.json"), "utf8"));
      expect(written.customSecret).toBe("do-not-export");
      expect(await readFile(join(agent, "auth.json"), "utf8")).toBe("untouched");
      expect((await setup(agent, true, repo)).changed).toBe(false);
      expect((await readdir(agent)).length).toBe(3);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  });
});
