import type { BiliIdentity } from './bili-identity.js';
import type { ProjectScope } from './project-scope.js';

export interface BiliMessageEvidence { rawId: string; identityHash: string; projectId: string | null }

/** Evidence for proxy message identities, not Pi journal ids. A successful initial
 * snapshot establishes a baseline but never claims historical messages for the
 * current workspace. Call observeScope on every host lifecycle/workspace event,
 * even when the proxy is unreachable. Missing snapshots break continuity. */
export class BiliProjectEvidence {
  private sessionId: string | undefined;
  private previous: BiliIdentity['messages'] = [];
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
    next.sessionId = this.sessionId; next.previous = this.previous.map(m => ({ ...m }));
    next.scopeStamp = this.scopeStamp; next.continuous = this.continuous;
    return next;
  }

  capture(identity: BiliIdentity, scope: ProjectScope): BiliMessageEvidence[] {
    this.observeScope(scope);
    const sameSession = this.sessionId === identity.sessionId;
    // A set-subset test misses reorder/insertion/ref reuse. Only an ordered,
    // unchanged identity prefix proves that the new tail is this workspace's.
    const appendOnly = sameSession && this.previous.every((m, i) => {
      const next = identity.messages[i];
      return next?.rawId === m.rawId && next.ref === m.ref && next.identityHash === m.identityHash;
    });
    const project = this.continuous && appendOnly ? scope.id : null;
    const old = new Map(this.previous.map(m => [m.rawId, m]));
    const evidence = identity.messages
      .filter(m => !sameSession || old.get(m.rawId)?.identityHash !== m.identityHash || old.get(m.rawId)?.ref !== m.ref)
      .map(m => ({ rawId: m.rawId, identityHash: m.identityHash, projectId: project }));
    this.sessionId = identity.sessionId;
    this.previous = identity.messages.map(m => ({ ...m }));
    this.continuous = true;
    return evidence;
  }
}
