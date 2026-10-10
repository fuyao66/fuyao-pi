import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Independent Memory-owned paths; never write archives into upstream sessions. */
export function memoryPaths(home = homedir()) {
  const configDir = join(home, '.pi', 'bili-memory');
  return {
    configDir,
    config: join(configDir, 'config.json'),
    embeddings: join(configDir, 'embedding.json'),
    database: join(configDir, 'memory.sqlite'),
    sources: join(configDir, 'sources.jsonl'),
    history: join(configDir, 'history'),
    log: join(configDir, 'memory.log'),
  };
}

/** Match upstream's documented path precedence without importing its runtime. */
export function proxySessionsDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.BILI_SESSIONS_DIR) return resolve(env.BILI_SESSIONS_DIR);
  return join(env.XDG_DATA_HOME ? resolve(env.XDG_DATA_HOME) : join(home, '.local/share'), 'billion-context', 'sessions');
}
