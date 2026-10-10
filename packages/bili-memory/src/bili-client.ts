import { parseBiliIdentity, parseBiliSession, type BiliIdentity, type BiliSession } from './bili-identity.js';

/** Control-plane identities must never go to a model/provider endpoint. */
export function localBiliOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' || !['127.0.0.1','[::1]','localhost'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}

async function controlJson(origin: string, conversationId: string, endpoint: 'status' | 'snapshot', budget: number, signal?: AbortSignal): Promise<unknown> {
  const local = localBiliOrigin(origin);
  if (!local || !conversationId || signal?.aborted) return null;
  try {
    // In particular: no fallback=latest. A 200 response is not an identity proof.
    const response = await fetch(`${local}/__bili/plugin/${endpoint}?conversationId=${encodeURIComponent(conversationId)}`, {
      redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > budget) { await reader.cancel(); return null; }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return null; }
}

/** Exact conversation mapping works even when image/opaque history cannot fork. */
export async function fetchBiliSession(origin: string, conversationId: string, signal?: AbortSignal): Promise<BiliSession | null> {
  return parseBiliSession(await controlJson(origin, conversationId, 'status', 1024 * 1024, signal), conversationId);
}
/** Raw snapshot is used only for attribution, never as the model-visible context. */
export async function fetchBiliIdentity(origin: string, conversationId: string, signal?: AbortSignal): Promise<BiliIdentity | null> {
  return parseBiliIdentity(await controlJson(origin, conversationId, 'snapshot', 16 * 1024 * 1024, signal), conversationId);
}
