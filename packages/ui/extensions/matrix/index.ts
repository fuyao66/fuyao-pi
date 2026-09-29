import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "sakura-matrix-engine";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "sakura-cyberdeck-matrix.json");
const RESET = "\x1b[0m";
const GLYPHS = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾗﾘﾙﾚﾛﾜﾝ"];
const BG: RGB = [20, 17, 26];
const TEXT: RGB = [247, 238, 248];
const CANDY: readonly RGB[] = [
  [242, 167, 198], // sakura
  [252, 201, 185], // sakura-iro
  [239, 195, 230], // petal
  [199, 184, 245], // lavender
  [159, 211, 242], // sky
  [174, 229, 197], // mint
];
const WORKING_INDICATOR = "◆";
const PHASE_MESSAGES: Record<Phase, string> = {
  thinking: "Weaving the next move…",
  working: "Composing the response…",
  tool: "Running tools…",
};

type RGB = readonly [number, number, number];
type Phase = "thinking" | "working" | "tool";
type Timer = ReturnType<typeof setTimeout>;

interface MatrixConfig {
  enabled: boolean;
  fps: number;
  density: number;
  height: number;
}

interface Drop {
  x: number;
  offset: number;
  speed: number;
  length: number;
  gap: number;
  seed: number;
  color: RGB;
}

