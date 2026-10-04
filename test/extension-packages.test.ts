import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { localPlugins } from "../scripts/setup.ts";

// The workspace root owns build/worker dependencies; extension packages use the host.
const hostPackages = ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox", "@sinclair/typebox"];

for (const name of localPlugins) {
  test(`${name} uses host-provided modules as wildcard peers`, async () => {
    const manifest = JSON.parse(await readFile(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8"));
    for (const host of hostPackages) {
      expect(manifest.dependencies?.[host]).toBeUndefined();
      if (manifest.peerDependencies?.[host] !== undefined) {
        expect(manifest.peerDependencies[host]).toBe("*");
      }
    }
  });
}
