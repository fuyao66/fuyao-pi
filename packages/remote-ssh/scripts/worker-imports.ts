import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFile, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { BunPlugin } from "bun";

// Build-only adapter. Runtime/source extensions keep using Pi's public entrypoints.
// Internal paths are deliberately gated to the version verified by worker smoke tests.
export const SUPPORTED_WORKER_PI_VERSION = "1.1.0";
export function requireWorkerVersion(version: string): void {
  if (version !== SUPPORTED_WORKER_PI_VERSION) throw new Error(`Worker import adapter requires Pi ${SUPPORTED_WORKER_PI_VERSION}; got ${version}. Review internal exports before upgrading.`);
}
export function requireWorkerExport(exports: Record<string, unknown>, name: string): void {
  if (typeof exports[name] !== "function") throw new Error(`Worker import adapter missing function: ${name}`);
}
export async function workerImports(): Promise<BunPlugin> {
  const require = createRequire(import.meta.url);
  const modules: Record<string, [string, string][]> = {};
  for (const pkg of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"]) {
    const manifest = require.resolve(`${pkg}/package.json`);
    requireWorkerVersion(JSON.parse(await readFile(manifest, "utf8")).version);
    const root = dirname(manifest);
    modules[pkg] = pkg.endsWith("pi-ai")
      ? [[join(root, "dist/utils/validation.js"), "validateToolArguments"]]
      : [...["Read", "Write", "Edit", "Bash", "Grep", "Find", "Ls"].map(name =>
        [join(root, `dist/core/tools/${name.toLowerCase()}.js`), `create${name}Tool`] as [string, string]),
        [join(root, "dist/config.js"), "getPackageDir"]];
    for (const [file, name] of modules[pkg]) {
      await access(file);
      requireWorkerExport(await import(pathToFileURL(file).href), name);
    }
  }
  return {
    name: "fixed-pi-worker-imports",
    setup(build) {
      build.onResolve({ filter: /^@earendil-works\/pi-(coding-agent|ai)$/ }, ({ path }) => ({ path, namespace: "fixed-worker" }));
      build.onLoad({ filter: /.*/, namespace: "fixed-worker" }, ({ path }) => ({
        loader: "js", contents: modules[path]!.map(([file, name]) => `export { ${name} } from ${JSON.stringify(file)};`).join("\n"),
      }));
    },
  };
}
