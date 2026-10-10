# Architecture

[Documentation index](README.md) · [Configuration](configuration.md) · [Maintenance](maintenance.md)

## Components

| Part | Owner / source of truth | Change location |
| --- | --- | --- |
| Upstream runtime | Pi core and public APIs | Pinned dependencies in root `package.json`; installed Pi CLI must match |
| Locally maintained capabilities | First-party remote-ssh; Billion Memory, Statusline and GPT Fast derivatives | `packages/<name>/`, including tests and provenance |
| Deferred capability | Advisor source retained, disabled in the profile | Historical BCP contract; not certified for BC |
| Environment composition | Root manifest, companion profile, public defaults | `package.json`, `config/`, `scripts/setup.ts`, root `test/` |
| Private runtime state | The user's Pi installation and plugin-specific local files | Outside Git: credentials, settings, sessions, memory DB and SSH configuration |

Setup registers `packages/remote-ssh`, `packages/bili-memory`, `packages/statusline` and `packages/gpt-fast-mode` separately, so `pi list` identifies each capability. Each child manifest owns its extensions. Reserved root resources are not loaded by setup. Companion extensions come from `config/plugins.json`. Setup selects one BC entry before local packages and companions, preserving unrelated declarations and resource filters.

## Capabilities and contracts

### Context: Billion Context (BC)

The pinned upstream `billion-context@0.1.189` Pi-native entry attaches to a local proxy and intercepts supported fetch/WebSocket requests. The proxy folds the outgoing conversation, owns compression state and persists version-3 envelopes. T1/T2/T3 describe compression nesting. No upstream code is modified or vendored.

This replaces BCP's Pi `context` hook: Pi's pre-proxy context is not necessarily the final model payload. A separate, verified one-time conversion rebuilt the 16 retained BCP sessions as new native Pi/BC identities, preserving their names and complete Pi histories plus 574 retained compression blocks (396 active at publication). This is not a hot swap of legacy sidecars or a summary-only handoff. The proxy folds model-bound history; local JSONL and Pi accounting need not shrink. The original upstream nested-parent `full` restoration limitation remains; child blocks can be restored individually. See [migration and acceptance](billion-context-migration.md).

### Review: Advisor (disabled)

The retained derivative captured context after ordinary Pi context handlers under BCP. That no longer establishes that it sees BC's final proxy-folded request. The same-model fork fixture is exploratory evidence, not full Advisor compatibility. Setup removes Advisor declarations; re-enablement needs a separate review, not another parallel compressor.

### History: Billion Memory

```text
Authorized BC v3 sessions + immutable migrated history
    → incremental sync → local SQLite / lexical index
                      └→ optional remote embeddings → local vectors
    → scoped memory_search / revision-bound expansion
```

BC remains authoritative for new summary content; Billion Memory is a derived cross-session index in `~/.pi/bili-memory/`. Its collector uses public exact conversation/session/message snapshots, never a latest-file guess. Initial/resumed history, unavailable snapshots, branch/rewrite changes and uncertain workspace transitions do not become new ownership proof. Reliable per-message evidence supports many-to-many workspace associations; a session directory is only a separately labelled keyword fallback.

Normal runtime accepts only `bili-session` and `memory-history` sources. Legacy adapters exist only in explicit offline migration/tests. Immutable history archives preserve sanitized summaries, provenance and metadata, not old raw logs or live fold state. All 845 legacy summaries and 704 original vectors were verified after the retired-writer tail completion. Project links are index relationships, not duplicate memories. The separately rebuilt native BC sessions are distinct sources from these summary-only archives; 845 archived summaries and 574 session blocks are different inventories and may overlap in content, not a count of unique additional memories.

Search, expansion and uploads check source permission and content/reference revision. New BC expansion reads retained block text only if available: list → explicit chunk selection + revision. It does not recursively follow placeholders. Migrated archives support summary pages only. Management browsing can inspect retained excluded rows; source policy is not an OS sandbox.

Successful compression schedules background scans with bounded delayed retries; startup, message-end, settled and search scans provide fallbacks. Indexing precedes embeddings. Post-commit feedback is excluded from model context. Remote embedding is separately opted in and remains best-effort sanitized, not guaranteed secret-free. See [Billion Memory contract](../packages/bili-memory/README.md).

### Workspace: remote-ssh

The first-party bridge routes supported core filesystem/shell tools to a model-free Linux worker, verifies ownership and fails closed on transport/routing failure. BC context tools, delegate orchestration and proxy/runtime state remain local. Verified decompress export receipts permit a narrowly scoped local read; they do not make all temporary files local.

A read-only event publishes workspace identity to Billion Memory without key material. Other plugins' internal filesystem/network operations are not automatically SSH-aware. See [SSH boundaries](../packages/remote-ssh/README.md).

### Presentation and Fast

Appearance uses Pi's native themes/settings. Statusline uses public footer accounting, not an independent measurement of the proxy-folded wire payload; context estimates can differ. There is no local transcript/editor patch layer. GPT Fast sets `service_tier: priority` through Pi's payload hook for configured models; the forwarding fixture verifies the field survives BC.

## Execution and data boundaries

| Operation/data | Location |
| --- | --- |
| Pi process, provider authentication, UI, sessions, BC proxy and persisted envelopes | Local |
| Billion Memory indexing/SQLite/history archives | Local |
| Model requests / explicitly enabled embedding requests | Configured external provider |
| Supported core workspace tools after verified SSH connection | Remote worker |
| Other plugins' filesystem/network actions | Their own implementation; not implicitly rerouted |

“Local” means local to the host running Pi, not necessarily offline. All installed extensions execute with Pi's process permissions. Mock-provider/SSH-shim integration is not real provider, real SSH-server or terminal visual acceptance.
