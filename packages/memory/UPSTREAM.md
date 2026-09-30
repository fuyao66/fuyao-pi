# BCP memory enhancement — source provenance

- Upstream: https://github.com/tjp72/pi-billion-memory
- Imported version: `pi-billion-memory@0.5.3`
- Imported Git commit: `52e5a01c62df4d40421b93da4528c9e969061c46`
- Author: tjp72; MIT notice retained in `LICENSE`.
- Local private derivative: `@fuyao/pi-memory@0.5.3-fuyao.1`, not published to npm.

The upstream source modules and self-tests are retained. This derivative adds
`src/embeddings.ts`, `src/hybrid.ts`, `src/auto-embed.ts`, manual/opt-in automatic embedding and integration
at `memory_search`. `src/activity.ts` and `src/memory-ui.ts` add coalesced,
post-commit chat activity cards (`custom` entries excluded from model context)
and a single `/memory` management menu; no editor/footer patches. Legacy commands
remain compatible, with confirmation required for every prune path. Upstream ingestion, allow-list, lexical lookup, expansion,
watermarks and durable pruning remain. Source loading replaces upstream's bundled
Git-distribution workflow. See [README.md](README.md) for the fork contract.

## Deliberate policy differences

Upstream is an offline lexical search plugin. This fork is lexical/offline by
default, but **opt-in hybrid search makes remote embedding requests**. It does not
claim to satisfy upstream's no-network search policy. No embedding SDK or vector
database is needed; vectors are stored in the existing SQLite database.
`autoBackfill:true` (public default false) separately authorizes background summary
uploads after startup/ingestion. A coalescing, session-scoped scheduler batches work,
backs off failures and stops on shutdown. BCP delegates skip auto tasks; a short
SQLite lease reduces cross-process duplicate backfills without holding HTTP transactions.
Manual backfill remains interactive. See README for timing and capacity limits.

Only redacted, path-stripped stored topic/summary prefixes and queries are sent.
This is best-effort sanitization, **not a guarantee that summaries contain no
sensitive information**. No raw messages, expanded messages, source file paths,
or whole sessions are sent to the embedding service. Optional upstream
`memory_expand` still reads local raw messages when explicitly enabled; it is not
used for embedding. This enhancement adds no BCP context hooks or compression
algorithm changes.

Root setup replaces upstream/standalone memory package declarations to avoid
duplicate `memory_search` and `/memory` registrations. Explicit legacy entries in
`settings.extensions` require manual removal. Existing database and allow-list
configuration paths are intentionally retained for compatibility. Embedding
configuration and credentials stay outside the repository.

Tests use Node's `node:sqlite` (Node >=22.19), not Bun's test runtime. Run
`bun run test:memory` or the root `bun run check`. When upgrading upstream,
review ingestion/prune/schema changes and rerun both upstream and hybrid tests.
