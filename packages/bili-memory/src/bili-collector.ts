import { fetchBiliIdentity, fetchBiliSession, localBiliOrigin } from './bili-client.js';
import { BiliSessionLocator, type BiliIdentity, type BiliSession, type BiliFileListing } from './bili-identity.js';
import { BiliProjectEvidence, type BiliMessageEvidence } from './bili-project-evidence.js';
import type { ProjectScope } from './project-scope.js';

interface CollectorOptions {
  conversationId: string;
  origin(): string | undefined;
  scope(): ProjectScope;
  current(): boolean;
  files(): Promise<BiliFileListing>;
  // The store checks both expected identity/stamp and the full guard before COMMIT.
  ingest(file: string, sessionId: string, stamp: string, current: () => boolean): Promise<boolean>;
  saveEvidence(file: string, evidence: BiliMessageEvidence[], identity: BiliIdentity): void;
  identity?: typeof fetchBiliIdentity;
  session?: typeof fetchBiliSession;
  locator?: BiliSessionLocator;
}
type Pending = { sessionId: string; scope: string; revision: string; rows: BiliMessageEvidence[]; identity: BiliIdentity };

/** Native summary ingestion and fork-safe attribution have different contracts.
 * Images/opaque snapshots may be unavailable: exact status still permits ingestion,
 * never guessed project ownership. One live collector per Pi session. */
