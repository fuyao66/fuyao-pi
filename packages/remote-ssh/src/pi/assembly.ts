import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPackageDir, type ToolInfo } from "@earendil-works/pi-coding-agent";
import type { ReadyMessage, RuntimeAssemblyComponent, RuntimeAssemblyRequest, ToolManifest } from "../protocol.ts";
import type { RemoteRuntimeHandshake, RemoteWorkerBundle } from "../runtime-contract.ts";

export const PI_REMOTE_RUNTIME_VERSION = "1.0.0" as const;
export const PI_CORE_COMPONENT_ID = "pi-core" as const;
export const PI_CORE_CONTRACT_VERSION = "2" as const;
export const PI_CORE_TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;
const CORE_TOOLS = new Set<string>(PI_CORE_TOOL_NAMES);
export type PiToolSnapshot = Pick<ToolInfo, "name" | "description" | "parameters" | "sourceInfo">;
export interface PiAssemblyTool extends ToolManifest { owner: string; parameters: unknown }
export interface PiAssemblyComponent extends RuntimeAssemblyComponent { displayName: string; tools: readonly string[] }
export interface PiRuntimeAssembly {
  id: string;
  displayName: string;
  host: PiAssemblyComponent;
  plugins: readonly PiAssemblyComponent[];
  components: readonly PiAssemblyComponent[];
  tools: readonly PiAssemblyTool[];
  request: RuntimeAssemblyRequest;
  handshake: RemoteRuntimeHandshake;
  workerBundle: RemoteWorkerBundle;
  knownWorkspaceTools: ReadonlySet<string>;
  executionRuntime: { local: string; remote: string };
}
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}
export async function resolvePiHostVersion(): Promise<string> {
  if (process.env.PI_BUNDLED_HOST_VERSION) return process.env.PI_BUNDLED_HOST_VERSION;
  const manifest = JSON.parse(await readFile(join(getPackageDir(), "package.json"), "utf8"));
  return manifest.version;
}
export function computePiAssemblyId(
  components: readonly RuntimeAssemblyComponent[],
  tools: readonly Pick<PiAssemblyTool, "name" | "owner" | "parameters">[],
): string {
  return createHash("sha256").update(stableJson({ components, tools: tools.map(({ name, owner, parameters }) => ({ name, owner, parameters })) })).digest("hex").slice(0, 24);
}
function objectSchema(value: unknown): boolean {
  return !!value && typeof value === "object" && "type" in value && value.type === "object";
}
export function restorePiRuntimeAssembly(request: RuntimeAssemblyRequest, tools: readonly PiAssemblyTool[]): PiRuntimeAssembly {
  const host = request.components[0];
  if (request.components.length !== 1 || !host || host.id !== PI_CORE_COMPONENT_ID || host.kind !== "host" || host.contractVersion !== PI_CORE_CONTRACT_VERSION || host.config !== undefined) {
    throw new Error("Only the fixed Pi core worker contract is supported; BCP runs locally");
  }
  const names = new Set<string>();
  for (const tool of tools) {
    if (!CORE_TOOLS.has(tool.name) || tool.owner !== PI_CORE_COMPONENT_ID || names.has(tool.name) || !objectSchema(tool.parameters)) throw new Error(`Invalid fixed-stack workspace tool: ${tool.name}`);
    names.add(tool.name);
  }
  if (!tools.length || stableJson(request.tools) !== stableJson(tools.map(({ name, owner }) => ({ name, owner })))) throw new Error("Pi worker tool list is incomplete or duplicated");
  if (computePiAssemblyId(request.components, tools) !== request.id) throw new Error("Pi runtime contract does not match its ID");
  const component = { ...host, displayName: "Pi core", tools: [...names] };
  const assembly: PiRuntimeAssembly = {
    id: request.id, displayName: "Pi core + billion-context-pi:dist (local)", host: component,
    plugins: [], components: [component], tools, request,
    handshake: { host: "pi", hostVersion: host.version, runtimeVersion: PI_REMOTE_RUNTIME_VERSION, requestedTools: [...names], assembly: request, validateReady: (ready) => validatePiReadyMessage(assembly, ready) },
    workerBundle: { cacheNamespace: "pi-bcp-v1", companionArtifacts: [{ id: "photon", filePrefix: "photon-wasm", executableName: "photon_rs_bg.wasm" }] },
    knownWorkspaceTools: names,
    executionRuntime: { local: "Pi + billion-context-pi:dist", remote: "model-free Pi core tools; BCP control plane remains local" },
  };
  return assembly;
}
export async function resolvePiRuntimeAssembly(options: { tools: readonly PiToolSnapshot[]; hostVersion?: string }): Promise<PiRuntimeAssembly> {
  const tools: PiAssemblyTool[] = [];
  for (const tool of options.tools) {
    if (!CORE_TOOLS.has(tool.name)) continue;
    if (tool.sourceInfo.source !== "builtin" && !tool.sourceInfo.path.startsWith("<builtin")) throw new Error(`Pi workspace tool ${tool.name} is owned by an unsupported extension`);
    tools.push({ name: tool.name, owner: PI_CORE_COMPONENT_ID, description: tool.description, parameters: tool.parameters });
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));
  const components: RuntimeAssemblyComponent[] = [{ id: PI_CORE_COMPONENT_ID, kind: "host", contractVersion: PI_CORE_CONTRACT_VERSION, version: options.hostVersion ?? await resolvePiHostVersion() }];
  return restorePiRuntimeAssembly({ id: computePiAssemblyId(components, tools), components, tools: tools.map(({ name, owner }) => ({ name, owner })) }, tools);
}
export function validatePiReadyMessage(assembly: Pick<PiRuntimeAssembly, "id" | "request" | "tools">, ready: ReadyMessage): void {
  if (ready.host !== "pi" || ready.hostVersion !== assembly.request.components[0]?.version || ready.toolRuntimeVersion !== PI_REMOTE_RUNTIME_VERSION) throw new Error("Remote Pi version/runtime mismatch; rebuild the worker for this installed Pi version");
  if (stableJson(ready.capabilities?.assembly) !== stableJson(assembly.request)) throw new Error("Remote Pi runtime contract mismatch");
  if (ready.tools.length !== assembly.tools.length) throw new Error("Remote Pi tool count mismatch");
  const seen = new Set<string>();
  for (const tool of ready.tools) {
    const expected = assembly.tools.find((item) => item.name === tool.name);
    if (!expected || seen.has(tool.name) || stableJson(tool.parameters) !== stableJson(expected.parameters)) throw new Error(`Remote Pi tool schema mismatch: ${tool.name}`);
    seen.add(tool.name);
  }
}
