import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { omitImages, VisibleContext } from "../advisor/visible-context.js";
import { addUsage, executeAdvisor } from "../advisor/execute.js";
import { setAdvisorModel } from "../advisor/state.js";
import { getInventoryMessage } from "../advisor/inventory.js";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
export function assistant(calls = ["advisor"]): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text: "Review the latest plan" }, ...calls.map((name, i) => ({ type: "toolCall" as const, name, id: `call-${i}`, arguments: {} }))], api: "openai-completions", provider: "test", model: "test", timestamp: 2, stopReason: "toolUse", usage };
}
function harness() {
  const handlers = new Map<string, Function>();
  const pi = { on(name: string, handler: Function) { handlers.set(name, handler); }, getAllTools: () => [], getActiveTools: () => [] } as unknown as ExtensionAPI;
  const ctx = { sessionManager: { getSessionId: () => "session-1", getEntries() { throw new Error("RAW JOURNAL ACCESS"); } } } as unknown as ExtensionContext;
  const view = new VisibleContext();
  view.register(pi);
  const emit = (name: string, event: object = {}) => handlers.get(name)?.(event, ctx);
  const capture = () => {
    const messages: Message[] = [{ role: "system", content: "executor system", timestamp: 0 }, { role: "user", content: "BCP summary", timestamp: 1 }];
    emit("context_with_system", { messages });
    emit("message_end", { message: assistant() });
    return messages;
  };
  return { ctx, pi, view, emit, capture };
}

describe("advisor transformed context", () => {
  test("uses a deep snapshot, strips executor system and unfinished calls; never reads journal", () => {
    const h = harness();
    const original = h.capture();
    original[1]!.content = "mutated raw content";
    const messages = h.view.messages(h.ctx, "call-0");
    expect(JSON.stringify(messages)).toContain("BCP summary");
    expect(JSON.stringify(messages)).not.toContain("executor system");
    expect(JSON.stringify(messages)).not.toContain("toolCall");
    expect(JSON.stringify(messages)).toContain("Review the latest plan");
    expect(messages.at(-1)?.role).toBe("user");
    messages[0]!.content = "mutated caller copy";
    expect(JSON.stringify(h.view.messages(h.ctx, "call-0"))).toContain("BCP summary");
  });
  test("never forwards historical images, even to a vision reviewer", () => {
    const image = { type: "image" as const, mimeType: "image/png", data: "PRIVATE_BASE64" };
    const messages: Message[] = [
      { role: "user", content: [image], timestamp: 1 },
      { role: "toolResult", content: [image], toolName: "read", toolCallId: "read-1", isError: false, timestamp: 2 },
    ];
    expect(JSON.stringify(omitImages(messages))).not.toContain("PRIVATE_BASE64");
    expect(JSON.stringify(omitImages(messages))).toContain("Image omitted");
    expect(JSON.stringify(messages)).toContain("PRIVATE_BASE64");
  });
  test("combines retry costs without double-counting reasoning", () => {
    const single = { ...usage, input: 10, output: 5, reasoning: 3, totalTokens: 15, cost: { ...usage.cost, input: 1, output: 2, total: 3 } };
    expect(addUsage(single, single)).toEqual({ ...single, input: 20, output: 10, reasoning: 6, totalTokens: 30, cost: { ...usage.cost, input: 2, output: 4, total: 6 } });
  });
  test("fails closed before a context request and for wrong call/session", () => {
    const h = harness();
    expect(() => h.view.messages(h.ctx, "call-0")).toThrow("Raw session replay is disabled");
    h.capture();
    expect(() => h.view.messages(h.ctx, "wrong")).toThrow();
    const other = { ...h.ctx, sessionManager: { getSessionId: () => "other" } } as ExtensionContext;
    expect(() => h.view.messages(other, "call-0")).toThrow();
  });
  test("rejects mixed/parallel batches independent of execution order", () => {
    for (const names of [["advisor", "compress"], ["compress", "advisor"], ["advisor", "read"], ["advisor", "advisor"]]) {
      const h = harness(); h.capture();
      h.emit("message_end", { message: assistant(names) });
      expect(() => h.view.messages(h.ctx, "call-0")).toThrow();
    }
  });
  test("invalidates across compression, turns, branches, compaction and session changes", () => {
    for (const event of ["turn_start", "before_agent_start", "agent_end", "session_start", "session_shutdown", "session_before_switch", "session_before_fork", "session_before_tree", "session_compact", "tool_execution_start"]) {
      const h = harness(); h.capture();
      h.emit(event, { toolName: "compress" });
      expect(() => h.view.messages(h.ctx, "call-0")).toThrow();
      h.capture();
      expect(h.view.messages(h.ctx, "call-0").length).toBeGreaterThan(0);
    }
  });
  test("inventory refreshes when SSH changes descriptions or schemas without renaming tools", () => {
    const tools = (description: string, parameters = {}) => [{ name: "read", exposure: "direct" as const, description, parameters, sourceInfo: { source: "builtin", path: "<read>", scope: "temporary" as const, origin: "top-level" as const } }];
    expect(JSON.stringify(getInventoryMessage(tools("local")))).toContain("local");
    const remote = getInventoryMessage(tools("remote"));
    expect(JSON.stringify(remote)).toContain("remote");
    expect(getInventoryMessage(tools("remote"))).toBe(remote);
    expect(getInventoryMessage(tools("remote", { type: "object" }))).not.toBe(remote);
  });
  test("execute forwards only captured context to tool-free auth-aware side call", async () => {
    const h = harness(); h.capture();
    let sent: { messages: Message[]; tools: unknown[] } | undefined;
    let attempts = 0;
    const billed = { ...usage, input: 10, totalTokens: 10 };
    const model = { provider: "test", id: "advisor" };
    setAdvisorModel(model as never);
    const ctx = { ...h.ctx, modelRegistry: {
      getApiKeyAndHeaders: async () => ({ ok: true }),
      runtime: { completeSimple: async (_model: unknown, context: typeof sent) => {
        sent = context;
        return { ...assistant([]), content: ++attempts === 1 ? [] : [{ type: "text", text: "Advice" }], usage: billed, stopReason: "stop" };
      } },
    } } as unknown as ExtensionContext;
    try {
      const result = await executeAdvisor(ctx, h.pi, undefined, undefined, h.view, "call-0");
      expect(result.content).toEqual([{ type: "text", text: "Advice" }]);
      expect(attempts).toBe(2);
      expect(result.usage).toEqual({ ...usage, input: 20, totalTokens: 20 });
      expect(sent?.tools).toEqual([]);
      expect(JSON.stringify(sent?.messages)).toContain("BCP summary");
    } finally { setAdvisorModel(undefined); }
  });
});
