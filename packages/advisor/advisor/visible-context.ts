import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { convertToLlm, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureUserTailForAdvisor } from "./context.js";

/** Nested model calls don't inherit Pi's blockImages/provider image filters.
 * Conservatively omit ALL images rather than bypass an unknown privacy policy. */
export function omitImages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if ((message.role !== "user" && message.role !== "toolResult") || typeof message.content === "string") return message;
    return { ...message, content: message.content.map((part) => part.type === "image"
      ? { type: "text" as const, text: "[Image omitted from Advisor context for privacy.]" }
      : part) };
  });
}

/** Request-local copy, never reconstructed from the journal or BCP sidecars. */
export class VisibleContext {
  private snapshot?: { sessionId: string; messages: Message[] };
  private caller?: AssistantMessage;

  clear(): void {
    this.snapshot = undefined;
    this.caller = undefined;
  }

  register(pi: ExtensionAPI): void {
    // Pi 0.87.1 dispatches ALL context handlers (including BCP) before this phase.
    pi.on("context_with_system", (event, ctx) => {
      this.clear();
      this.snapshot = {
        sessionId: ctx.sessionManager.getSessionId(),
        // Advisor owns its system prompt; don't replay executor tool declarations.
        messages: omitImages(structuredClone(convertToLlm(event.messages.filter((m) => m.role !== "system")))),
      };
    });
    pi.on("message_end", (event) => {
      if (event.message.role === "assistant") this.caller = structuredClone(event.message);
    });
    // A sibling tool (especially compress) can change the view mid-turn. Require
    // a fresh main-model request before consulting, not a raw-history fallback.
    pi.on("tool_execution_start", (event) => {
      if (event.toolName !== "advisor") this.clear();
    });
    pi.on("turn_start", () => this.clear());
    pi.on("before_agent_start", () => this.clear());
    pi.on("agent_end", () => this.clear());
    pi.on("session_start", () => this.clear());
    pi.on("session_shutdown", () => this.clear());
    pi.on("session_before_switch", () => this.clear());
    pi.on("session_before_fork", () => this.clear());
    pi.on("session_before_tree", () => this.clear());
    pi.on("session_compact", () => this.clear());
  }

  messages(ctx: ExtensionContext, toolCallId: string): Message[] {
    const snapshot = this.snapshot;
    const caller = this.caller;
    const calls = caller?.content.filter((part) => part.type === "toolCall") ?? [];
    if (!snapshot || snapshot.sessionId !== ctx.sessionManager.getSessionId() ||
        calls.length !== 1 || calls[0]?.name !== "advisor" || calls[0]?.id !== toolCallId) {
      throw new Error("Advisor has no fresh, isolated model-visible context. Call advisor alone in a new turn (after compression/tools finish). Raw session replay is disabled.");
    }
    const messages = structuredClone(snapshot.messages);
    // Include the current executor's visible explanation, but never its unfinished
    // tool call, sibling calls, or provider-specific private thinking signatures.
    const text = caller!.content.filter((part) => part.type === "text");
    if (text.length) messages.push({ ...structuredClone(caller!), content: structuredClone(text), stopReason: "stop" });
    return ensureUserTailForAdvisor(messages);
  }
}
