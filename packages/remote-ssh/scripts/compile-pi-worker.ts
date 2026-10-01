import { chmod, copyFile, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { workerImports } from "./worker-imports.ts";
const target = process.argv[2];
if ((target !== "arm64" && target !== "x64") || process.argv.length > 3 || process.env.PI_WORKER_PLUGINS) throw new Error("Usage: bun scripts/compile-pi-worker.ts <arm64|x64> (fixed Pi core worker; no plugin selection)");
const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");
const outfile = resolve(dist, `worker-linux-${target}`);
await mkdir(dist, { recursive: true });
const require = createRequire(import.meta.url);
const piPackage = require.resolve("@earendil-works/pi-coding-agent/package.json");
const { version } = JSON.parse(await readFile(piPackage, "utf8"));
const result = await Bun.build({
  entrypoints: [resolve(root, "src/pi-worker.ts")],
  plugins: [await workerImports()],
  define: { "process.env.PI_COMPILED": JSON.stringify("true"), "process.env.PI_BUNDLED_HOST_VERSION": JSON.stringify(version) },
  compile: { target: target === "arm64" ? "bun-linux-arm64" : "bun-linux-x64", outfile, autoloadBunfig: false, autoloadDotenv: false, autoloadTsconfig: false, autoloadPackageJson: false },
});
if (!result.success) throw new AggregateError(result.logs, "Pi worker compile failed");
await chmod(outfile, 0o755);
const piRequire = createRequire(await realpath(piPackage));
const wasm = resolve(dirname(piRequire.resolve("@silvia-odwyer/photon-node")), "photon_rs_bg.wasm");
await copyFile(wasm, resolve(dist, `photon-wasm-${target}`));
await copyFile(wasm, resolve(dist, "photon_rs_bg.wasm"));
const hash = new Bun.CryptoHasher("sha256").update(await Bun.file(outfile).arrayBuffer()).digest("hex");
await writeFile(`${outfile}.sha256`, `${hash}\n`);
console.log(`Pi ${version} ${target} worker: ${outfile} (${hash})`);
