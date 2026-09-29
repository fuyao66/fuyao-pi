import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { rtkBundlePlugin } from "./pi-worker-build/rtk.ts";
const root = resolve(import.meta.dir, "..");
const piOutdir = resolve(root, "packages/pi/dist");
await mkdir(piOutdir, { recursive: true });
{
  await rm(resolve(piOutdir, "extension.js"), { force: true });
  await rm(resolve(piOutdir, "pi-extension.js"), { force: true });
  await rm(resolve(piOutdir, "pi-tintin-extension.js"), { force: true });
  await rm(resolve(piOutdir, "pi-rtk-extension.js"), { force: true });
}

{
  const extension = await Bun.build({
    entrypoints: [
      resolve(root, "src/pi/pi-extension.ts"),
      resolve(root, "src/pi/pi-tintin-extension.ts"),
      resolve(root, "src/pi/pi-fff-extension.ts"),
      resolve(root, "src/pi/pi-rtk-extension.ts"),
    ],
    outdir: piOutdir,
    naming: "[name].js",
    plugins: [rtkBundlePlugin],
    define: { "process.env.PI_RTK_BUNDLED": JSON.stringify("true") },
    target: "node",
    format: "esm",
    minify: false,
    external: [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-agent-core",
      "@ff-labs/pi-fff",
    ],
  });
  if (!extension.success)
    throw new AggregateError(extension.logs, "Pi extension build failed");
}
