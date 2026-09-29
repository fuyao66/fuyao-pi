import { createInterface } from "node:readline";
import {
  PROTOCOL_VERSION,
  encodeMessage,
} from "../../src/protocol.ts";

const keepAlive = setInterval(() => {}, 60_000);
const FIXTURE_TOOLS = ["read"];
const FIXTURE_VERSION = "fixture";
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const request = JSON.parse(line) as {
    type?: string;
    cwd?: string;
    hostVersion?: string;
    ompVersion?: string;
  };
  if (request.type !== "initialize") continue;
  const hostVersion = request.hostVersion ?? request.ompVersion ?? "test";
  process.stdout.write(
    encodeMessage({
      type: "ready",
      protocolVersion: PROTOCOL_VERSION,
      host: "pi",
      ompVersion: hostVersion,
      hostVersion,
      runtimeVersion: FIXTURE_VERSION,
      cwd: request.cwd ?? process.cwd(),
      tools: FIXTURE_TOOLS.map((name) => ({
        name,
        description: name,
        parameters: { type: "object" },
      })),
    }),
  );
}

void keepAlive;
