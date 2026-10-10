import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { DefaultResourceLoader, SettingsManager, SessionManager, createAgentSession, buildSessionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

const profile = process.env.FUYAO_TEST_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
const goalPath = process.env.FUYAO_TEST_GOAL_DIR ?? join(profile, "npm/node_modules/@narumitw/pi-goal");
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const reply = (text: string): AssistantMessage => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "test", model: "test", timestamp: Date.now(), stopReason: "stop", usage });

// Mirrors Schovest 0.2.0's canonical state; no production sessions or models.
// Wire compression is covered by scripts/verify-billion-context.mjs. This test
// owns Goal persistence/cancellation and does not load a second legacy compressor.
for (const goalFirst of [false]) {
  test('community Goal restores state, completes and pauses without the legacy compressor', async () => {
    const dir = await mkdtemp(join(tmpdir(), "fuyao-goal-bcp-"));
    const saved = { ...process.env };
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    try {
      process.env.PI_CODING_AGENT_DIR = dir;
      process.env.ACP_LOG_FILE = join(dir, "acp.log");
      process.env.ACP_AUTO_UPDATE = "0";
      const sm = SessionManager.create(dir, join(dir, "sessions"));
      sm.appendMessage({ role: "user", content: "Protected initial objective", timestamp: 1 });
      sm.appendMessage(reply("RAW_FOLDED_EVIDENCE " + "synthetic ".repeat(3000)));
      sm.appendMessage(reply("Consumed " + "synthetic ".repeat(1000)));
      for (let i = 0; i < 12; i++) {
        sm.appendMessage({ role: "user", content: `Recent task ${i} ` + "current ".repeat(1000), timestamp: i + 2 });
        sm.appendMessage(reply("recent ".repeat(1000)));
      }
      const goal = { id: "fixture-goal", text: "GOAL_OBJECTIVE_UNIQUE complete isolated task", status: "active", startedAt: Date.now(), updatedAt: Date.now(), iteration: 1, tokensUsed: 0, timeUsedSeconds: 0, baselineTokens: 0, automaticModelTurns: 0, toolFreeRepeatCount: 0 };
      sm.appendCustomEntry("goal-state", { goal });
      const settingsManager = SettingsManager.inMemory({ packages: [goalPath] });
      const resourceLoader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
      await resourceLoader.reload();
      expect(resourceLoader.getExtensions().errors).toEqual([]);
      expect(resourceLoader.getExtensions().warnings ?? []).toEqual([]);
      ({ session } = await createAgentSession({ cwd: dir, agentDir: dir, settingsManager, resourceLoader, sessionManager: sm }));
      const errors: string[] = [];
      await session.bindExtensions({ mode: "print", onError: e => errors.push(e.error) });
      const queued: unknown[] = [];
      const captureFollowUps = () => { resourceLoader.getExtensions().runtime.sendUserMessage = (content, options) => { queued.push({ content, options }); }; };
      captureFollowUps();
      const state = () => {
        const entry = sm.getBranch().filter(e => e.type === "custom" && e.customType === "goal-state").at(-1);
        return entry?.type === "custom" ? (entry.data as { goal: { id: string; status: string } | null }).goal : undefined;
      };
      expect(state()).toMatchObject({ id: goal.id, status: "active" });
      for (const name of ["goal_complete", "goal_blocked", "goal_wait"]) expect(session.getActiveToolNames()).toContain(name);
      const runner = session.extensionRunner;
      expect(JSON.stringify(await runner.emitContext(buildSessionContext(sm.getEntries(), sm.getLeafId()).messages))).toContain("GOAL_OBJECTIVE_UNIQUE");
      await runner.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });
      await runner.emitBeforeAgentStart("user continuing task", undefined, { cwd: dir });
      await runner.emit({ type: "agent_start" });
      await runner.emit({ type: "agent_end", messages: [reply("intermediate progress")] });
      await runner.emit({ type: "agent_settled", aborted: false });
      expect(queued).toHaveLength(1);
      await runner.emit({ type: "agent_settled", aborted: false });
      expect(queued).toHaveLength(1);
      await session.reload();
      captureFollowUps();
      expect(state()).toMatchObject({ id: goal.id, status: "active" });
      await session.getToolDefinition("goal_complete")!.execute("finish", { goal_id: goal.id, summary: "Verified task complete." }, undefined, undefined, session.extensionRunner.createToolContext("finish", undefined));
      expect(state()).toBeNull();
      const done = reply("done");
      const doneId = sm.appendMessage(done);
      await session.extensionRunner.emitBoundary({ type: "turn_end", turnIndex: 1, message: done,
        toolResults: [], messageEntryId: doneId, toolResultEntryIds: [], outcome: "completed" }, () => ({
        contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: [], canContinue: true,
      }));
      const completed = JSON.stringify(await session.extensionRunner.emitContext(buildSessionContext(sm.getEntries(), sm.getLeafId()).messages));
      expect(completed).toContain("Goal mode is inactive.");
      await session.extensionRunner.emit({ type: "agent_end", messages: [reply("done")] });
      await session.extensionRunner.emit({ type: "agent_settled", aborted: false });
      expect(queued).toHaveLength(1);
      // Escape/cancellation must pause the goal rather than enqueue more work.
      sm.appendCustomEntry("goal-state", { goal });
      await session.reload();
      captureFollowUps();
      await session.extensionRunner.emitBeforeAgentStart("cancel test", undefined, { cwd: dir });
      await session.extensionRunner.emit({ type: "agent_start" });
      await session.extensionRunner.emit({ type: "agent_end", messages: [{ ...reply("cancelled"), stopReason: "aborted" }] });
      await session.extensionRunner.emit({ type: "agent_settled", aborted: true });
      expect(state()).toMatchObject({ id: goal.id, status: "paused" });
      expect(queued).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      if (session) { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); }
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      await rm(dir, { recursive: true, force: true });
    }
  });
}
