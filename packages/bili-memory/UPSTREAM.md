# Billion Memory — source provenance

- Upstream: https://github.com/tjp72/pi-billion-memory
- Imported version: `pi-billion-memory@0.5.3`
- Imported Git commit: `52e5a01c62df4d40421b93da4528c9e969061c46`
- Author: tjp72; MIT notice retained in `LICENSE`.
- Local private derivative: `@fuyao/bili-memory@0.5.3-fuyao.1`, not published to npm.

The upstream source modules and self-tests are retained. This derivative adds
`src/embeddings.ts`, `src/hybrid.ts`, `src/auto-embed.ts`, opt-in automatic embedding and integration
at `memory_search`. `src/activity.ts` and `src/memory-ui.ts` add coalesced,
post-commit chat activity cards (`custom` entries excluded from model context)
and a single `/bili-memory` menu with browse, status and refresh only; no editor/footer patches. Automatic batch
feedback is a single `Bili-Memory` line: committed memory updates or a deduplicated
Embedding failure. Vector-only success and background recovery stay silent; details
remain in the status menu. No `/memory` alias or subcommand arguments are accepted;
technical upload batches and pruning are no longer user menu actions. Display-only title
fallbacks use source topic, an opening Markdown heading/text, then block ID without changing content. `src/compression-scan.ts` schedules indexing after
compression without waiting for the entire agent run. `src/project-scope.ts` and
`src/source-policy.ts` provide conservative workspace attribution and shared source,
block and revision authorization. Authorization snapshots use indexed temporary SQL
relations; `src/source-cache.ts` caches parsed documents with bounded size and metadata
invalidation while rules/listing refresh. Format version and literal source-prefix checks
reject unsupported formats and traversal/symlinks. `src/snippets.ts` provides bounded
query-centered excerpts. Semantic queries require a valid authorized vector and report
scope-specific coverage, with keyword fallback. Ingestion now synchronizes revisions transactionally,
including FTS updates and content-dependent vector invalidation. Upstream allow-list,
lexical lookup, expansion, watermarks and durable pruning are retained and adapted. Source loading replaces upstream's bundled
Git-distribution workflow. See [README.md](README.md) for the fork contract.

## Deliberate policy differences

Upstream is an offline lexical search plugin. This fork is lexical/offline by
default, but **opt-in hybrid search makes remote embedding requests**. It does not
claim to satisfy upstream's no-network search policy. No embedding SDK or vector
database is needed; vectors are stored in the existing SQLite database.
`autoBackfill:true` (public default false) separately authorizes background summary
uploads after startup/ingestion. A coalescing, session-scoped scheduler batches work,
backs off failures and stops on shutdown. BC delegates (retained upstream `PI_ACP_DELEGATE_DEPTH` flag) skip auto tasks; a short
SQLite lease reduces cross-process duplicate backfills without holding HTTP transactions.
Manual backfill is no longer a user command. Agent search/expansion tools remain unchanged; no destructive maintenance capability was added. See README for timing and capacity limits.

Only redacted, path-stripped stored topic/summary prefixes and queries are sent.
This is best-effort sanitization, **not a guarantee that summaries contain no
sensitive information**. No raw messages, expanded messages, source file paths,
or whole sessions are sent to the embedding service. Optional upstream
`memory_expand` remains opt-in: its `summary` mode reads bounded, revision-bound
pages from the stored summary. For new BC sessions, `list`/`full` read only retained local block text, via explicit numbered chunks and a revision check; nested placeholders are not followed. Migrated history supports summaries only, not old raw-session reconstruction. Neither path is used for embedding. This enhancement adds no compression context hooks or upstream algorithm changes.

Root setup replaces upstream/standalone memory package declarations to avoid
duplicate `memory_search` and memory command registrations. Explicit legacy entries in
`settings.extensions` require manual removal. Existing database and allow-list
configuration paths are retained only as rollback evidence. New state lives in `~/.pi/bili-memory/`; normal runtime admits only BC v3 sessions and registered immutable `bili-memory-history` v1 archives. Legacy readers are restricted to explicit offline migration/tests. Embedding configuration, credentials and exact historical-source approvals stay outside the repository.

## BC adaptation

`src/bili-client.ts`, `src/bili-identity.ts` and `src/bili-collector.ts` separate exact public status/session mapping for ingestion from fork-safe snapshot identities for attribution. A bounded metadata-only locator avoids rereading unchanged journals while rechecking permissions, complete listings and duplicate IDs. `src/bili-project-evidence.ts` records only continuous ordered-prefix workspace evidence; current revision coverage and complete identity-hash reconciliation prevent stale raw-ID promotion. Images/opaque snapshots can be unavailable without blocking summary indexing.

`src/native-storage.ts` adds stable-row activity/child metadata, parser watermarks and current-block coverage. Complete redacted native summaries replace silent 20,000-character prefixes, with explicit byte budgets; unchanged content preserves existing vectors and tombstones. `src/retrieval.ts` groups exact content only after authorization, retains authorized alternative receipts and diversifies direct parent/child hits without deleting details. Hybrid search uses bounded distinct candidates and request-local embedding reuse, with per-receipt reauthorization. These are BC-native adaptations, not changes to upstream compression or fork behavior. `src/bili-expand.ts` validates retained-text revisions. `src/history-archive.ts`, `src/project-migration.ts`, `src/migration-sources.ts`, `src/migration-approval.ts` and `src/migration-tail.ts` provide the one-time immutable archive migration, evidence preservation, source approval and retired-writer append-only completion. These are local adaptations, not upstream features or a new npm release.

Tests use Node's `node:sqlite` (Node >=22.19), not Bun's test runtime. Run
`bun run test:memory` or the root `bun run check`. When upgrading upstream,
review ingestion/prune/schema changes and rerun both upstream and hybrid tests.
