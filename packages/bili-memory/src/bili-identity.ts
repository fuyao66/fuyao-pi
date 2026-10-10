import { readSourceFile } from './source-files.js';

export interface BiliIdentity {
  conversationId: string;
  sessionId: string;
  messages: ReadonlyArray<{ rawId: string; ref: string; identityHash: string }>;
}

/** Only accept the exact public snapshot contract, never a latest-session fallback. */
export function parseBiliIdentity(value: unknown, conversationId: string): BiliIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!conversationId || v.ok !== true || v.status !== 'exact' || v.protocolVersion !== 1 ||
      v.conversationId !== conversationId || typeof v.sessionId !== 'string' || !v.sessionId ||
      !Array.isArray(v.orderedMessages)) return null;
  const rawIds = new Set<string>();
  const refs = new Set<string>();
  const messages: Array<{ rawId: string; ref: string; identityHash: string }> = [];
  for (const item of v.orderedMessages) {
    if (!item || typeof item !== 'object' || typeof item.rawId !== 'string' || !item.rawId ||
        typeof item.ref !== 'string' || !/^m\d{5,}$/.test(item.ref) ||
        typeof item.identityHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.identityHash) ||
        rawIds.has(item.rawId) || refs.has(item.ref)) return null;
    rawIds.add(item.rawId); refs.add(item.ref);
    messages.push({ rawId: item.rawId, ref: item.ref, identityHash: item.identityHash });
  }
  return { conversationId, sessionId: v.sessionId, messages };
}

/** Caller supplies already allow-listed files. Names/hosts/cwd are not identity evidence. */
export async function findBiliSessionFile(files: readonly string[], sessionId: string): Promise<string | null> {
  if (!sessionId) return null;
  let found: string | null = null;
  for (const file of new Set(files)) {
    try {
      const { body } = await readSourceFile(file);
      const doc = JSON.parse(body);
      if (doc.version !== 3 || doc.id !== sessionId || doc.payload?.id !== sessionId ||
          doc.payload?.version !== 3 || !Array.isArray(doc.payload?.state?.blocks)) continue;
      // Two eligible records claiming the same identity are ambiguous, not "first wins".
      if (found) return null;
      found = file;
    } catch { /* Missing, encrypted or malformed persistence is not identity evidence. */ }
  }
  return found;
}
