import { stat } from "node:fs/promises";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { isAbsolute } from "node:path";
import {
  createReadTool, createWriteTool, createEditTool, createBashTool,
  createGrepTool, createFindTool, createLsTool,
} from "@earendil-works/pi-coding-agent";
import { PROTOCOL_VERSION, type ExecuteRequest, type ReadyMessage, type RuntimeAssemblyRequest } from "../protocol.ts";
import { computePiAssemblyId, PI_CORE_COMPONENT_ID, PI_REMOTE_RUNTIME_VERSION, resolvePiHostVersion, restorePiRuntimeAssembly } from "./assembly.ts";

export interface PiWorkerRuntime {
  manifest: ReadyMessage;
  execute(request: ExecuteRequest, signal?: AbortSignal, onUpdate?: (update: unknown) => void): Promise<unknown>;
  close(): Promise<void>;
}

/** Deliberately no AgentSession, model, settings, extensions or BC on the server. */
export async function createPiWorkerRuntime(cwd: string, request: RuntimeAssemblyRequest): Promise<PiWorkerRuntime> {
  if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new Error(`Remote cwd must be an existing absolute directory: ${cwd}`);
  const definitions = [createReadTool(cwd), createWriteTool(cwd), createEditTool(cwd), createBashTool(cwd, { exposeSessionEnvironment: false }), createGrepTool(cwd), createFindTool(cwd), createLsTool(cwd)];
  const all = new Map(definitions.map((tool) => [tool.name, tool]));
  const tools = request.tools.map(({ name, owner }) => {
    const tool = all.get(name);
    if (!tool || owner !== PI_CORE_COMPONENT_ID) throw new Error(`Unsupported Pi workspace tool: ${name}`);
    return { name, owner, description: tool.description, parameters: tool.parameters };
  });
  // Validate the parent's identity against the actual compiled native schemas and version.
  restorePiRuntimeAssembly(request, tools);
  const version = await resolvePiHostVersion();
  if (request.components[0]?.version !== version) throw new Error(`Pi version mismatch: parent ${request.components[0]?.version}, worker ${version}`);
  const actualRequest = { ...request, id: computePiAssemblyId(request.components, tools) };
  let closed = false;
  const active = new Set<AbortController>();
  return {
    manifest: { type: "ready", protocolVersion: PROTOCOL_VERSION, host: "pi", hostVersion: version, toolRuntimeVersion: PI_REMOTE_RUNTIME_VERSION, tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })), capabilities: { assembly: actualRequest } },
    async execute(request, signal, onUpdate) {
      if (closed) throw new Error("Pi worker runtime is closed");
      if (!tools.some((tool) => tool.name === request.tool)) throw new Error(`Tool not admitted: ${request.tool}`);
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
      active.add(controller);
      try {
        const tool = all.get(request.tool)!;
        const args = tool.prepareArguments ? tool.prepareArguments(request.args) : request.args;
        const validated = validateToolArguments(tool, { type: "toolCall", id: request.toolCallId, name: request.tool, arguments: args as Parameters<typeof validateToolArguments>[1]["arguments"] });
        return await tool.execute(request.toolCallId, validated as never, controller.signal, onUpdate);
      } finally {
        active.delete(controller);
        signal?.removeEventListener("abort", abort);
      }
    },
    async close() {
      closed = true;
      for (const controller of active) controller.abort(new Error("Pi worker closed"));
    },
  };
}
