import { randomUUID } from "node:crypto";
import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionToolContext,
  ToolInfo,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition,
  createBashToolDefinition, createGrepToolDefinition, createFindToolDefinition,
  createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { prepareRemoteWorker } from "../deploy.ts";
import {
  parseConnectArgs,
  loadConfiguredSshHosts,
  type RemoteConnectRequest,
} from "../connect-options.ts";
import type { ReadyMessage, ToolManifest } from "../protocol.ts";
import type { PiRemoteConnectionInheritance, PiRemoteConnectionInheritanceSpec } from "./integrations/connection-inheritance.ts";
import {
  PI_CORE_TOOL_NAMES,
  resolvePiRuntimeAssembly,
  restorePiRuntimeAssembly,
  type PiRuntimeAssembly,
} from "./assembly.ts";
import { PiRemoteWorkspaceScope } from "./scope.ts";
import { workspaceBinding } from "./workspace-binding.ts";
import { BcpLocalArtifacts, guardDelegateCwd } from "./integrations/bcp-local.ts";
import { publishSessionContext, restoreSessionContext, releaseSessionContext } from "./session-context.ts";
const STATE_KEY = Symbol.for("pi-ssh-remote/state");
const PENDING_RELOAD_TIMEOUT_MS = 60_000;

type PendingReload = {
  restored: boolean;
  requestId?: string;
  commandScheduled?: boolean;
  commandRunning?: boolean;
  /** Set when the model requested the exit; its turn was terminated and must be resumed. */
  resumeAgent?: boolean;
  watchdog?: ReturnType<typeof setTimeout>;
};

const REMOTE_EXIT_MESSAGE_TYPE = "remote-ssh-exit";

/**
 * remote_exit terminates the model turn so Pi can become idle and reload. Without a
 * follow-up turn the conversation silently stops; resume it with an explicit result.
 */
function resumeAgentAfterExit(pi: ExtensionAPI, text: string): void {
  setImmediate(() => {
    try {
      void Promise.resolve(
        pi.sendMessage(
          { customType: REMOTE_EXIT_MESSAGE_TYPE, content: text, display: true },
          { triggerTurn: true },
        ),
      ).catch(() => {});
    } catch {
      // A stale or shut-down runtime cannot resume; the user can continue manually.
    }
  });
}

export function filterStaleRemoteWrappers(
  tools: readonly ToolInfo[],
): readonly ToolInfo[] {
  const controlSource = sourceKey(
    tools.find((tool) => tool.name === "remote_workspace_status"),
  );
  if (!controlSource) return tools;
  const remoteWorkspaceNames = new Set<string>([
    ...PI_CORE_TOOL_NAMES,
  ]);
  return tools.filter(
    (tool) =>
      !(
        remoteWorkspaceNames.has(tool.name) && sourceKey(tool) === controlSource
      ),
  );
}

export interface PiRemoteWorkspaceStatus {
  mode: "local" | "remote" | "unavailable";
  transport: "not-selected" | "connected" | "unavailable";
  remoteCwd: string | null;
  connectionError: string | null;
  remoteWorkspaceTools: string[];
  workspaceHooks: unknown;
  workspaceServices: unknown;
  componentToolGroups: Array<{
    id: string;
    displayName: string;
    localVersion: string;
    remoteVersion: string;
    tools: string[];
  }>;
  assembly: {
    id: string;
    displayName: string;
    host: { id: string; version: string };
    plugins: Array<{ id: string; version: string }>;
  } | null;
  routing: {
    ordinaryFilesystemPaths: string;
    internalUris: string;
    subagents: string;
    executionRuntime: string;
  };
  note: string;
}

export interface PiRemoteExtensionState {
  selected: boolean;
  connecting?: AbortController;
  scope?: PiRemoteWorkspaceScope;
  assembly?: PiRuntimeAssembly;
  cwd?: string;
  connectOptions?: RemoteConnectRequest;
  connectionError?: string;
  isInheritedChild?: boolean;
  ownershipVerified?: boolean;
  ready?: ReadyMessage;
  localActiveTools?: string[];
  pendingReload?: PendingReload;
  inheritanceDisabled?: boolean;
  inheritanceOwnerToken?: string;
  localArtifacts?: BcpLocalArtifacts;
}
const SESSION_STATES_KEY = Symbol.for("pi-ssh-remote/session-states");
type GlobalWithPiRemoteState = typeof globalThis & {
  [STATE_KEY]?: PiRemoteExtensionState;
  [SESSION_STATES_KEY]?: WeakMap<object, PiRemoteExtensionState>;
};

const globalScope = globalThis as GlobalWithPiRemoteState;
const globalState = (globalScope[STATE_KEY] ??= { selected: false });
const stateByEventBus = globalScope[SESSION_STATES_KEY] ??= new WeakMap<object, PiRemoteExtensionState>();

