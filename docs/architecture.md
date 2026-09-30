# Architecture

[Documentation index](README.md) · [Configuration](configuration.md) · [Maintenance](maintenance.md)

## Product boundary

fuyao-pi is a personal **Pi Agent environment and extension integration repository**.
Its unit of maintenance is the complete configured environment, not a single SSH tool.
It provides source, manifests, setup and regression checks. It does not implement a
replacement Pi core, ship a separate CLI, manage model accounts, or guarantee a
one-click installation on every operating system.

## Four parts of the system

| Part | Owner / source of truth | Change location |
| --- | --- | --- |
| Upstream runtime | Pi core and public APIs | Pinned dependencies in root `package.json`; installed Pi CLI must match |
| Locally maintained capabilities | First-party remote-ssh; UI, Advisor and Memory derivatives | `packages/<name>/`, including tests and provenance |
| Environment composition | Root manifest, companion profile, public defaults | `package.json`, `config/`, `scripts/setup.ts`, root `test/` |
| Private runtime state | The user's Pi installation and plugin-specific local files | Outside Git: model credentials, settings overrides, sessions, memory DB, SSH configuration |

The root package loads the local extensions. Child manifests describe their package
identity, but installing them again alongside the root creates duplicate registrations.
Companion extensions come from `config/plugins.json`; the root manifest alone does
not install them. `setup` orders BCP before the root package and preserves other
unrelated package declarations. Actual root entry order is defined by `package.json`.

## Capabilities and contracts

### Context: BCP

BCP is an upstream pinned dependency, not code owned by this repository. It changes
model-visible conversation context through compression while preserving backing
history for recovery. T1/T2/T3 describe compression nesting, not separate long-term
memory stores. fuyao-pi does not replace this mechanism.

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
from model context. Remote embedding is separately opted in; no extra chat-model
summary generation, curated-fact layer or automatic age deletion is implemented.
See [Memory current contract](../packages/memory/README.md) for limits and privacy.

### Workspace: remote-ssh

The first-party bridge routes supported core filesystem/shell tools to a model-free
Linux worker. It keeps ownership verification and fails closed on transport/routing
failure. BCP context tools, delegates' orchestration and runtime state remain local.
A small read-only event publishes workspace identity to Memory; it exposes no key
material. It does not make every third-party plugin's internal filesystem access remote.
See [SSH boundaries](../packages/remote-ssh/README.md).

### Presentation: UI

The Sakura-derived UI and theme are locally maintained source, not an external package
to auto-overwrite. Five root extension entries provide header, matrix, Zentui, quota and
shimmer functionality. Components use Pi's TUI; no second renderer or separate app is
introduced. Visual changes require terminal testing beyond static checks.

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

## Why the directory layout stays simple

`packages/` contains real capability boundaries; `config/` describes the environment;
`scripts/` assembles it; `test/` verifies integration; `docs/` explains ownership and use.
Reserved resources in `skills/`, `prompts/`, `themes/` are placeholders, not a framework
requiring extra layers. Keep build outputs and workers generated/ignored, private state
outside Git, and each derivative's upstream notices next to its code.

The old `pi-ssh-remote` package name and protocol identifiers remain within its child
package for compatibility. They do not define the scope or public identity of fuyao-pi.
