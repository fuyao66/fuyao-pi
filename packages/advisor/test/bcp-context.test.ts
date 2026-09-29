import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcpExtension } from "billion-context-pi";
import { createEventBus, createExtensionRuntime, ExtensionRunner, SessionManager, buildSessionContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadExtensionFromFactory } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { VisibleContext } from "../advisor/visible-context.js";
import { executeAdvisor } from "../advisor/execute.js";
import { setAdvisorModel } from "../advisor/state.js";
import type { AssistantMessage } from "@earendil-works/pi-ai";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const reply = (text: string): AssistantMessage => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "test", model: "test", timestamp: Date.now(), stopReason: "stop", usage });

test("real BCP compression hides journal originals from the actual Advisor side-call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fuyao-advisor-bcp-"));
  const saved = process.env.PI_CODING_AGENT_DIR;
  const savedLog = process.env.ACP_LOG_FILE;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.ACP_LOG_FILE = join(dir, "acp.log");
  try {
    const sm = SessionManager.create(dir, join(dir, "sessions"));
    sm.appendMessage({ role: "user", content: "Protected initial objective", timestamp: 1 });
    const raw = "RAW_SHOULD_NEVER_REAPPEAR_" + "synthetic result ".repeat(3000);
    sm.appendMessage(reply(raw));
    sm.appendMessage(reply("Consumed evidence ".repeat(1000)));
    for (let i = 0; i < 12; i++) {
      sm.appendMessage({ role: "user", content: `Current task ${i} ` + "recent ".repeat(1000), timestamp: i + 2 });
      sm.appendMessage(reply("Keep recent ".repeat(1000)));
    }
    const runtime = createExtensionRuntime();
    runtime.getThinkingLevel = () => "off";
    runtime.getAllTools = () => [];
    runtime.getActiveTools = () => ["compress", "advisor"];
    const bus = createEventBus();
    const bcp = await loadExtensionFromFactory(createAcpExtension({ autoUpdate: false, delegate: { enabled: false }, modelContextLimit: 1_000_000, preserveRecentMessages: 2 }), dir, bus, runtime, "test-bcp");
    const visible = new VisibleContext();
    let advisorApi!: ExtensionAPI;
    const advisor = await loadExtensionFromFactory((pi) => { advisorApi = pi; visible.register(pi); }, dir, bus, runtime, "test-advisor");
    let sent = "";
    const registry = { getApiKeyAndHeaders: async () => ({ ok: true }), runtime: { completeSimple: async (_model: unknown, context: unknown) => { sent = JSON.stringify(context); return reply("Review complete"); } } };
    // Intentionally load Advisor first: context_with_system must still run AFTER
    // BCP's context handler regardless of extension order.
    const runner = new ExtensionRunner([advisor, bcp], runtime, dir, sm, registry as never);
    const errors: string[] = [];
    runner.onError((error) => errors.push(error.error));
    await runner.emitContext(buildSessionContext(sm.getEntries(), sm.getLeafId()).messages);
    const params = { content: [{ startId: "m00002", endId: "m00003", summary: "BCP_SUMMARY_ONLY: old synthetic evidence consumed; no unresolved questions or outstanding work in the folded range." }] };
    sm.appendMessage({ ...reply("Compress old evidence"), stopReason: "toolUse", content: [{ type: "toolCall", name: "compress", id: "compress-1", arguments: params }] });
    const tool = bcp.tools.get("compress")!.definition;
    const result = await tool.execute("compress-1", params, undefined, undefined, runner.createContext());
    expect(JSON.stringify(result)).not.toContain("Errors:");
    expect(JSON.stringify(result)).toContain("b1=");
    sm.appendMessage({ role: "toolResult", toolName: "compress", toolCallId: "compress-1", content: result.content, isError: false, timestamp: Date.now() });
    await runner.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });
    const main = await runner.emitContext(buildSessionContext(sm.getEntries(), sm.getLeafId()).messages);
    expect(errors).toEqual([]);
    expect(JSON.stringify(sm.getEntries())).toContain("RAW_SHOULD_NEVER_REAPPEAR_");
    expect(JSON.stringify(main)).not.toContain("RAW_SHOULD_NEVER_REAPPEAR_");
    expect(JSON.stringify(main)).toContain("BCP_SUMMARY_ONLY");
    const caller = { ...reply("Review now"), stopReason: "toolUse" as const, content: [{ type: "toolCall" as const, name: "advisor", id: "advisor-1", arguments: {} }] };
    await runner.emitMessageEnd({ type: "message_end", message: caller });
    setAdvisorModel({ provider: "test", id: "advisor" } as never);
    await executeAdvisor(runner.createContext(), advisorApi, undefined, undefined, visible, "advisor-1");
    expect(sent).toContain("BCP_SUMMARY_ONLY");
    expect(sent).not.toContain("RAW_SHOULD_NEVER_REAPPEAR_");
    expect(JSON.parse(sent).tools).toEqual([]);
  } finally {
    setAdvisorModel(undefined);
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = saved;
    if (savedLog === undefined) delete process.env.ACP_LOG_FILE; else process.env.ACP_LOG_FILE = savedLog;
    await rm(dir, { recursive: true, force: true });
  }
});