export function getPiRemoteStateForSession(
  eventBus: object,
): PiRemoteExtensionState {
  let state = stateByEventBus.get(eventBus);
  if (!state) {
    state = { selected: false };

    stateByEventBus.set(eventBus, state);
  }
  return state;
}

function beginPendingReload(state: PiRemoteExtensionState): PendingReload {
  const existing = state.pendingReload;
  if (existing) return existing;
  const pending = { restored: false };
  state.pendingReload = pending;
  return pending;
}

function clearPendingReloadWatchdog(pending: PendingReload): void {
  if (pending.watchdog) {
    clearTimeout(pending.watchdog);
    pending.watchdog = undefined;
  }
}

function finishPendingReload(
  state: PiRemoteExtensionState,
  error?: unknown,
): void {
  const pending = state.pendingReload;
  if (!pending) return;
  state.pendingReload = undefined;
  clearPendingReloadWatchdog(pending);
  pending.restored = error === undefined;
}

export function getPiRemoteState(): PiRemoteExtensionState {
  return globalState;
}

function remoteComponentVersions(
  ready: ReadyMessage | undefined,
): Map<string, string> {
  const result = new Map<string, string>();
  const value = ready?.capabilities?.assembly;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  const components = (value as Record<string, unknown>).components;
  if (!Array.isArray(components)) return result;
  for (const component of components) {
    if (
      !component ||
      typeof component !== "object" ||
      Array.isArray(component)
    ) {
      continue;
    }
    const record = component as Record<string, unknown>;
    if (typeof record.id === "string" && typeof record.version === "string") {
      result.set(record.id, record.version);
    }
  }
  return result;
}

export function buildPiWorkspaceStatus(
  state: PiRemoteExtensionState,
): PiRemoteWorkspaceStatus {
  const mode = !state.selected
    ? "local"
    : state.connectionError ||
        !state.scope ||
        state.scope.isClosed ||
        !state.ownershipVerified ||
        !state.assembly
      ? "unavailable"
      : "remote";
  const toolNames = state.ready?.tools.map((tool) => tool.name) ?? [];
  const assembly = state.assembly;
  const remoteVersions = remoteComponentVersions(state.ready);

  return {
    mode,
    assembly: assembly
      ? {
          id: assembly.id,
          displayName: assembly.displayName,
          host: { id: assembly.host.id, version: assembly.host.version },
          plugins: assembly.plugins.map((plugin) => ({
            id: plugin.id,
            version: plugin.version,
          })),
        }
      : null,
    transport:
      mode === "local"
        ? "not-selected"
        : mode === "remote"
          ? "connected"
          : "unavailable",
    remoteCwd: mode === "remote" ? (state.cwd ?? null) : null,
    connectionError:
      mode === "unavailable"
        ? (state.connectionError ??
          "Remote tool ownership has not been verified")
        : null,
    remoteWorkspaceTools: mode === "remote" ? toolNames : [],
    workspaceHooks: mode === "remote" ? state.ready?.capabilities?.workspaceHooks ?? [] : [],
    workspaceServices: mode === "remote" ? state.ready?.capabilities?.workspaceServices ?? {} : {},
    componentToolGroups:
      mode === "remote" && assembly
        ? assembly.components.map((component) => ({
            id: component.id,
            displayName: component.displayName,
            localVersion: component.version,
            remoteVersion: remoteVersions.get(component.id) ?? "unknown",
            tools: toolNames.filter((name) => component.tools.includes(name)),
          }))
        : [],
    routing: {
      ordinaryFilesystemPaths:
        mode === "remote" && assembly
          ? `remote ${assembly.displayName} runtime`
          : mode === "unavailable"
            ? "fail-closed (remote assembly selected but unavailable)"
            : "local Pi runtime",
      internalUris: "local Pi control plane",
      subagents:
        mode === "remote"
          ? "independent companion inherited through connection environment"
          : "local process execution",
      executionRuntime:
        mode === "remote" && assembly
          ? assembly.executionRuntime.remote
          : (assembly?.executionRuntime.local ?? "local Pi runtime"),
    },
    note:
      mode === "remote"
        ? "Pi core tools run remotely. BCP context, delegate orchestration, session files, model requests and UI remain local."
        : mode === "unavailable"
          ? "Workspace tools fail closed until reconnection or /remote-exit."
          : "Local Pi tools are active.",
  };
}

