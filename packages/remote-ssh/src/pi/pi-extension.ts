import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installPiRemoteExtension } from "./host-extension.ts";
import { createBcpConnectionInheritance, isInheritedBcpChild } from "./integrations/bcp-inheritance.ts";

// Pi may discover this entry through both package settings and the delegate CLI flag.
const installed = new WeakSet<object>();
export default async function(pi: ExtensionAPI): Promise<void> {
  if (installed.has(pi)) return;
  installed.add(pi);
  const extension = fileURLToPath(import.meta.url);
  try {
    await installPiRemoteExtension(pi, {
    extensionPath: extension,
    inheritedChild: isInheritedBcpChild(),
    inheritance: createBcpConnectionInheritance({
      extension,
      launcher: join(dirname(extension), extension.endsWith(".ts") ? "bcp-launcher.ts" : "bcp-launcher.js"),
      cli: join(getPackageDir(), "dist/bundle/cli.js"),
    }),
    });
  } catch (error) {
    if (isInheritedBcpChild()) {
      console.error("BCP SSH bridge initialization failed; refusing local fallback", error);
      process.exit(1);
    }
    throw error;
  }
}
