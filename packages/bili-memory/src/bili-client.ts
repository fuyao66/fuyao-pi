import { parseBiliIdentity, type BiliIdentity } from './bili-identity.js';

/** Native Pi publishes its live proxy origin here. Only local control-plane
 * endpoints are supported; never send session identities to a model base URL. */
export function localBiliOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' || !['127.0.0.1','[::1]','localhost'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}

/** The raw snapshot is used solely for identities, never for model context.
 * Read a bounded body; an unavailable/opaque snapshot fails closed. */
export async function fetchBiliIdentity(origin: string, conversationId: string, signal?: AbortSignal): Promise<BiliIdentity | null> {
  const local = localBiliOrigin(origin);
  if (!local || !conversationId || signal?.aborted) return null;
  try {
    const response = await fetch(`${local}/__bili/plugin/snapshot?conversationId=${encodeURIComponent(conversationId)}`, {
      redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > 16 * 1024 * 1024) { await reader.cancel(); return null; }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return parseBiliIdentity(JSON.parse(Buffer.concat(chunks).toString('utf8')), conversationId);
  } catch { return null; }
}
