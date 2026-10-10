import { promises as fs } from 'node:fs';
import { realSourcePath, readSourceFile, sourceStamp } from './source-files.js';
import type { SourceDocument } from './source-policy.js';

/** Bounded parsed-document cache. Permissions/listing are always refreshed separately. */
export class SourceCache {
  private entries = new Map<string, { stamp: string; value: SourceDocument; bytes: number }>();
  private bytes = 0;
  constructor(private maxEntries = 128, private maxBytes = 8 * 1024 * 1024) {}
  clear(): void { this.entries.clear(); this.bytes = 0; }
  private remove(key: string): void {
    const old = this.entries.get(key);
    if (old) { this.bytes -= old.bytes; this.entries.delete(key); }
  }
  async read(key: string, file: string, parse: (data: unknown, body: string) => SourceDocument): Promise<SourceDocument> {
    try {
      await realSourcePath(file);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular source file');
      const stamp = sourceStamp(stat);
      const cached = this.entries.get(key);
      if (cached?.stamp === stamp) {
        this.entries.delete(key); this.entries.set(key, cached);
        return cached.value;
      }
      this.remove(key);
      const { body, stat: opened } = await readSourceFile(file);
      const value = parse(JSON.parse(body), body);
      if (stamp !== sourceStamp(opened)) {
        return { state: 'missing/unreadable' }; // Atomic replacement raced the read: retry next operation.
      }
      const bytes = Buffer.byteLength(body);
      if (value.state === 'loaded' && bytes <= this.maxBytes) {
        while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
          this.remove(this.entries.keys().next().value!);
        }
        this.entries.set(key, { stamp, value, bytes }); this.bytes += bytes;
      }
      return value;
    } catch { this.remove(key); return { state: 'missing/unreadable' }; }
  }
}
