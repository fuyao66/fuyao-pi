import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const outdir = resolve(root, "dist");
await mkdir(outdir, { recursive: true });
for (const entry of ["extension.js", "pi-tintin-extension.js", "pi-fff-extension.js", "pi-rtk-extension.js"]) await rm(resolve(outdir, entry), { force: true });
const result = await Bun.build({
  entrypoints: [resolve(root, "src/pi/pi-extension.ts"), resolve(root, "src/pi/bcp-launcher.ts")],
  outdir, naming: "[name].js", target: "node", format: "esm",
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-agent-core"],
});
if (!result.success) throw new AggregateError(result.logs, "Pi extension build failed");