export class BiliCollector {
  private evidence = new BiliProjectEvidence();
  private controller = new AbortController();
  private running = false;
  private observing = false;
  private scanRequested = false;
  private pending?: Pending;
  private captured?: { sessionId: string; revision: string; scope: string; identity: BiliIdentity };
  private scopeStamp?: string;
  private scopeEpoch = 0;
  private locator: BiliSessionLocator;
  constructor(private options: CollectorOptions) { this.locator = options.locator ?? new BiliSessionLocator(); }
  observeScope(scope: ProjectScope): void {
    if (this.scopeStamp !== scope.stamp) { this.scopeStamp = scope.stamp; this.scopeEpoch++; }
    this.evidence.observeScope(scope);
    if (this.pending && this.pending.scope !== scope.stamp) this.pending = undefined;
    if (this.captured && this.captured.scope !== scope.stamp) this.captured = undefined;
  }
  stop(): void { this.controller.abort(); this.pending = undefined; this.scanRequested = false; this.locator.clear(); }
  private drain(): void {
    if (!this.scanRequested || !this.current() || this.running || this.observing) return;
    this.scanRequested = false;
    void this.scan().catch(() => { /* Ordinary fallback scans retry later. */ });
  }
  private current(): boolean { return !this.controller.signal.aborted && this.options.current(); }
  // Temporary unavailability breaks future attribution continuity, not an
  // already verified, uncommitted proof. Reuse still requires an exact ordered
  // prefix in the same session/scope; workspace transitions and stop discard it.
  private unavailable(): void { this.evidence.unavailable(); this.captured = undefined; }
  private session(origin: string) { return (this.options.session ?? fetchBiliSession)(origin, this.options.conversationId, this.controller.signal); }
  private same(a: BiliSession | null, b: BiliSession): boolean {
    return !!a && a.sessionId === b.sessionId && a.sessionRevision === b.sessionRevision;
  }
  private async capture(origin: string, session: BiliSession, scope: ProjectScope, valid: () => boolean): Promise<Pending | null> {
    if (!session.sessionRevision) { this.unavailable(); return null; }
    const cached = this.captured;
    const view = cached?.sessionId === session.sessionId && cached.revision === session.sessionRevision && cached.scope === scope.stamp
      ? cached.identity : await (this.options.identity ?? fetchBiliIdentity)(origin, this.options.conversationId, this.controller.signal);
    if (!valid() || !view || view.conversationId !== session.conversationId || view.sessionId !== session.sessionId ||
        view.parentRevision !== session.sessionRevision || view.messages.length > 4000) { this.unavailable(); return null; }
    const latest = await this.session(origin);
    if (!valid() || !this.same(latest, session)) { this.unavailable(); return null; }
    const staged = this.evidence.copy();
    const rows = staged.capture(view, scope);
    const old = this.pending;
    if (old && old.scope === scope.stamp && old.sessionId === view.sessionId) {
      // Carry uncommitted observations only while the exact ordered identities
      // remain a prefix. A branch/reorder/gap cannot resurrect pending proof.
      const prefix = old.identity.messages.every((m, i) => {
        const next = view.messages[i]; return next?.rawId === m.rawId && next.ref === m.ref && next.identityHash === m.identityHash;
      });
      if (prefix) {
        const joined = new Map(old.rows.map(row => [row.rawId, row]));
        for (const row of rows) joined.set(row.rawId, row);
        rows.splice(0, rows.length, ...joined.values());
      }
    }
    this.pending = { scope: scope.stamp, sessionId: view.sessionId, revision: view.parentRevision, rows, identity: view };
    this.evidence = staged;
    this.captured = { sessionId: session.sessionId, revision: view.parentRevision, scope: scope.stamp, identity: view };
    return this.pending;
  }
  /** Ordinary messages observe ownership only: no directory scans, ingestion,
   * embeddings or UI notices. Overlap is conservative, not an unbounded queue. */
  async observe(): Promise<void> {
    if (!this.current()) return;
    if (this.running || this.observing) { this.unavailable(); return; }
    this.observing = true;
    const scope = this.options.scope(); this.observeScope(scope);
    const epoch = this.scopeEpoch;
    const valid = () => this.current() && this.scopeEpoch === epoch && this.options.scope().stamp === scope.stamp;
    try {
      const origin = localBiliOrigin(this.options.origin());
      const session = origin ? await this.session(origin) : null;
      if (!origin || !session || !valid()) { this.unavailable(); return; }
      await this.capture(origin, session, scope, valid);
    } catch { this.unavailable(); }
    finally { this.observing = false; this.drain(); }
  }
  async scan(): Promise<'stored' | 'unavailable' | 'busy' | 'expired'> {
    if (!this.current()) return 'expired';
    if (this.running || this.observing) { this.scanRequested = true; return 'busy'; }
    this.running = true;
    const scope = this.options.scope(); this.observeScope(scope);
    const epoch = this.scopeEpoch;
    const valid = () => this.current() && this.scopeEpoch === epoch && this.options.scope().stamp === scope.stamp;
    try {
      const origin = localBiliOrigin(this.options.origin());
      const session = origin ? await this.session(origin) : null;
      if (!valid()) { this.unavailable(); return 'expired'; }
      if (!origin || !session) { this.unavailable(); return 'unavailable'; }
      const listing = await this.options.files();
      const located = valid() ? await this.locator.locate(listing, session.sessionId, valid) : null;
      if (!valid()) { this.unavailable(); return 'expired'; }
      if (!located) { this.unavailable(); return 'unavailable'; }
      if (!await this.options.ingest(located.file, session.sessionId, located.stamp, valid)) { this.unavailable(); return 'unavailable'; }
      if (!valid()) { this.unavailable(); return 'expired'; }
      // Attribution failure must not undo or block the successfully stored summaries.
      const proof = await this.capture(origin, session, scope, valid);
      if (proof) {
        const files = await this.options.files();
        const current = valid() ? await this.locator.locate(files, session.sessionId, valid) : null;
        const latest = valid() ? await this.session(origin) : null;
        if (!valid()) { this.unavailable(); return 'expired'; }
        if (!current || current.file !== located.file || current.stamp !== located.stamp || !this.same(latest, session)) this.unavailable();
        else {
          // Ordinary observe() overlap may break future continuity, but must not
          // erase this scan's validated full identity/hash reconciliation input.
          this.options.saveEvidence(located.file, proof.rows, proof.identity);
          if (this.pending === proof) this.pending = undefined;
        }
      }
      return 'stored';
    } catch (error) {
      this.evidence.unavailable(); this.captured = undefined; // Keep pending for a same-scope exact retry.
      if (!this.current()) return 'expired';
      throw error;
    } finally { this.running = false; this.drain(); }
  }
}
