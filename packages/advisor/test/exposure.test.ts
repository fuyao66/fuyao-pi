import { expect, test } from "bun:test";
import { createEventBus, createExtensionRuntime } from "@earendil-works/pi-coding-agent";
import { loadExtensionFromFactory } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { registerAdvisorTool } from "../advisor/register.js";
import { VisibleContext } from "../advisor/visible-context.js";

test("Advisor requires a direct transcript call, never Codemode nesting", async () => {
  const extension = await loadExtensionFromFactory((pi) => registerAdvisorTool(pi, new VisibleContext()), process.cwd(), createEventBus(), createExtensionRuntime(), "advisor-exposure-test");
  expect(extension.tools.get("advisor")?.definition.exposure).toBe("model-only");
});
