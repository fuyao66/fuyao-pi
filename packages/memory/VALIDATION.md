# Initial validation (2026-09-30)

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
