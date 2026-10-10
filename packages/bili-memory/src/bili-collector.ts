import { fetchBiliIdentity, localBiliOrigin } from './bili-client.js';
import { findBiliSessionFile, type BiliIdentity } from './bili-identity.js';
import { BiliProjectEvidence, type BiliMessageEvidence } from './bili-project-evidence.js';
import type { ProjectScope } from './project-scope.js';

interface CollectorOptions {
  conversationId: string;
  origin(): string | undefined;
  scope(): ProjectScope;
  current(): boolean;
  files(): Promise<string[]>;
  // Store implementation must apply its own session-generation check after I/O.
  ingest(file: string): Promise<boolean>;
  saveEvidence(file: string, evidence: BiliMessageEvidence[]): void;
  identity?: typeof fetchBiliIdentity;
}

/** One collector per Pi session. Serialized scans never guess a "latest" proxy
 * session. Missing files are retried by the host scheduler after persistence. */
export class BiliCollector {
  private evidence = new BiliProjectEvidence();
  private controller = new AbortController();
  private running = false;
  private pending?: { sessionId: string; rows: BiliMessageEvidence[] };
  constructor(private options: CollectorOptions) {}
  observeScope(scope: ProjectScope): void { this.evidence.observeScope(scope); }
  stop(): void { this.controller.abort(); }
  private current(): boolean { return !this.controller.signal.aborted && this.options.current(); }
  async scan(): Promise<'stored' | 'unavailable' | 'busy' | 'expired'> {
    if (!this.current()) return 'expired';
    if (this.running) return 'busy';
    this.running = true;
    const scope = this.options.scope();
    this.evidence.observeScope(scope);
    const valid = () => this.current() && this.options.scope().stamp === scope.stamp;
    try {
      const origin = localBiliOrigin(this.options.origin());
      const identity: BiliIdentity | null = origin
        ? await (this.options.identity ?? fetchBiliIdentity)(origin, this.options.conversationId, this.controller.signal) : null;
      if (!valid()) { this.evidence.unavailable(); return 'expired'; }
      if (!identity) { this.evidence.unavailable(); return 'unavailable'; }
      const files = await this.options.files();
      if (!valid()) { this.evidence.unavailable(); return 'expired'; }
      const file = await findBiliSessionFile(files, identity.sessionId);
      if (!valid()) { this.evidence.unavailable(); return 'expired'; }
      if (!file) { this.evidence.unavailable(); return 'unavailable'; }
      if (!await this.options.ingest(file)) { this.evidence.unavailable(); return 'unavailable'; }
      if (!valid()) { this.evidence.unavailable(); return 'expired'; }
      const staged = this.evidence.copy();
      const rows = staged.capture(identity, scope);
      // A failed DB transaction must not lose evidence already observed. Reuse
      // only the exact session/message revision, not a later reused raw id.
      if (this.pending?.sessionId === identity.sessionId) {
        const previous = new Map(this.pending.rows.map(row => [row.rawId, row]));
        for (const row of rows) {
          const saved = previous.get(row.rawId);
          if (saved?.identityHash === row.identityHash) row.projectId = saved.projectId;
        }
      }
      this.pending = { sessionId: identity.sessionId, rows };
      this.options.saveEvidence(file, rows);
      this.pending = undefined;
      this.evidence = staged;
      return 'stored';
    } catch (error) {
      this.evidence.unavailable();
      if (!this.current()) return 'expired';
      throw error;
    } finally { this.running = false; }
  }
}
