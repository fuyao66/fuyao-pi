// Persistent BCP dispatcher: queued requests captured their own environment earlier.
import { pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";
const cli = process.env.PI_BCP_REMOTE_REAL_CLI;
if (!cli || !isAbsolute(cli)) throw new Error("Missing absolute BCP Pi CLI entry");
const args = process.argv.slice(2);
if (process.env.PI_BCP_REMOTE_OWNER || process.env.PI_BCP_REMOTE_CONNECTION) {
  const extension = process.env.PI_BCP_REMOTE_EXTENSION;
  if (!extension || !isAbsolute(extension) || !process.env.PI_BCP_REMOTE_CONNECTION) throw new Error("Missing BCP SSH child bootstrap; refusing local fallback");
  // Pi normally logs extension import failures and continues. Preflight here instead:
  // any dependency/import failure terminates the process BEFORE Pi can run local tools.
  const bridge = await import(pathToFileURL(extension).href);
  if (typeof bridge.default !== "function") throw new Error("Invalid BCP SSH bridge entry");
  args.unshift("--extension", extension);
}
process.argv = [process.execPath, cli, ...args];
await import(pathToFileURL(cli).href);
