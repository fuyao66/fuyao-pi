import { constants, promises as fs } from 'node:fs';
import { realSourcePath, readSourceFile, sourceStamp } from './source-files.js';

export interface BiliSession { conversationId: string; sessionId: string; sessionRevision: string | null }
export interface BiliIdentity {
  conversationId: string;
  sessionId: string;
  parentRevision: string;
  orderHash: string;
  messages: ReadonlyArray<{ rawId: string; ref: string; identityHash: string }>;
}
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** Status has no snapshot protocol/exact fields. Never accept a latest fallback. */
export function parseBiliSession(value: unknown, conversationId: string): BiliSession | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!conversationId || v.ok !== true || v.conversationId !== conversationId ||
      typeof v.sessionId !== 'string' || !v.sessionId ||
      (v.fallback !== undefined && v.fallback !== false) ||
      (v.sessionRevision !== null && !digest(v.sessionRevision))) return null;
  return { conversationId, sessionId: v.sessionId, sessionRevision: v.sessionRevision as string | null };
}
/** Raw fork snapshot proves message identities, not the model-visible context. */
export function parseBiliIdentity(value: unknown, conversationId: string): BiliIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!conversationId || v.ok !== true || v.status !== 'exact' || v.protocolVersion !== 1 ||
      v.conversationId !== conversationId || typeof v.sessionId !== 'string' || !v.sessionId ||
      !digest(v.parentRevision) || !digest(v.orderHash) || !Array.isArray(v.orderedMessages)) return null;
  const rawIds = new Set<string>(); const refs = new Set<string>();
  const messages: Array<{ rawId: string; ref: string; identityHash: string }> = [];
  for (const item of v.orderedMessages) {
    if (!item || typeof item !== 'object' || typeof item.rawId !== 'string' || !item.rawId ||
        typeof item.ref !== 'string' || !/^m\d{5,}$/.test(item.ref) || !digest(item.identityHash) ||
        rawIds.has(item.rawId) || refs.has(item.ref)) return null;
    rawIds.add(item.rawId); refs.add(item.ref);
    messages.push({ rawId: item.rawId, ref: item.ref, identityHash: item.identityHash });
  }
  return { conversationId, sessionId: v.sessionId, parentRevision: v.parentRevision, orderHash: v.orderHash, messages };
}
export function nativeSessionId(doc: any): string | null {
  return doc?.version === 3 && typeof doc.id === 'string' && !!doc.id &&
    doc.payload?.version === 3 && doc.payload?.id === doc.id && Array.isArray(doc.payload?.state?.blocks) ? doc.id : null;
}
export function foreignBiliFile(file: string): boolean { return file.endsWith('.content-store.json'); }
export interface BiliFileListing { files: string[]; complete: boolean }
export interface BiliLocatedFile { file: string; stamp: string }

/** Metadata only: no raw history is retained. Every operation refreshes listing,
 * permission and full stat identity before using cached IDs, including duplicates. */
export class BiliSessionLocator {
  private entries = new Map<string, { stamp: string; id: string | null }>();
  constructor(private maxEntries = 1024, private maxFileBytes = 32 * 1024 * 1024,
    private maxReadBytes = 128 * 1024 * 1024, private read = readSourceFile) {}
  clear(): void { this.entries.clear(); }
  async locate(listing: BiliFileListing, sessionId: string, current: () => boolean = () => true): Promise<BiliLocatedFile | null> {
    const files = [...new Set(listing.files)].filter(file => !foreignBiliFile(file));
    if (!sessionId || !listing.complete || files.length > this.maxEntries || !current()) { this.clear(); return null; }
    const allowed = new Set(files);
    for (const file of this.entries.keys()) if (!allowed.has(file)) this.entries.delete(file);
    let found: BiliLocatedFile | null = null, bytes = 0, incomplete = false;
    for (const file of files) {
      if (!current()) return null;
      try {
        await realSourcePath(file); await fs.access(file, constants.R_OK);
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular session');
        const stamp = sourceStamp(stat);
        let entry = this.entries.get(file);
        if (entry?.stamp !== stamp) {
          this.entries.delete(file);
          bytes += stat.size;
          if (stat.size > this.maxFileBytes || bytes > this.maxReadBytes) { incomplete = true; continue; }
          const opened = await this.read(file, this.maxFileBytes);
          if (sourceStamp(opened.stat) !== stamp || !current()) { incomplete = true; continue; }
          entry = { stamp, id: nativeSessionId(JSON.parse(opened.body)) };
          this.entries.set(file, entry);
        }
        if (entry.id === sessionId) {
          if (found) return null; // Not first wins, even after a previous cached match.
          found = { file, stamp };
        }
      } catch { this.entries.delete(file); incomplete = true; }
    }
    return !incomplete && current() ? found : null;
  }
}
/** Offline/test convenience; a live collector owns a persistent locator. */
export async function findBiliSessionFile(files: readonly string[], sessionId: string): Promise<string | null> {
  return (await new BiliSessionLocator().locate({ files: [...files], complete: true }, sessionId))?.file ?? null;
}