const DEFAULT_CONFIG: MatrixConfig = {
  enabled: true,
  fps: 10,
  density: 0.65,
  height: 4,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadConfig(): MatrixConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<MatrixConfig>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
      fps: clamp(Number(parsed.fps) || DEFAULT_CONFIG.fps, 8, 18),
      density: clamp(Number(parsed.density) || DEFAULT_CONFIG.density, 0.45, 0.95),
      height: clamp(Math.round(Number(parsed.height) || DEFAULT_CONFIG.height), 3, 6),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config: MatrixConfig): void {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(from: RGB, to: RGB, amount: number): RGB {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

function colorize(char: string, color: RGB, bold = false): string {
  return `\x1b[${bold ? "1;" : ""}38;2;${color[0]};${color[1]};${color[2]}m${char}${RESET}`;
}

function workingIndicatorFrame(): string {
  return colorize(WORKING_INDICATOR, CANDY[0] ?? [242, 167, 198], true);
}

function stableGlyph(seed: number, row: number, timeSlice: number): string {
  let hash = Math.imul(seed ^ (row + 17), 0x45d9f3b);
  hash = Math.imul(hash ^ timeSlice, 0x45d9f3b);
  hash ^= hash >>> 16;
  return GLYPHS[Math.abs(hash) % GLYPHS.length] ?? "0";
}

export function createDrops(width: number, density: number, height: number): Drop[] {
  const random = mulberry32((width * 2654435761) ^ 0x53414b55);
  const columns = Array.from({ length: Math.ceil(width / 2) }, (_, index) => index * 2);
  const active = columns.filter(() => random() < density);
  const selected = active.length >= 8 ? active : columns.slice(0, Math.min(columns.length, 8));
  return selected.slice(0, 96).map((x, index) => {
    const length = 3 + Math.floor(random() * 5);
    const gap = 1 + Math.floor(random() * 5);
    const cycle = height + length + gap;
    return {
      x,
      offset: random() * cycle,
      speed: 5.5 + random() * 7.5,
      length,
      gap,
      seed: Math.floor(random() * 0x7fffffff) ^ (index * 7919),
      color: CANDY[index % CANDY.length] ?? [242, 167, 198],
    };
  });
}

export function renderSakuraMatrix(
  width: number,
  height: number,
  elapsedSeconds: number,
  phase: Phase,
  drops: readonly Drop[],
): string[] {
  const safeWidth = Math.max(1, width);
  const safeHeight = clamp(height, 3, 6);
  const grid: string[][] = Array.from({ length: safeHeight }, () => Array(safeWidth).fill(" "));
  const timeSlice = Math.floor(elapsedSeconds * 8);
  const phaseSpeed = phase === "tool" ? 1.12 : phase === "thinking" ? 1.06 : 1;

  for (const drop of drops) {
    const cycle = safeHeight + drop.length + drop.gap;
    const head = ((drop.offset + elapsedSeconds * drop.speed * phaseSpeed) % cycle) - drop.gap;
    for (let trail = 0; trail < drop.length; trail++) {
      const row = Math.floor(head - trail);
      if (row < 0 || row >= safeHeight || drop.x >= safeWidth) continue;
      const glyph = stableGlyph(drop.seed + trail * 97, row, timeSlice);
      const color = trail === 0
        ? mix(drop.color, TEXT, 0.58)
        : trail === 1
          ? drop.color
          : mix(drop.color, BG, clamp((trail - 1) * 0.16, 0, 0.72));
      const gridRow = grid[row];
      if (gridRow) gridRow[drop.x] = colorize(glyph, color, trail <= 1);
    }
  }

  return grid.map((row) => `${row.join("")}${RESET}`);
}

export default function sakuraMatrixExtension(pi: ExtensionAPI): void {
  const config = loadConfig();
  let activeContext: ExtensionContext | undefined;
  let phase: Phase = "working";
  let active = false;
  let timer: Timer | undefined;
  let startedAt = 0;
  let nextDeadline = 0;
  let lastHostUpdateAt = 0;
  let frame = 0;
  let generation = 0;
  let requestRender: (() => void) | undefined;
  let cachedKey = "";
  let cachedLines: string[] = [];
  const dropsByWidth = new Map<number, Drop[]>();

  const invalidate = () => {
    cachedKey = "";
    cachedLines = [];
  };

  const component = {
    render(width: number): string[] {
      const safeWidth = Math.max(1, width);
      const key = `${safeWidth}:${config.height}:${frame}:${phase}`;
      if (key === cachedKey) return cachedLines;
      let drops = dropsByWidth.get(safeWidth);
      if (!drops) {
        drops = createDrops(safeWidth, config.density, config.height);
        if (dropsByWidth.size >= 4) {
          dropsByWidth.delete(dropsByWidth.keys().next().value ?? safeWidth);
        }
        dropsByWidth.set(safeWidth, drops);
      }
      cachedLines = renderSakuraMatrix(
        safeWidth,
        config.height,
        Math.max(0, performance.now() - startedAt) / 1000,
        phase,
        drops,
      );
      cachedKey = key;
      return cachedLines;
    },
    invalidate(): void {
      dropsByWidth.clear();
      invalidate();
    },
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (token: number) => {
    if (!active || token !== generation) return;
    const frameMs = 1000 / config.fps;
    const now = performance.now();
    if (now - nextDeadline > frameMs * 3) nextDeadline = now;
    nextDeadline += frameMs;
    timer = setTimeout(() => {
      if (!active || token !== generation) return;
      frame += 1;
      invalidate();
      // Streaming and tool updates already schedule a host render. Avoid adding
      // a second full TUI pass when one occurred within this frame window.
      if (performance.now() - lastHostUpdateAt >= frameMs) requestRender?.();
      schedule(token);
    }, Math.max(16, nextDeadline - performance.now()));
    timer.unref?.();
  };

  const stop = () => {
    generation += 1;
    active = false;
    clearTimer();
    const ctx = activeContext;
    activeContext = undefined;
    requestRender = undefined;
    lastHostUpdateAt = 0;
    invalidate();
    if (!ctx) return;
    try {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      ctx.ui.setWorkingMessage();
      ctx.ui.setWorkingIndicator();
      ctx.ui.setWorkingVisible(true);
    } catch {
      // UI may already be disposed during shutdown; cleanup remains idempotent.
    }
  };

  const start = (ctx: ExtensionContext, initialPhase: Phase = "working") => {
    stop();
    if (!config.enabled || ctx.mode !== "tui") return;
    activeContext = ctx;
    active = true;
    phase = initialPhase;
    frame = 0;
    startedAt = performance.now();
    nextDeadline = startedAt;
    lastHostUpdateAt = 0;
    dropsByWidth.clear();
    invalidate();
    const token = generation;
    ctx.ui.setWorkingVisible(true);
    // The matrix owns the only animation clock; a static indicator prevents a
    // second independent timer from forcing redundant full-screen renders.
    ctx.ui.setWorkingIndicator({ frames: [workingIndicatorFrame()] });
    ctx.ui.setWorkingMessage(PHASE_MESSAGES[phase]);
    ctx.ui.setWidget(WIDGET_KEY, (tui) => {
      requestRender = () => tui.requestRender();
      return component;
    });
    schedule(token);
  };

  const noteHostUpdate = () => {
    lastHostUpdateAt = performance.now();
  };

  const setPhase = (next: Phase) => {
    noteHostUpdate();
    if (!active || phase === next) return;
    phase = next;
    activeContext?.ui.setWorkingMessage(PHASE_MESSAGES[phase]);
    frame += 1;
    invalidate();
  };

  pi.on("agent_start", (_event, ctx) => start(ctx));
  pi.on("agent_end", () => stop());
  pi.on("session_switch", () => stop());
  pi.on("session_shutdown", () => stop());

  pi.on("message_update", (event) => {
    noteHostUpdate();
    const streamEvent = event.assistantMessageEvent as { type?: string } | undefined;
    if (!streamEvent?.type) return;
    if (streamEvent.type === "thinking_start" || streamEvent.type === "thinking_delta") {
      setPhase("thinking");
    } else if (streamEvent.type === "thinking_end" || streamEvent.type === "text_delta") {
      setPhase("working");
    }
  });

  pi.on("tool_execution_start", () => setPhase("tool"));
  pi.on("tool_execution_update", () => noteHostUpdate());
  pi.on("tool_execution_end", () => setPhase("working"));

  pi.registerCommand("sakura-matrix", {
    description: "Sakura Matrix animation: status, on, off, preview, fps <8-18>, density <0.45-0.95>",
    handler: async (args, ctx) => {
      const [command = "status", value] = args.trim().toLowerCase().split(/\s+/);
      if (command === "on") {
        config.enabled = true;
        saveConfig(config);
        ctx.ui.notify("Sakura Matrix enabled", "info");
        return;
      }
      if (command === "off") {
        config.enabled = false;
        saveConfig(config);
        stop();
        ctx.ui.notify("Sakura Matrix disabled", "info");
        return;
      }
      if (command === "preview") {
        start(ctx, "thinking");
        const previewToken = generation;
        const previewTimer = setTimeout(() => {
          if (generation === previewToken) stop();
        }, 5000);
        previewTimer.unref?.();
        ctx.ui.notify("Sakura Matrix preview: 5 seconds", "info");
        return;
      }
      if (command === "fps") {
        const fps = Number(value);
        if (!Number.isFinite(fps) || fps < 8 || fps > 18) {
          ctx.ui.notify("Usage: /sakura-matrix fps <8-18>", "error");
          return;
        }
        config.fps = Math.round(fps);
        saveConfig(config);
        ctx.ui.notify(`Sakura Matrix FPS: ${config.fps}`, "info");
        return;
      }
      if (command === "density") {
        const density = Number(value);
        if (!Number.isFinite(density) || density < 0.45 || density > 0.95) {
          ctx.ui.notify("Usage: /sakura-matrix density <0.45-0.95>", "error");
          return;
        }
        config.density = Math.round(density * 100) / 100;
        dropsByWidth.clear();
        saveConfig(config);
        ctx.ui.notify(`Sakura Matrix density: ${config.density}`, "info");
        return;
      }
      ctx.ui.notify(
        `Sakura Matrix: ${config.enabled ? "on" : "off"} · ${config.fps} FPS · ${config.height} lines · density ${config.density}`,
        "info",
      );
    },
  });
}
