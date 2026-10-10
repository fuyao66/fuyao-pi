# Validation records

## BC migration and complete-history acceptance (2026-10-10)

Current baseline: Pi 1.1.0, `billion-context@0.1.189`, Node >=22.19. The installed native entry and live local proxy were verified; disk/proxy versions match with no stale/conflicting installation. Advisor is disabled.

- The initial online snapshot preserved 843 summaries, 702 vectors and 858 upgraded project links. After all old writers retired, a backed-up append-only completion added the last 2 summaries and 2 vectors, yielding full legacy coverage of **845 / 704**, verified field-for-field and byte-for-byte. Pre-existing BC rows and project links survived. SQLite integrity, exact source approval, archive SHA256, idempotence and actual search/summary expansion passed. No embedding calls were made by the migration.
- Tail tests cover unchanged source identity, vector preservation, ID collisions, disabled-content approval boundaries, tombstones, archive integrity, conflicting ownership proof and concurrent destination mutation.
- Installed-artifact integration uses the real Pi loader/native interception, BC proxy, delegate/dispatcher and SSH worker with isolated state and a loopback mock model endpoint. It verifies actual folded wire content, delayed ingestion, retained-text revisions, Goal continuation/completion and Fast forwarding. SSH uses a process shim; real-provider, real-server and terminal-visual acceptance are not claimed.
- New runtime sources are BC v3 + registered `bili-memory-history` v1. Legacy readers run only offline; migrated archives provide summary pages, not raw-history reconstruction or old fold state. Separately, 16 retained Pi sessions were rebuilt with native BC state (574 retained blocks, 396 active at publication) and verified through native restore/continuation, new compression, individual child restoration, inline refold and restart. This does not change the archive reader or claim that BC's upstream nested-parent `full` omission was fixed; details and test boundaries are in the migration report.

Full completion regression and commands are recorded in the [migration report](../../docs/billion-context-migration.md). The records below describe older baselines, not the current installed compressor.

## Initial validation (2026-09-30; historical BCP profile)

Validation environment: Pi 0.87.1, Node 24.14.1. BCP is loaded from the pinned profile entry; rerun compatibility checks as part of each deliberate BCP upgrade.

- Root typecheck/build/UI checks and 58 Bun tests (231 assertions) pass.
- Preserved upstream self-tests: 139 checks pass.
- Hybrid tests: 13 pass, covering semantic-only hits, lexical hits, filters,
  disabled mode, fallback, redaction/path removal, truncation, namespace changes,
  malformed/failed/timeout/cancelled provider responses, deletion and shutdown.
  Caller cancellation returns empty cancelled results before dispatch, during HTTP
  and during chunked scoring. Scan-time mutations omit inaccurate coverage.
- Multi-batch backfill revalidates before upload; deleted/changed later-batch
  summaries are not transmitted. Already-dispatched requests cannot be recalled.
- Node resource loader: full configured profile loads; exactly one `memory_search`
  and `/memory`, after backup-backed replacement of upstream package declaration.
- SSH shim smoke passes; this is not a real SSH-server test.
- Live embedding integration used **synthetic text only**, with
  `text-embedding-3-large` returning 3072 dimensions. A Chinese semantic query
  retrieved the intended English Advisor summary with zero lexical candidates.
  This is a small integration test, not a model-quality benchmark or assurance
  about the provider's underlying model implementation.

## Bounded performance probe

In-memory synthetic corpus: 10,000 blocks × 3072 dimensions, immediate mocked
query embedding, on this machine. Packed streaming scan:

- Before first await: ~1.1 ms.
- Total: ~494 ms.
- RSS growth: ~13.5 MiB.
- A zero-delay interval progressed 312 times during the operation.

Machine-specific observations, not latency guarantees; real provider latency is
additional. Search yields every 32 blocks and retains only the semantic top 20.
Status/backfill validation remains bounded synchronous work. The oldest-block
10,000-record capacity limit and summary-prefix truncation are documented in
README.md. Public defaults remain offline/disabled. Actual history indexing is
an explicit per-user operation and is not performed by these tests.
