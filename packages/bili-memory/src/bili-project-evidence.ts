import type { BiliIdentity } from './bili-identity.js';
import type { ProjectScope } from './project-scope.js';

export interface BiliMessageEvidence { rawId: string; identityHash: string; projectId: string | null }

/** Evidence for proxy message identities, not Pi journal ids. A successful initial
 * snapshot establishes a baseline but never claims historical messages for the
 * current workspace. Call observeScope on every host lifecycle/workspace event,
 * even when the proxy is unreachable. Missing snapshots break continuity. */
export class BiliProjectEvidence {
  private sessionId: string | undefined;
  private previous = new Map<string, string>();
  private scopeStamp: string | undefined;
  private continuous = false;

  observeScope(scope: ProjectScope): void {
    if (this.scopeStamp !== scope.stamp) this.continuous = false;
    this.scopeStamp = scope.stamp;
  }

  unavailable(): void { this.continuous = false; }

  /** Stage a snapshot; the collector adopts it only after persistence succeeds. */
  copy(): BiliProjectEvidence {
    const next = new BiliProjectEvidence();
    next.sessionId = this.sessionId; next.previous = new Map(this.previous);
    next.scopeStamp = this.scopeStamp; next.continuous = this.continuous;
    return next;
  }

  capture(identity: BiliIdentity, scope: ProjectScope): BiliMessageEvidence[] {
    this.observeScope(scope);
    const next = new Map(identity.messages.map(m => [m.rawId, m.identityHash]));
    const sameSession = this.sessionId === identity.sessionId;
    // Rewrites/branch changes are not append-only observations. Do not infer
    // ownership from a new tail when any previous identity has disappeared.
    const appendOnly = sameSession && [...this.previous].every(([id, hash]) => next.get(id) === hash);
    const project = this.continuous && appendOnly ? scope.id : null;
    const evidence = identity.messages
      .filter(m => !sameSession || this.previous.get(m.rawId) !== m.identityHash)
      .map(m => ({ rawId: m.rawId, identityHash: m.identityHash, projectId: project }));
    this.sessionId = identity.sessionId;
    this.previous = next;
    this.continuous = true;
    return evidence;
  }
}
