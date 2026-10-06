import { constants, promises as fs, type Stats } from 'node:fs';
import * as path from 'node:path';

/** Reject symlinks in every component, including the configured root and ancestors. */
export async function realSourcePath(file: string): Promise<void> {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Source path contains a symlink');
  }
}
export function sourceStamp(stat: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }): string {
  return JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]);
}
/** Read a validated regular-file descriptor, not a second path lookup. Best-effort
 * race detection, not a sandbox against an adversarial filesystem actor. */
export async function readSourceFile(file: string): Promise<{ body: string; stat: Stats }> {
  await realSourcePath(file);
  const before = await fs.lstat(file);
  if (!before.isFile()) throw new Error('Source is not a regular file');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (sourceStamp(opened) !== sourceStamp(before)) throw new Error('Source changed before open');
    await realSourcePath(file);
    const body = await handle.readFile('utf8');
    const after = await handle.stat();
    const named = await fs.lstat(file);
    await realSourcePath(file);
    if (sourceStamp(after) !== sourceStamp(opened) || sourceStamp(named) !== sourceStamp(opened)) {
      throw new Error('Source changed during read');
    }
    return { body, stat: opened };
  } finally { await handle.close(); }
}