function quoteCommandArgument(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function sourceKey(tool: ToolInfo | undefined): string | undefined {
  return tool ? JSON.stringify(tool.sourceInfo) : undefined;
}
export function getPiRemoteOwnershipErrors(
  allTools: readonly ToolInfo[],
  readyTools: readonly ToolManifest[],
  activeTools?: ReadonlySet<string>,
  extensionPath?: string,
): string[] {
  const activeReadyTools = readyTools.filter(
    (manifest) => !activeTools || activeTools.has(manifest.name),
  );
  const controlSource = sourceKey(
    allTools.find((tool) => tool.name === "remote_workspace_status"),
  );
  if (!controlSource) return activeReadyTools.filter((manifest) => {
    const tool = allTools.find((candidate) => candidate.name === manifest.name);
    return !extensionPath || tool?.sourceInfo.path !== extensionPath;
  }).map((tool) => tool.name);
  return activeReadyTools
    .map((manifest) => allTools.find((tool) => tool.name === manifest.name))
    .filter((tool) => sourceKey(tool) !== controlSource)
    .map((tool) => tool?.name ?? "<missing>");
}

function manifestSchema(tool: ToolManifest): TSchema {
  if (!tool.parameters || typeof tool.parameters !== "object") {
    throw new Error(
      `Remote tool ${tool.name} did not provide a parameter schema`,
    );
  }
  return tool.parameters as TSchema;
}

export async function installPiRemoteExtension(
  pi: ExtensionAPI,
  options: { inheritedChild?: boolean; inheritance?: PiRemoteConnectionInheritance; extensionPath?: string; exitTimeoutMs?: number } = {},
): Promise<void> {
  let sessionKey: object = pi.events ?? globalScope;
  let state = getPiRemoteStateForSession(sessionKey);
  let binding = workspaceBinding(sessionKey);
  publishSessionContext(pi, () => sessionKey);
  // Read-only, session-scoped identity for local companion plugins. No keys or
  // mutable state escape this event response; unavailable remote never means local.
  pi.events.on("fuyao:workspace-identity", (message: unknown) => {
    if (!message || typeof message !== 'object' || !('accept' in message) || typeof message.accept !== 'function') return;
    const status = buildPiWorkspaceStatus(state);
    message.accept({ mode: status.mode, generation: binding.generation,
      ...(status.mode === 'remote' ? { target: state.connectOptions?.target,
        port: state.connectOptions?.port ?? 22, root: state.cwd } : {}) });
  });
  const inheritance = options.inheritance;
  if (
    options.inheritedChild ||
    (state.inheritanceOwnerToken === undefined &&
      inheritance?.hasRootOwner())
  ) {
    state.isInheritedChild = true;
  } else {
    state.inheritanceOwnerToken ??= randomUUID();
  }
  const inheritedConnectionRequested =
    state.isInheritedChild === true &&
    !state.inheritanceDisabled &&
    inheritance?.hasSpec();
  let inheritedSpec: PiRemoteConnectionInheritanceSpec | undefined;
  if (!inheritedConnectionRequested || state.inheritanceDisabled) {
    inheritedSpec = undefined;
    if (state.isInheritedChild && !state.inheritanceDisabled) {
      state.selected = true;
      state.ownershipVerified = false;
      state.connectionError =
        "Child requires a valid inherited Pi remote connection";
    }
  } else {
    try {
      inheritedSpec = inheritance?.read();
    } catch (error) {
      state.isInheritedChild = true;
      state.selected = true;
      state.connectionError =
        error instanceof Error ? error.message : String(error);
      inheritedSpec = undefined;
    }
  }

  let registeredRemoteTools = new Set<string>();
  // Pi marks non-throwing tool returns successful; carry the worker's hook outcome through its result hook.
  const remoteResultErrors = new WeakMap<object, boolean>();
  const coreDefinitions = {
    read: createReadToolDefinition,
    write: createWriteToolDefinition,
    edit: createEditToolDefinition,
    bash: createBashToolDefinition,
    grep: createGrepToolDefinition,
    find: createFindToolDefinition,
    ls: createLsToolDefinition,
  };

  const localArtifacts = state.localArtifacts ??= new BcpLocalArtifacts();
  const resolveCurrentAssembly = async (): Promise<PiRuntimeAssembly> => resolvePiRuntimeAssembly({
    tools: filterStaleRemoteWrappers(pi.getAllTools()),
  });

  const verifyOwnership = (): void => {
    if (!state.selected || !state.ready) return;
    const allTools = pi.getAllTools();
    const activeTools = state.isInheritedChild
      ? new Set(pi.getActiveTools())
      : undefined;
    const wrongOwners = getPiRemoteOwnershipErrors(
      allTools,
      state.ready.tools,
      activeTools,
      options.extensionPath,
    );
    if (wrongOwners.length > 0) {
      state.ownershipVerified = false;
      state.connectionError = `Pi SSH Remote must load before the tools it replaces; ownership check failed for: ${wrongOwners.join(", ")}`;
      throw new Error(state.connectionError);
    }
    state.ownershipVerified = true;
    state.connectionError = undefined;
  };

  const registerRemoteWrappers = (
    ready: ReadyMessage,
    assembly: PiRuntimeAssembly,
  ): void => {
    const readyNames = new Set(ready.tools.map((tool) => tool.name));
    for (const tool of assembly.tools) {
      if (!readyNames.has(tool.name) || registeredRemoteTools.has(tool.name)) {
        continue;
      }
      registeredRemoteTools.add(tool.name);
      const native = tool.name in coreDefinitions
        ? coreDefinitions[tool.name as keyof typeof coreDefinitions](state.cwd ?? process.cwd())
        : undefined;
      // Each renderer retains its verified native schema; erase only the heterogeneous generic here.
      const nativeDefinition = native as ToolDefinition | undefined;
      pi.registerTool({
        ...nativeDefinition,
        name: tool.name,
        label: tool.name,
        description: `[Remote on ${state.connectOptions?.displayTarget ?? "SSH host"}] ${tool.description}`,
        parameters: manifestSchema(tool),
        execute: async (
          toolCallId: string,
          params: unknown,
          signal?: AbortSignal,
          onUpdate?: AgentToolUpdateCallback<unknown>,
          _ctx?: ExtensionToolContext,
        ) => {
          if (tool.name === "read" && localArtifacts.isLocalRead(params)) {
            return createReadToolDefinition(process.cwd()).execute(toolCallId, params as never, signal, onUpdate as never, _ctx!);
          }
          if (!state.selected || !state.scope || state.scope.isClosed) {
            state.connectionError ??=
              "Remote runtime connection lost (fail-closed protection)";
            throw new Error(
              "Remote runtime unavailable. Tool execution was blocked; no local fallback occurred.",
            );
          }
          if (!state.ownershipVerified) verifyOwnership();
          const args =
            params && typeof params === "object"
              ? (params as Record<string, unknown>)
              : {};
          const result = await binding.execute(
            tool.name,
            toolCallId,
            args,
            signal,
            onUpdate
              ? (update: unknown) => onUpdate(update as never)
              : undefined,
          );
          if (result && typeof result === "object" && "content" in result && Array.isArray(result.content) && "isError" in result && typeof result.isError === "boolean") {
            remoteResultErrors.set(result.content, result.isError);
          }
          return result as never;
        },
      });
    }
  };

  const connectPrepared = async (
    assembly: PiRuntimeAssembly,
    parsed: RemoteConnectRequest,
    remoteCwd: string,
    remoteWorkerPath: string,
    preparedGeneration?: number,
    signal?: AbortSignal,
  ): Promise<ReadyMessage> => {
    if (state.scope && !state.scope.isClosed) {
      throw new Error(
        "Already connected to a remote runtime. Run /remote-exit first.",
      );
    }
    if (
      state.selected &&
      state.connectionError &&
      (!state.scope || state.scope.isClosed)
    ) {
      throw new Error(
        "Remote runtime is selected but unavailable. Run /remote-exit before reconnecting.",
      );
    }
    state.selected = true;
    state.ownershipVerified = false;
    state.connectionError = undefined;
    state.assembly = assembly;
    state.connectOptions = parsed;
    state.cwd = remoteCwd;
    state.localActiveTools ??= pi.getActiveTools();

    let openedScope: PiRemoteWorkspaceScope | undefined;
    let generation = preparedGeneration;
    try {
      generation ??= await binding.begin();
      openedScope = await PiRemoteWorkspaceScope.open({
        assembly,
        connectOptions: parsed,
        workerPath: remoteWorkerPath,
        cwd: remoteCwd,
        signal,
      });
      if (binding.generation !== generation || binding.phase !== "connecting") {
        throw new Error("Remote connection attempt is obsolete");
      }
      state.scope = openedScope;
      state.ready = openedScope.ready;
      openedScope.onClose((error) => {
        if (state.scope !== openedScope || !state.selected || binding.phase === "closing") return;
        state.ownershipVerified = false;
        state.connectionError = error.message;
        binding.fail(error);
      });
      registerRemoteWrappers(openedScope.ready, assembly);
      if (!state.isInheritedChild) verifyOwnership();
      binding.commit(openedScope, generation);
      if (!state.isInheritedChild) {
        inheritance?.publish({
          ownerToken: state.inheritanceOwnerToken!,
          assembly: assembly.request,
          tools: assembly.tools,
          connectOptions: parsed,
          workerPath: remoteWorkerPath,
          cwd: remoteCwd,
        });
      }
      return openedScope.ready;
    } catch (error) {
      if (binding.generation === generation || (openedScope && state.scope === openedScope)) {
        binding.fail(error);
        state.ownershipVerified = false;
        state.connectionError = error instanceof Error ? error.message : String(error);
        state.scope = undefined;
        state.ready = undefined;
      }
      try { await openedScope?.close(true); } catch {}
      throw error;
    }
  };

  const connect = async (
    request: string | RemoteConnectRequest,
    localCwd: string,
    signal?: AbortSignal,
  ): Promise<ReadyMessage> => {
    if (state.isInheritedChild) {
      throw new Error(
        "Child sessions can only restore a parent Pi remote connection",
      );
    }
    if (state.pendingReload) throw new Error("Remote exit is pending; reconnect after the current response finishes and local tools are restored.");
    if (state.connecting) throw new Error("Remote connection is already in progress");
    if (state.selected) throw new Error("Remote runtime is already selected. Run /remote-exit before reconnecting.");
    // Reserve synchronously: Pi may start sibling tool calls before our first await.
    signal?.throwIfAborted();
    const attempt = new AbortController();
    const abort = () => attempt.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    state.connecting = attempt;
    state.selected = true;
    state.ownershipVerified = false;
    state.localActiveTools ??= pi.getActiveTools();
    const assertCurrent = () => {
      attempt.signal.throwIfAborted();
      if (state.connecting !== attempt || !state.selected) throw new Error("Remote connection attempt is obsolete");
    };
    try {
      const generation = await binding.begin();
      assertCurrent();
      const assembly = await resolveCurrentAssembly();
      assertCurrent();
      const configuredHosts = await loadConfiguredSshHosts(localCwd);
      const parsed =
        typeof request === "string"
          ? parseConnectArgs(request, configuredHosts)
          : parseConnectArgs(
              [
                quoteCommandArgument(request.target),
                ...(request.cwd ? [quoteCommandArgument(request.cwd)] : []),
                ...(request.identityFile
                  ? ["--identity", quoteCommandArgument(request.identityFile)]
                  : []),
                ...(request.port ? ["--port", String(request.port)] : []),
              ].join(" "),
              configuredHosts,
            );
      assertCurrent();
      if (!state.isInheritedChild) {
        inheritance?.claim(state.inheritanceOwnerToken!);
      }
      const prepared = await prepareRemoteWorker(
        {
          target: parsed.target,
          port: parsed.port,
          identityFile: parsed.identityFile,
          knownHostsFile: parsed.knownHostsFile,
          localWorkerPath: parsed.workerPath,
          signal: attempt.signal,
        },
        assembly.workerBundle,
      );
      assertCurrent();
      const remoteCwd = parsed.cwd ?? prepared.home;
      if (!remoteCwd) throw new Error("Remote cwd and probed remote home are unavailable");
      return await connectPrepared(
        assembly,
        parsed,
        remoteCwd,
        prepared.workerPath,
        generation,
        attempt.signal,
      );
    } catch (error) {
      if (state.connecting === attempt) {
        binding.fail(error);
        state.ownershipVerified = false;
        state.connectionError = error instanceof Error ? error.message : String(error);
        inheritance?.clear(state.inheritanceOwnerToken);
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (state.connecting === attempt) state.connecting = undefined;
    }
  };

  pi.registerTool({
    name: "remote_workspace_status",
    label: "workspace status",
    description:
      "Report the current Pi execution domain, resolved runtime assembly, remote cwd, verified tool ownership, and routing boundaries.",
    parameters: Type.Object({}),
    execute: async () => {
      const status = buildPiWorkspaceStatus(state);
      return {
        content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        details: status,
      } as never;
    },
  });

  pi.registerTool({
    name: "remote_connect",
    label: "Remote Connect",
    description:
      "Connect Pi + billion-context-pi to an SSH workspace. Pi filesystem/shell tools run remotely; BCP stays local.",
    parameters: Type.Object({
      target: Type.String({ description: "SSH alias or user@host" }),
      cwd: Type.Optional(
        Type.String({ description: "Remote cwd; defaults to remote home" }),
      ),
      identity: Type.Optional(
        Type.String({ description: "SSH private key path" }),
      ),
      port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
    }),
    execute: async (
      _id: string,
      params: unknown,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<unknown>,
      ctx?: ExtensionContext,
    ) => {
      const args =
        params && typeof params === "object"
          ? (params as Record<string, unknown>)
          : {};
      const target = typeof args.target === "string" ? args.target : "";
      if (!target) throw new Error("Missing required target");
      await connect(
        {
          target,
          displayTarget: target,
          ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
          ...(typeof args.identity === "string"
            ? { identityFile: args.identity }
            : {}),
          ...(typeof args.port === "number" ? { port: args.port } : {}),
        },
        ctx?.cwd ?? process.cwd(),
        signal,
      );
      const status = buildPiWorkspaceStatus(state);
      return {
        content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        details: status,
      } as never;
    },
  });

  pi.registerTool({
    name: "remote_exit",
    label: "Remote Exit",
    description:
      "Queue a graceful remote disconnect and rebuild the local Pi tool set. Call it alone: other tool calls in the same message are skipped, and the conversation resumes automatically once local tools are restored.",
    parameters: Type.Object({
      force: Type.Optional(Type.Boolean()),
    }),
    execute: async (_id: string, params: unknown) => {
      if (state.connecting) throw new Error("Remote connection is in progress; wait for it to finish before exiting");
      const force =
        !!params &&
        typeof params === "object" &&
        (params as Record<string, unknown>).force === true;
      const command = force ? "/remote-exit --force" : "/remote-exit";
      const pending = beginPendingReload(state);
      if (pending.commandScheduled || pending.commandRunning) {
        return {
          content: [{ type: "text", text: "Remote exit is already pending." }],
          details: { queued: false, command },
          // Keep the turn ending so the already-queued exit can run.
          terminate: true,
        } as never;
      }
      pending.requestId = randomUUID();
      const dispatchCommand = `${command} --request=${pending.requestId}`;
      pending.commandScheduled = true;
      pending.resumeAgent = true;
      pending.watchdog = setTimeout(() => {
        if (state.pendingReload !== pending || pending.commandRunning) return;
        finishPendingReload(
          state,
          new Error("Remote exit was not accepted by the current Pi turn"),
        );
        resumeAgentAfterExit(pi, "remote_exit failed: the exit command was not accepted by Pi. The remote workspace is still selected. Retry remote_exit or ask the user to run /remote-exit.");
      }, options.exitTimeoutMs ?? PENDING_RELOAD_TIMEOUT_MS);
      pending.watchdog.unref?.();
      setImmediate(() => {
        if (state.pendingReload !== pending) return;
        try {
          // This must be delivered after the tool result: Pi cannot reload its
          // extension runner while this tool handler is still active.
          void Promise.resolve(pi.sendUserMessage(dispatchCommand, {
            deliverAs: "steer",
            expandPromptTemplates: true,
          })).catch((error) => {
            if (state.pendingReload === pending) {
              finishPendingReload(state, error);
              resumeAgentAfterExit(pi, `remote_exit failed: ${error instanceof Error ? error.message : String(error)}. The remote workspace is still selected; retry remote_exit or ask the user to run /remote-exit.`);
            }
          });
        } catch (error) {
          if (state.pendingReload === pending) {
            finishPendingReload(state, error);
            resumeAgentAfterExit(pi, `remote_exit failed: ${error instanceof Error ? error.message : String(error)}. The remote workspace is still selected; retry remote_exit or ask the user to run /remote-exit.`);
          }
        }
      });
      // The command waits for idle; this tool must finish before that can happen.
      return {
        content: [{ type: "text", text: `Queued ${command}; local tools are restored after the current response finishes.` }],
        details: { queued: true, command },
        terminate: true,
      } as never;
    },
  });

  pi.registerCommand("remote-connect", {
    description: "Connect Pi Agent to a remote SSH workspace",
    handler: async (
      args: string,
      ctx: ExtensionCommandContext,
    ): Promise<void> => {
      try {
        await connect(args, ctx.cwd);
        ctx.ui?.notify?.(
          `Connected to ${state.connectOptions?.displayTarget} (cwd: ${state.cwd})`,
          "info",
        );
      } catch (error) {
        ctx.ui?.notify?.(
          `Failed to connect: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("remote-exit", {
    description: "Disconnect and restore the local Pi tool set",
    handler: async (
      args: string,
      ctx: ExtensionCommandContext,
    ): Promise<void> => {
      if (state.connecting) throw new Error("Remote connection is in progress; wait for it to finish before exiting");
      const flags = args.trim().split(/\s+/);
      const force = flags.includes("--force");
      const requestId = flags.find((flag) => flag.startsWith("--request="))?.slice("--request=".length);
      // A delayed command from a timed-out request must not close a new connection.
      if (requestId && state.pendingReload?.requestId !== requestId) return;
      if (!requestId && state.pendingReload?.commandScheduled) {
        ctx.ui?.notify?.("Remote exit is already pending.", "warning");
        return;
      }
      if (!state.selected && !state.scope) {
        ctx.ui?.notify?.("Not connected to a remote runtime.", "warning");
        finishPendingReload(state);
        return;
      }
      const pendingReload = beginPendingReload(state);
      if (pendingReload.commandRunning) {
        ctx.ui?.notify?.("Remote exit is already in progress.", "warning");
        return;
      }
      pendingReload.commandScheduled = false;
      pendingReload.commandRunning = true;
      clearPendingReloadWatchdog(pendingReload);
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            ctx.waitForIdle(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error("Remote exit timed out waiting for Pi to become idle; retry /remote-exit after stopping the current response")), options.exitTimeoutMs ?? PENDING_RELOAD_TIMEOUT_MS);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (state.pendingReload !== pendingReload) return;
        const inheritedChild = state.isInheritedChild;
        await binding.close(force);
        state.selected = false;
        state.scope = undefined;
        state.ready = undefined;
        state.assembly = undefined;
        state.cwd = undefined;
        state.connectOptions = undefined;
        state.connectionError = undefined;
        state.ownershipVerified = undefined;
        if (inheritedChild) state.inheritanceDisabled = true;
        if (!inheritedChild) {
          inheritance?.clear(state.inheritanceOwnerToken);
        }
        ctx.ui?.notify?.(
          "Disconnected. Reloading the local Pi tool set.",
          "info",
        );
        await ctx.reload();
        if (!pendingReload.restored) {
          throw new Error("Pi did not rebuild the local tool set. Wait until idle and run /remote-exit again.");
        }
        return;
      } catch (error) {
        const resumeAgent = pendingReload.resumeAgent && state.pendingReload === pendingReload;
        finishPendingReload(state, error);
        if (resumeAgent) {
          resumeAgentAfterExit(pi, `remote_exit failed: ${error instanceof Error ? error.message : String(error)}. Workspace tools remain blocked until /remote-exit succeeds.`);
        }
        if (binding.selected || !pendingReload.restored) {
          state.selected = true;
          binding.fail(error);
          state.ownershipVerified = false;
          state.connectionError =
            error instanceof Error ? error.message : String(error);
        } else {
          state.selected = false;
          state.scope = undefined;
          state.ready = undefined;
          state.assembly = undefined;
          state.cwd = undefined;
          state.connectOptions = undefined;
          state.connectionError = undefined;
          state.ownershipVerified = undefined;
        }
        throw error;
      }
    },
  });

  pi.registerCommand("remote-status", {
    description: "Show current remote connection status",
    handler: async (
      _args: string,
      ctx: ExtensionCommandContext,
    ): Promise<void> => {
      const status = buildPiWorkspaceStatus(state);
      ctx.ui?.notify?.(
        JSON.stringify(status),
        status.mode === "unavailable" ? "error" : "info",
      );
    },
  });

  pi.on("tool_result", (event) => {
    localArtifacts.observe(event.toolName, event.content, event.isError);
    const isError = remoteResultErrors.get(event.content);
    if (isError === undefined) return;
    remoteResultErrors.delete(event.content);
    return { isError };
  });

  // Pi ends a turn only when every result in the tool batch sets terminate. If
  // remote_exit shares a batch, skip the siblings (with terminate) so the turn can
  // end, Pi becomes idle and the exit runs instead of timing out.
  let exitBatchSiblings = new Set<string>();
  pi.on("message_end", (event) => {
    const message = event.message as { role?: string; content?: unknown };
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    const calls = message.content.filter((part): part is { type: "toolCall"; id: string; name: string } =>
      !!part && typeof part === "object" && (part as { type?: unknown }).type === "toolCall");
    exitBatchSiblings = calls.some((call) => call.name === "remote_exit")
      ? new Set(calls.filter((call) => call.name !== "remote_exit").map((call) => call.id))
      : new Set();
  });

  pi.on("tool_call", (event, ctx) => {
    if (exitBatchSiblings.delete(event.toolCallId)) {
      return { block: true, terminate: true, reason: "Skipped: remote_exit must be called alone. Retry this call after the exit completes and local tools are restored." };
    }
    if ((state.selected || state.pendingReload) && event.toolName === "powershell") return { block: true, reason: "PowerShell is not supported by the Linux SSH worker; local execution is blocked." };
    if (state.selected && event.toolName === "acp_delegate") {
      try { verifyOwnership(); } catch { /* Report the unavailable workspace below. */ }
      if (!state.scope || state.scope.isClosed || state.pendingReload || !state.ownershipVerified) return { block: true, reason: "Remote workspace unavailable; delegate launch blocked." };
      return guardDelegateCwd(event.input, ctx.cwd, state.cwd!);
    }
    if (event.toolName === "read" && localArtifacts.isLocalRead(event.input)) return;
    const guardedNames = new Set([
      ...PI_CORE_TOOL_NAMES,
      ...(state.assembly?.knownWorkspaceTools ?? []),
      ...(state.ready?.tools.map((tool) => tool.name) ?? []),
    ]);
    if (state.pendingReload && guardedNames.has(event.toolName)) {
      return { block: true, reason: "Remote exit is pending; workspace tools resume after the local tool set is rebuilt." };
    }
    if (!state.selected || !guardedNames.has(event.toolName)) return;
    if (!state.ready?.tools.some((tool) => tool.name === event.toolName)) return { block: true, reason: `Tool ${event.toolName} is not admitted by the inherited remote workspace; local execution blocked.` };
    if (!state.scope || state.scope.isClosed) {
      return {
        block: true,
        reason:
          state.connectionError ??
          "Remote Pi assembly is selected but unavailable; local fallback is blocked.",
      };
    }
    if (!state.ownershipVerified) {
      try {
        verifyOwnership();
      } catch (error) {
        return {
          block: true,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
  });

  pi.on("before_agent_start", (event) => {
    if (!state.selected) return;
    return { systemPrompt: `${event.systemPrompt}\n\nSSH WORKSPACE: ${state.connectOptions?.displayTarget ?? "unavailable"}:${state.cwd ?? "unknown"}. Ordinary read/write/edit/bash/grep/find/ls paths are REMOTE, not the local process cwd. BCP context tools, delegate orchestration and sessions stay LOCAL. Delegates inherit this remote workspace; omit their cwd. Use read (not bash) for local BCP delegate/decompress output files. Local project instructions may describe the client: inspect remote AGENTS.md before editing. No local fallback on transport loss.` };
  });

  pi.on("user_bash", async () => {
    if (state.selected || state.pendingReload) throw new Error("! / !! shell is disabled in remote mode; use the remote bash tool, or /remote-exit for local shell.");
  });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx) {
      sessionKey = restoreSessionContext(ctx, sessionKey);
      state = getPiRemoteStateForSession(sessionKey);
      binding = workspaceBinding(sessionKey);
      if (state.selected && state.ready && state.assembly) registerRemoteWrappers(state.ready, state.assembly);
    }
    registeredRemoteTools = new Set();
    if (inheritedSpec && !state.inheritanceDisabled && !state.selected && !state.scope) {
      state.isInheritedChild = true;
      try {
        const assembly = restorePiRuntimeAssembly(
          inheritedSpec.assembly,
          inheritedSpec.tools,
        );
        if (assembly.id !== inheritedSpec.assembly.id) {
          throw new Error(
            `Inherited Pi assembly ${inheritedSpec.assembly.id} does not match this child runtime ${assembly.id}`,
          );
        }
        await connectPrepared(
          assembly,
          inheritedSpec.connectOptions,
          inheritedSpec.cwd,
          inheritedSpec.workerPath,
        );
      } catch (error) {
        state.selected = true;
        state.ownershipVerified = false;
        state.connectionError =
          error instanceof Error ? error.message : String(error);
      }
      return;
    }
    if (state.selected && state.ready) {
      try {
        verifyOwnership();
      } catch {
        // Keep the selected runtime fail-closed; tool_call reports the stored error.
      }
      if (state.localActiveTools) restoreWorkspaceToolSelection();
    } else if (state.localActiveTools) {
      restoreWorkspaceToolSelection();
      state.localActiveTools = undefined;
    }
    if (!state.selected && state.pendingReload) {
      const allTools = pi.getAllTools();
      if (filterStaleRemoteWrappers(allTools).length !== allTools.length) {
        const error = new Error("Pi reload retained remote workspace tools; local restoration was not completed");
        // Do not leave reconnect blocked forever when reload fails partway through.
        const resumeAgent = state.pendingReload.resumeAgent;
        finishPendingReload(state, error);
        if (resumeAgent) resumeAgentAfterExit(pi, `remote_exit failed: ${error.message}. Workspace tools remain blocked until /remote-exit succeeds.`);
        state.selected = true;
        state.ownershipVerified = false;
        state.connectionError = error.message;
        binding.fail(error);
        throw error;
      }
      const resumeAgent = state.pendingReload.resumeAgent;
      finishPendingReload(state);
      // This is the reloaded extension instance; its pi API is current.
      if (resumeAgent) {
        resumeAgentAfterExit(pi, "remote_exit completed: the SSH workspace is disconnected and local tools are restored. Continue the task in the local workspace.");
      }
    }
  });

  // Restore only the core workspace selection. Pi and local extensions own the
  // current non-core set (including newly installed tools and UI reconciliation).
  function restoreWorkspaceToolSelection(): void {
    const core = new Set<string>(PI_CORE_TOOL_NAMES);
    pi.setActiveTools([
      ...(state.localActiveTools ?? []).filter((name) => core.has(name)),
      ...pi.getActiveTools().filter((name) => !core.has(name)),
    ]);
  }

  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason === "reload") return;
    if (ctx) releaseSessionContext(ctx);
    const preparation = state.connecting;
    state.connecting = undefined;
    preparation?.abort(new Error("Remote connection attempt is obsolete: Pi session shut down"));
    finishPendingReload(state, new Error("Pi session shut down before remote exit completed"));
    const inheritedChild = state.isInheritedChild;
    try {
      await binding.close(true);
    } finally {
      state.scope = undefined;
      state.selected = false;
      state.ready = undefined;
      state.assembly = undefined;
      state.cwd = undefined;
      state.connectOptions = undefined;
      state.connectionError = undefined;
      state.isInheritedChild = undefined;
      state.ownershipVerified = undefined;
      state.localActiveTools = undefined;
      state.localArtifacts = undefined;
      if (!inheritedChild) {
        inheritance?.clear(state.inheritanceOwnerToken);
      }
    }
  });

  if (
    state.selected &&
    state.ready &&
    state.assembly &&
    state.scope &&
    !state.scope.isClosed
  ) {
    registeredRemoteTools = new Set();
    registerRemoteWrappers(state.ready, state.assembly);
  }
}

export default installPiRemoteExtension;
