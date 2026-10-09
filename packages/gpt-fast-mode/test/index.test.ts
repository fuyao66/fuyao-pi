import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fastMode, { SUPPORTED_MODELS, shouldApplyFastMode, withFastServiceTier, loadSupportedModels, loadDefaultEnabled, loadShortcuts } from "../src/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mergeProfile } from "../../../scripts/setup.ts";

const model = { provider: "cpa", id: "gpt-5.6-sol" };
const payload = { model: model.id, messages: [{ role: "user", content: "fixture" }] };

test("only explicit user models match; official, non-GPT, unknown and mismatched requests stay untouched", () => {
  expect(SUPPORTED_MODELS.size).toBe(8);
  for (const key of SUPPORTED_MODELS) {
    const separator = key.indexOf("/");
    const provider = key.slice(0, separator), id = key.slice(separator + 1);
    expect(["cpa", "cpa-any"]).toContain(provider);
    expect(shouldApplyFastMode({ provider, id }, { model: id })).toBe(true);
  }
  for (const provider of ["openai", "openai-codex", "cpa-any"]) expect(shouldApplyFastMode({ ...model, provider }, payload)).toBe(false);
  for (const id of ["claude-opus-5", "grok-4.7", "gpt-unknown"]) expect(shouldApplyFastMode({ provider: "cpa", id }, { model: id })).toBe(false);
  for (const invalid of [null, [], "payload", { model: "different" }, {}]) expect(shouldApplyFastMode(model, invalid)).toBe(false);
  const result = withFastServiceTier(payload);
  expect(result).toEqual({ ...payload, service_tier: "priority" });
  expect(result).not.toBe(payload);
  expect(payload).not.toHaveProperty("service_tier");
  expect(withFastServiceTier({ ...payload, service_tier: "flex" })).toEqual({ ...payload, service_tier: "priority" });
});

test("settings allowlist replaces defaults, invalid and empty lists fail closed", () => {
  const options = (block: unknown) => ({ env: { PI_CODING_AGENT_DIR: "/isolated" }, readFile: () => JSON.stringify({ "pi-gpt-fast-mode": block }) });
  expect([...loadSupportedModels(options({ enabled: false }))]).toEqual([...SUPPORTED_MODELS]);
  expect(loadDefaultEnabled(options({ enabled: true }))).toBe(true);
  expect([...loadSupportedModels(options({ models: ["cpa/new-gpt", "cpa/new-gpt"] }))]).toEqual(["cpa/new-gpt"]);
  for (const models of [[], "*", ["cpa/*"], ["bad"], [null], ["/gpt"], ["cpa/gpt "]]) expect(loadSupportedModels(options({ models })).size).toBe(0);
  expect(loadShortcuts({ env: { PI_CODING_AGENT_DIR: "/isolated" }, readFile: () => '{"pi-gpt-fast-mode":[]}' })).toEqual([]);
});

test("upstream declarations migrate to local once without duplicate commands", () => {
  const sources = ["npm:billion-context-pi@fixture"];
  const first = mergeProfile({ packages: ["npm:@tunnckocore/pi-gpt-fast-mode@0.4.0", "git:github.com/tunnckoCore/pi-gpt-fast-mode", "npm:unrelated"] }, {}, sources, "/repo", "/agent");
  expect(first.packages?.filter(e => JSON.stringify(e).includes("gpt-fast-mode"))).toEqual(["/repo/packages/gpt-fast-mode"]);
  expect(mergeProfile(first, {}, sources, "/repo", "/agent")).toEqual(first);
});

test("toggle defaults off, resets on session start and keeps request behavior independent of UI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fuyao-fast-unit-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    await writeFile(join(dir, "settings.json"), "{}");
    await writeFile(join(dir, "keybindings.json"), '{"pi-gpt-fast-mode":[]}');
    const handlers = new Map<string, (...args: any[]) => any>();
    const commands = new Map<string, { handler: (...args: any[]) => any }>();
    fastMode({ registerCommand: (name: string, c: any) => commands.set(name, c), registerShortcut: () => { throw new Error("shortcuts disabled"); }, on: (name: string, h: any) => handlers.set(name, h) } as unknown as ExtensionAPI);
    expect([...commands.keys()]).toEqual(["fast"]);
    expect([...handlers.keys()]).toEqual(["session_start", "model_select", "session_shutdown", "before_provider_request"]);
    const ctx = { mode: "print", model, ui: { notify: () => {}, setStatus: () => { throw new Error("headless status must not be set"); } } };
    const request = () => handlers.get("before_provider_request")!({ payload }, ctx);
    expect(request()).toBeUndefined();
    await commands.get("fast")!.handler("", ctx);
    expect(request()).toEqual({ ...payload, service_tier: "priority" });
    await commands.get("fast")!.handler("", ctx);
    expect(request()).toBeUndefined();
    await commands.get("fast")!.handler("", ctx);
    handlers.get("session_start")!({}, ctx);
    expect(request()).toBeUndefined();
    handlers.get("model_select")!({ model }, ctx);
    handlers.get("session_shutdown")!({}, ctx);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
