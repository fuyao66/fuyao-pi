# Architecture

[Documentation index](README.md) · [Configuration](configuration.md) · [Maintenance](maintenance.md)

## Components

| Part | Owner / source of truth | Change location |
| --- | --- | --- |
| Upstream runtime | Pi core and public APIs | Pinned dependencies in root `package.json`; installed Pi CLI must match |
| Locally maintained capabilities | First-party remote-ssh; Advisor, Memory, Statusline and GPT Fast derivatives | `packages/<name>/`, including tests and provenance |
| Environment composition | Root manifest, companion profile, public defaults | `package.json`, `config/`, `scripts/setup.ts`, root `test/` |
| Private runtime state | The user's Pi installation and plugin-specific local files | Outside Git: model credentials, settings overrides, sessions, memory DB, SSH configuration |

Setup registers `packages/remote-ssh`, `packages/advisor`, `packages/memory`, `packages/statusline` and `packages/gpt-fast-mode`
separately so `pi list` identifies each capability. Each child manifest owns its extensions. Reserved root resources are not loaded by setup. Companion extensions come from `config/plugins.json`. Setup loads BCP
first, followed by local packages and companions, preserving unrelated declarations.

## Capabilities and contracts

### Context: BCP

BCP compresses model-visible conversation context while preserving backing history
for recovery. T1/T2/T3 describe compression nesting.

### Review: Advisor

Advisor receives a captured conversation after Pi's ordinary `context` handlers,
including BCP, rather than replaying the raw journal. It uses its own review prompt,
has no tools and must be called alone. Missing/stale snapshots fail closed.
This is not a copy of the final provider payload: later transforms are a documented
ordering constraint. Images are omitted. See [Advisor provenance/contract](../packages/advisor/UPSTREAM.md).

### History: Memory

```text
Allowed BCP/source summaries → incremental sync → local SQLite
                                              ├─ lexical index
                                              └─ optional remote embeddings → local vectors
                                                           ↓
                                                scoped memory_search / expansion
```

BCP remains authoritative for summary content; Memory is a derived cross-session
index. New messages receive conservative workspace evidence, rather than assigning
an entire session to its most recent cwd. Unknown/mixed/legacy records remain stored
and require explicit all-scope retrieval. Source permission and full revision checks
apply to tools and uploads. Management browsing can inspect retained excluded rows.

Successful compression triggers background current-session scans; startup and settled
scans are fallbacks. Indexing precedes embeddings, so lexical retrieval does not wait
for the provider. Summary/vector commits produce one-line user feedback, excluded
from model context. Remote embedding is separately opted in.
See [Memory current contract](../packages/memory/README.md) for limits and privacy.

### Workspace: remote-ssh

The first-party bridge routes supported core filesystem/shell tools to a model-free
Linux worker. It keeps ownership verification and fails closed on transport/routing
failure. BCP context tools, delegates' orchestration and runtime state remain local.
A small read-only event publishes workspace identity to Memory; it exposes no key
material. It does not make every third-party plugin's internal filesystem access remote.
See [SSH boundaries](../packages/remote-ssh/README.md).

### Presentation

Appearance uses Pi's native theme system and settings, including a standalone palette
in `themes/`. Statusline uses the public footer API; there is no local
transcript/editor patch layer.

## Execution and data boundaries

| Operation/data | Location |
| --- | --- |
| Pi process, provider authentication, UI, sessions, BCP sidecars | Local |
| Advisor side-call orchestration and Memory indexing/SQLite | Local |
| Advisor model request / enabled embedding requests | Configured external provider |
| Supported core workspace tools after verified SSH connection | Remote worker |
| Other plugins' filesystem/network actions | Their own implementation; not implicitly rerouted |

“Local” means local to the host running Pi, not necessarily offline. Source permissions
and workspace filters avoid accidental retrieval/upload; they are not an OS sandbox.
All installed extensions execute with Pi's process permissions.
