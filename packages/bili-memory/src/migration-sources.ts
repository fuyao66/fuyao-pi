import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** One-time legacy policy capture, not a new runtime source adapter. A missing
 * default file means the old built-in roots; an explicit missing file requires
 * review rather than silently widening permissions. */
export async function captureLegacySources(config: { sourcesPath?: unknown }, home: string): Promise<string> {
  const explicit = config.sourcesPath;
  if (explicit !== undefined && (typeof explicit !== 'string' || !explicit.trim())) {
    throw new Error('Invalid legacy sourcesPath');
  }
  const file = typeof explicit === 'string'
    ? explicit.startsWith('~/') ? join(home, explicit.slice(2)) : resolve(explicit)
    : join(home, '.pi/pi-billion-memory.sources.jsonl');
  try { return await readFile(file, 'utf8'); }
  catch (error) {
    if (explicit !== undefined || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return [
    { id: 'pi', adapter: 'pi-sidecar', root: join(home, '.pi/agent/sessions'), pattern: '**/*.jsonl.acp.json', enabled: true },
    { id: 'opencode', adapter: 'opencode-acp', root: join(home, '.local/share/opencode/storage/plugin/acp'),
      pattern: 'ses_*.json', enabled: true, opencodeDb: join(home, '.local/share/opencode/opencode.db') },
  ].map(rule => JSON.stringify(rule)).join('\n') + '\n';
}
