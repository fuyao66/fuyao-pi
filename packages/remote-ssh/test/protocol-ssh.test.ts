import { describe, expect, test } from "bun:test";
import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  decodeFrames,
  parseMessage,
  parseRequest,
  type ReadyMessage,
  type RuntimeAssemblyRequest,
} from "../src/protocol.ts";
import {
  PI_CORE_COMPONENT_ID,
  PI_REMOTE_RUNTIME_VERSION,
  validatePiReadyMessage,
} from "../src/pi/assembly.ts";
import {
  buildScpBaseCommand,
  buildSshWorkerCommand,
  quoteRemoteArgument,
} from "../src/ssh.ts";

async function* chunks(...values: string[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield new TextEncoder().encode(value);
}

const assemblyRequest: RuntimeAssemblyRequest = {
  id: "schema-compatible-assembly",
  components: [
    {
      id: PI_CORE_COMPONENT_ID,
      kind: "host",
      contractVersion: "1",
      version: "0.90.0",
    },
  ],
  tools: [
    { name: "find", owner: PI_CORE_COMPONENT_ID },
    { name: "read", owner: PI_CORE_COMPONENT_ID },
  ],
};
const expectedTools = [
  {
    name: "find",
    owner: PI_CORE_COMPONENT_ID,
    description: "find",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "read",
    owner: PI_CORE_COMPONENT_ID,
    description: "read",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];
const validationAssembly = {
  id: assemblyRequest.id,
  request: assemblyRequest,
  tools: expectedTools,
};

function validReady(): ReadyMessage {
  return {
    type: "ready",
    protocolVersion: PROTOCOL_VERSION,
    host: "pi",
    hostVersion: "0.90.0",
    toolRuntimeVersion: PI_REMOTE_RUNTIME_VERSION,
    tools: expectedTools.map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    capabilities: {
      assembly: {
        id: assemblyRequest.id,
        components: [
          { ...assemblyRequest.components[0] },
        ],
        tools: assemblyRequest.tools.map((tool) => ({ ...tool })),
      },
    },
  };
}

describe("protocol boundaries", () => {
  test("decodes frames across arbitrary chunks", async () => {
    const frames: string[] = [];
    for await (const frame of decodeFrames(
      chunks('{"type":"shutdown"', "}\n", '{"type":"cancel","id":"1"}\n'),
    )) {
      frames.push(frame);
    }
    expect(frames.map(parseRequest)).toEqual([
      { type: "shutdown" },
      { type: "cancel", id: "1" },
    ]);
  });

  test("parses a structured runtime assembly on initialization", () => {
    const request = parseRequest({
      type: "initialize",
      protocolVersion: PROTOCOL_VERSION,
      host: "pi",
      hostVersion: "0.90.0",
      runtimeVersion: PI_REMOTE_RUNTIME_VERSION,
      cwd: "/workspace",
      tools: ["find", "read"],
      assembly: assemblyRequest,
    });
    expect(
      request.type === "initialize" ? request.assembly : undefined,
    ).toEqual(assemblyRequest);
  });

  test("rejects oversized unterminated frames", async () => {
    const consume = async () => {
      for await (const _frame of decodeFrames(
        chunks("x".repeat(MAX_FRAME_BYTES + 1)),
      )) {
        // No complete frame is expected.
      }
    };
    await expect(consume()).rejects.toThrow("exceeds");
  });

  test("rejects malformed request and response shapes", () => {
    expect(() => parseRequest('{"type":"execute","id":1}')).toThrow();
    expect(() => parseMessage('{"type":"result","id":"1"}')).toThrow(
      "missing result",
    );
    expect(() =>
      parseRequest({
        type: "initialize",
        protocolVersion: 1,
        runtimeVersion: "1",
        cwd: "/tmp",
        tools: [],
        assembly: { id: "bad", components: [{}], tools: [] },
      }),
    ).toThrow("must be a string");
  });
});

describe("Pi runtime assembly boundary", () => {
  test("accepts identical fixed Pi contracts", () => {
    expect(() =>
      validatePiReadyMessage(validationAssembly, validReady()),
    ).not.toThrow();
  });

  test("rejects Pi version drift", () => {
    const ready = validReady();
    ready.hostVersion = "0.91.0";
    expect(() => validatePiReadyMessage(validationAssembly, ready)).toThrow("version/runtime mismatch");
  });

  test("rejects missing, unknown, duplicate, and incompatible tools", () => {
    const missing = validReady();
    missing.tools = missing.tools.filter((tool) => tool.name !== "read");
    expect(() => validatePiReadyMessage(validationAssembly, missing)).toThrow(
      "tool count mismatch",
    );

    const unknown = validReady();
    unknown.tools.push({
      name: "remote_shell_root",
      description: "unexpected",
      parameters: { type: "object" },
    });
    expect(() => validatePiReadyMessage(validationAssembly, unknown)).toThrow(
      "tool count mismatch",
    );

    const duplicate = validReady();
    duplicate.tools.push(duplicate.tools[0]!);
    expect(() => validatePiReadyMessage(validationAssembly, duplicate)).toThrow(
      "tool count mismatch",
    );

    const invalidSchema = validReady();
    invalidSchema.tools[0] = { ...invalidSchema.tools[0]!, parameters: {} };
    expect(() =>
      validatePiReadyMessage(validationAssembly, invalidSchema),
    ).toThrow("schema mismatch");

    const incompatibleSchema = validReady();
    incompatibleSchema.tools[0] = {
      ...incompatibleSchema.tools[0]!,
      parameters: { type: "object", properties: {} },
    };
    expect(() =>
      validatePiReadyMessage(validationAssembly, incompatibleSchema),
    ).toThrow("schema mismatch");
  });

  test("rejects component contract and ownership drift", () => {
    const contractDrift = validReady();
    const capability = contractDrift.capabilities?.assembly as any;
    capability.components[0].contractVersion = "2";
    expect(() =>
      validatePiReadyMessage(validationAssembly, contractDrift),
    ).toThrow("runtime contract mismatch");

    const ownershipDrift = validReady();
    const ownershipCapability = ownershipDrift.capabilities?.assembly as any;
    ownershipCapability.tools[1].owner = "unsupported-plugin";
    expect(() =>
      validatePiReadyMessage(validationAssembly, ownershipDrift),
    ).toThrow("runtime contract mismatch");
  });
});

describe("SSH command safety", () => {
  test("quotes remote worker paths as one shell argument", () => {
    expect(quoteRemoteArgument("/tmp/worker path'quoted")).toBe(
      "'/tmp/worker path'\"'\"'quoted'",
    );
    expect(
      buildSshWorkerCommand({
        target: "user@example.com",
        workerPath: "/tmp/worker path'quoted",
      }).at(-1),
    ).toBe("exec '/tmp/worker path'\"'\"'quoted'");
  });

  test("forces strict non-forwarding SSH options", () => {
    const ssh = buildSshWorkerCommand({
      target: "user@example.com",
      workerPath: "/srv/worker",
    });
    const scp = buildScpBaseCommand({ target: "user@example.com" });
    expect(scp.slice(0, 2)).toEqual(["scp", "-O"]);
    for (const command of [ssh, scp]) {
      expect(command).toContain("StrictHostKeyChecking=yes");
      expect(command).toContain("BatchMode=yes");
      expect(command).toContain("IdentitiesOnly=yes");
      expect(command).toContain("ForwardAgent=no");
      expect(command).toContain("ClearAllForwardings=yes");
    }
  });

  test("rejects unsafe targets and multiline remote arguments", () => {
    expect(() =>
      buildSshWorkerCommand({
        target: "host;touch /tmp/pwn",
        workerPath: "/tmp/worker",
      }),
    ).toThrow("Unsafe SSH target");
    expect(() => quoteRemoteArgument("/tmp/worker\ncommand")).toThrow(
      "cannot contain",
    );
  });
});
