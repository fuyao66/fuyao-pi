import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { memoryPaths } from './paths.js';

export interface EmbeddingConfig {
  enabled: boolean; autoBackfill: boolean; baseUrl: string; model: string; dimensions: number;
  apiKeyEnv: string; apiKeyFile: string; revision: string;
  timeoutMs: number; maxInputBytes: number; maxBlocks: number; minSimilarity: number;
}
export const defaults: EmbeddingConfig = {
  enabled: false, autoBackfill: false, baseUrl: "", model: "text-embedding-3-large", dimensions: 3072,
  apiKeyEnv: "FUYAO_MEMORY_EMBEDDING_KEY", apiKeyFile: "", revision: "1",
  timeoutMs: 10000, maxInputBytes: 6000, maxBlocks: 10000, minSimilarity: 0.15,
};
const bounded = (x: unknown, fallback: number, min: number, max: number) => typeof x === "number" && Number.isFinite(x) ? Math.max(min, Math.min(max, Math.floor(x))) : fallback;
export function sanitizeEmbeddingConfig(raw: any): EmbeddingConfig {
  const out = { ...defaults };
  if (!raw || typeof raw !== "object") return out;
  out.enabled = raw.enabled === true;
  out.autoBackfill = raw.autoBackfill === true;
  for (const key of ["baseUrl", "model", "apiKeyEnv", "apiKeyFile", "revision"] as const) {
    if (typeof raw[key] === "string") out[key] = raw[key].trim();
  }
  out.dimensions = bounded(raw.dimensions, defaults.dimensions, 1, 8192);
  out.timeoutMs = bounded(raw.timeoutMs, defaults.timeoutMs, 100, 30000);
  out.maxInputBytes = bounded(raw.maxInputBytes, defaults.maxInputBytes, 128, 12000);
  out.maxBlocks = bounded(raw.maxBlocks, defaults.maxBlocks, 1, 10000);
  if (typeof raw.minSimilarity === "number" && Number.isFinite(raw.minSimilarity)) out.minSimilarity = Math.max(0, Math.min(1, raw.minSimilarity));
  if (out.baseUrl) {
    try {
      const url = new URL(out.baseUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
      out.baseUrl = url.href.replace(/\/+$/, "");
    } catch { out.enabled = false; out.baseUrl = ""; }
  }
  return out;
}
export function loadEmbeddingConfig(): EmbeddingConfig {
  // Tests and offline runs must never inherit enabled user configuration.
  if (process.env.FUYAO_MEMORY_EMBEDDING_DISABLED === "1") return { ...defaults };
  try { return sanitizeEmbeddingConfig(JSON.parse(readFileSync(memoryPaths().embeddings, "utf8"))); }
  catch { return { ...defaults }; }
}
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function namespace(config: EmbeddingConfig): string {
  return hash(JSON.stringify([config.baseUrl, config.model, config.dimensions, config.revision, config.maxInputBytes, "redacted-prefix-utf8-v1-normalized-f32le"]));
}
export function prepareText(text: string, config: EmbeddingConfig, redact: (s: string) => string): { text: string; hash: string; truncated: boolean } {
  const clean = redact(text);
  const input = Buffer.from(clean, "utf8");
  let end = Math.min(input.length, config.maxInputBytes);
  // Cut only at a UTF-8 character boundary.
  while (end < input.length && end > 0 && (input[end] & 0xc0) === 0x80) end--;
  const prepared = input.subarray(0, end).toString("utf8");
  return { text: prepared, hash: hash(prepared), truncated: end < input.length };
}
export function normalize(vector: number[], dimensions: number): number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions || vector.some(x => typeof x !== "number" || !Number.isFinite(x))) throw new Error("Invalid embedding vector");
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Invalid embedding norm");
  return vector.map(x => x / norm);
}
export function encodeVector(vector: number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  vector.forEach((x, i) => buffer.writeFloatLE(x, i * 4));
  return buffer;
}
/** Validate/score packed float32 without expanding every vector into JS arrays. */
export function cosineBlob(buffer: Uint8Array, dimensions: number, query?: number[]): number {
  if (!(buffer instanceof Uint8Array) || buffer.byteLength !== dimensions * 4) throw new Error("Invalid stored vector");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let squared = 0, dot = 0;
  for (let i = 0; i < dimensions; i++) {
    const x = view.getFloat32(i * 4, true);
    if (!Number.isFinite(x)) throw new Error("Invalid stored vector");
    squared += x * x;
    if (query) dot += x * query[i];
  }
  if (!Number.isFinite(squared) || squared === 0) throw new Error("Invalid stored vector");
  return query ? dot / Math.sqrt(squared) : 0;
}
export function decodeVector(buffer: Uint8Array, dimensions: number): number[] {
  if (!(buffer instanceof Uint8Array) || buffer.byteLength !== dimensions * 4) throw new Error("Invalid stored vector");
  const data = Buffer.from(buffer);
  return normalize(Array.from({ length: dimensions }, (_, i) => data.readFloatLE(i * 4)), dimensions);
}

export class EmbeddingClient {
  constructor(readonly config: EmbeddingConfig, private fetcher: typeof fetch = fetch) {}
  private key(): string {
    const env = process.env[this.config.apiKeyEnv];
    if (env?.trim()) return env.trim();
    if (this.config.apiKeyFile) {
      try {
        const path = this.config.apiKeyFile.replace(/^~(?=\/|$)/, homedir());
        const key = readFileSync(resolve(path), "utf8").trim();
        if (key) return key;
      } catch { /* Sanitized error below. */ }
    }
    throw new Error("Embedding credential unavailable");
  }
  async embed(input: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!this.config.enabled || !this.config.baseUrl) throw new Error("Embedding disabled or unconfigured");
    if (!input.length || input.length > 8 || input.some(s => !s.trim() || Buffer.byteLength(s) > this.config.maxInputBytes)) throw new Error("Embedding input exceeds bounds");
    const combined = AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(signal ? [signal] : [])]);
    try {
      combined.throwIfAborted();
      const response = await this.fetcher(`${this.config.baseUrl}/embeddings`, {
        method: "POST", redirect: "error", signal: combined,
        headers: { Authorization: `Bearer ${this.key()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.config.model, input, encoding_format: "float" }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Provider status rejected"); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty provider response");
      const chunks: Uint8Array[] = []; let size = 0;
      // Bound the actual decoded body, not just Content-Length.
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 4 * 1024 * 1024) throw new Error("Provider response too large");
          chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(body.data) || body.data.length !== input.length) throw new Error("Invalid provider response");
      const vectors: number[][] = new Array(input.length);
      for (const item of body.data) {
        if (!Number.isInteger(item.index) || item.index < 0 || item.index >= input.length || vectors[item.index]) throw new Error("Invalid provider indexes");
        vectors[item.index] = normalize(item.embedding, this.config.dimensions);
      }
      return vectors;
    } catch {
      // Never relay bodies, keys, paths, query text or provider diagnostics.
      throw new Error(combined.aborted ? "Embedding request cancelled or timed out" : "Embedding request failed");
    }
  }
}
