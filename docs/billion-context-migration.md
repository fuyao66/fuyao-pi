# Billion Context migration

Status: BC production cutover, Billion Memory adaptation and complete legacy-memory coverage are implemented and verified. The installed baseline is `billion-context@0.1.189` on Pi 1.1.0. Only BC and `packages/bili-memory` are selected; Advisor is disabled. The old Pi instances were retired by the user, and no legacy DB/WAL/SHM holders were found before tail completion. No upstream BC code was changed. The 16 retained BCP sessions were also rebuilt and published as same-name native BC sessions, under the original upstream capability contract and its accepted nested-restoration limitation. The baseline before migration is `3df4fb7`.

## Retired-writer completion (2026-10-10)

- After authorization to finish, the final two old summaries (`异步 Bash 插件`, `迁移诊断环境历史`) and their two original vector rows were appended. The full retired legacy DB has **845 summaries and 704 vectors**, all preserved. Row IDs, run/block IDs, summary text, references, timestamps and vector bytes match; existing new BC records, vectors and project links were not overwritten. SQLite `quick_check` passed.
- The append-only helper publishes a new immutable archive revision and commits a short SQLite savepoint, preserving the previous file. It rejects changed records, ID collisions, tombstone resurrection, conflicting ownership evidence and concurrent changes. Exact revision-bound approval applies to the missing source, not future legacy ingestion.
- A copied-DB rehearsal, full comparisons and an idempotence run preceded the live change. Both source and destination were backed up under private `~/.cache/fuyao-pi/billion-context-tail-20261010-042000/`. Its `completion-report.json` records 2 inserted rows, 845 history rows, 704 preserved legacy vectors and 879 total project links at completion. Total live counts continue growing; do not compare an undifferentiated row count to infer old-memory coverage.
- Real `memory_search` and migrated-summary expansion found the completed records. All registered history files matched their SHA256; source permission was verified. Migration did not dispatch embedding calls or edit the old DB/config. Normal runtime still accepts only BC sessions and registered history, never a parallel legacy source.
- Current docs distinguish BC proxy folding, Billion Memory retrieval, retained-text chunks, migrated summary-only archives and Statusline Pi accounting. The preparation-only report is retained as historical evidence; the current private report records activation and tail completion.
- Mock-provider/native-Pi and SSH-shim integration is separate from real-provider, real-SSH-server and terminal-visual testing; those external acceptance checks are **not claimed**. Advisor compatibility remains deferred, outside these three migration requirements. At this memory-completion checkpoint, live session fold state and raw logs had not yet been converted. The separate subsequent session rebuild below preserves full Pi history and native BC state; immutable Memory archives remain summary-only.

## Retained-session rebuild and publication (2026-10-10)

- Scope: the **16** old BCP sidecars with surviving Pi JSONL files. The 17 sidecars whose original sessions had already been deleted were deliberately excluded and left untouched. The user confirmed the selected old sessions were no longer open and authorized replacement after validation. The current migration conversation was not replaced.
- All 16 retain their original display names (including unnamed sessions), original Pi entries, history tree, context edits and images. Only the session header UUID changes. They now have full Pi JSONL histories plus genuine native BC v3 state: **574 retained blocks, 396 active** at publication; six selected sessions originally had no compression blocks. These counts are separate from the 845 archived Memory summaries and are not additive unique-memory coverage.
- Conversion uses the exact Pi 1.1.0 OpenAI serializer and the installed BC 0.1.189 kernel for message identity, references, pruning, cache formatting and persistence. Legacy ancestor links and overlapping original/current projections were audited; no summary-only handoff or permanent legacy runtime adapter was installed. Pi-filtered failed/aborted responses remain preserved in the raw histories and applicable old cached block text, not invented as live wire messages.
- Actual installed native Pi/BC integration with isolated state and a loopback mock provider verified first restore and continuation for all 16, all 574 old blocks' `full`/`one` exports against old BCP text, new native compression/restoration, merging old blocks with individual child recovery, inline restoration/refold and another restart. No real provider call, terminal visual check or cross-protocol/model-switch certification is claimed.
- A fresh native control with no migrated state reproduced the original BC **nested-parent `full` omission**: restoring the newly merged parent does not recursively recover every child's original text. Child blocks remain individually recoverable. The user explicitly chose unmodified upstream BC with this limitation rather than a local patch or waiting for an upstream fix. This is an accepted capability boundary, not a repaired defect or proof of recursive full restoration. The stricter experimental harness conclusion about recursive full restoration remains a failure; it does not describe the later accepted scope. No production BC patch or upgrade was deployed.
- Publication created unique new JSONL/BC files without overwriting existing native identities, then moved the 32 old JSONL/sidecar files out of the active session directory. Full original backups, converted files, hashes, validation and rollback records remain private under `~/.cache/fuyao-pi/bcp-session-native-20261010-064144/`; `completion.json` and `post-publication-verification.json` record publication and the independent read-only checks. Personal histories and the one-time converter are not committed to Git.
- Post-publication checks passed exact old/new Pi-entry comparison, original/new file hashes, real Pi open/list visibility, original BC namespaced first-request loading and cold-boot discovery for all 16. A running proxy may report an unknown new conversation before its first namespaced request or a proxy restart; this is its upstream discovery behavior, not a missing disk record. Resume the same-name replacement via Pi's normal session picker; if its current picker is stale, reopen it or restart Pi.
- Small context means the **model-bound proxy-folded payload**, not a smaller local JSONL, Pi UI history or Statusline estimate. Preserving the full Pi history is necessary for BC to synchronize and continue native folds.

## Completion regression

- Final post-session-publication rerun of `bun run check`: typechecks and local SSH build passed; **139 Bun tests passed, 1 historical Advisor test intentionally skipped, 0 failures**. The preserved Memory self-test passed all 139 checks; the **82 Node Memory tests** passed with no failures or skips, including six tail-completion tests.
- Installed-artifact native integration passed using:

  ```sh
  node --import tsx scripts/verify-billion-context.mjs \
    /path/to/installed/billion-context \
    /path/to/installed/@narumitw/pi-goal
  ```

  This runs isolated state with the actual installed BC artifact, Pi loader, native model transport, Goal/Fast hooks, delayed Memory ingestion, revision-bound retained text, explicit decompress export routing and actual delegate → dispatcher → SSH worker. The provider is a loopback mock and SSH is a process shim. The post-publication rerun passed, exposing all three delegate tools without extension errors; final static release review found no new blockers or private converter/session/database/credential artifacts in the Git changes.
- Final read-only comparison: all 845 legacy rows, 704 original vector rows and 652 pre-existing legacy project links are present; all 342 registered archive hashes match, 69 source archives are enabled, both SQLite integrity checks pass. New BC records continue accumulating separately. Live proxy/disk are 0.1.189, not stale, with no conflicts.

## Initial online cutover checkpoint (2026-10-10; historical snapshot)

- The user authorized an online consistent snapshot, accepting a few late records
  remaining in the old database. No old Pi processes were terminated.
- Migrated 843 summaries, 702 vector rows and 858 project links to
  `~/.pi/bili-memory/`. Protected fingerprints match; all summaries pass source
  policy, lexical retrieval and idempotent archive rescans. The exact approval
  enables 159 existing delegate summaries, not future `/tmp` sources.
- Installed entry files match the reviewed artifact. Setup selected exactly one
  new compressor, retained unrelated preferences and kept Advisor disabled.
  `autoUpdate: false`, `advisoryCheck: true` implements the chosen update policy.
- Installed-artifact integration passed native Pi interception, compression,
  delayed Memory ingestion, revision-bound retained text reads, Goal continuation/
  completion, Fast forwarding and actual delegate/dispatcher/SSH-worker routing.
  SSH uses a process shim; no real provider, server or terminal visual acceptance.
- Full regression: 139 Bun tests passed, one historical Advisor test intentionally
  skipped; 76 Node Memory tests passed. No real embedding calls during migration.
- Private backup and rollback instructions are under
  `~/.cache/fuyao-pi/billion-context-cutover-20261010-033349/`; old data is retained,
  not an active second ingestion path. Late old-process writes were omitted at this initial checkpoint and were subsequently appended after retirement, as recorded above.
- At this initial checkpoint, restart/docs/commit were still pending. Later live health checks verified BC 0.1.189 with matching disk version, no stale state and no conflicts. Statusline displays Pi accounting, not an independently measured proxy-folded request size. Old fold state was not imported at that initial checkpoint; the later verified same-name native session rebuild is recorded above.

The stage notes below are chronological rehearsal records, not the current installed
state.

## Boundaries

- Use upstream Billion Context without modifying its code.
- End with one runtime and one Memory ingestion path, not parallel legacy/new
  compressors. A one-time converter may read legacy data; it is not a runtime adapter.
- Back up the SQLite database and source records before conversion. Preserve row
  identity, summary text, project evidence and valid vectors where possible.
- Do not create fake live proxy sessions from memory summaries. Historical archives
  retain provenance. A separately verified full-history/native-state rebuild may
  publish unique new identities after approval, never overwrite existing upstream
  session records or act as a runtime legacy adapter.
- Do not guess project ownership from the currently open directory. Unknown or
  mixed historical ownership remains unknown or mixed.
- Existing source data is not deleted until conversion and recovery are verified.

## Stage 1: verified protocol seams

`node --import tsx scripts/verify-billion-context.mjs <unpacked-package-directory>` starts the
exact release with isolated HOME/config/data and a loopback mock model endpoint.
It does not install a package or call a paid model. Artifacts stay in a printed
`/tmp/fuyao-bili-migration-*` directory; child processes are stopped afterward.

Verified:
- Proxy startup, tool manifest and OpenAI-compatible request forwarding.
- The `service_tier: priority` field survives forwarding.
- A successful compression removes original fixture text from the next outgoing
  request and preserves its submitted summary. An HTTP 200 alone is not success;
  the probe asserts `blocksCreated` and checks actual outgoing content.
- Persistence emits version-3 envelopes containing block summaries and
  `effectiveMessageIds`.
- Public snapshot + fork creates an independent child inheriting the fold.
  An Advisor-like request with a different system prompt and no tools stays
  compressed; the parent's revision is unchanged. This is a **same-model,
  same-protocol fixture**, not full Advisor compatibility certification.

Initial local changes:
- Memory validates the v3 envelope version/identity and retains block references
  for project attribution. References alone do not establish project ownership.
- Remote SSH recognizes the exact new file-export receipt without treating all
  of `/tmp` as local or scanning arbitrary restored text for paths.

Validation so far: Memory suite 51 tests; Remote SSH integration file 7 tests;
workspace typechecking; isolated real-proxy probe. No real SSH/provider/UI tests.

## Stage 2: Memory migration rehearsal

- Package and directory renamed to `bili-memory`; production profile is not switched.
- Proxy identity collector and workspace intervals feed message-based many-to-many
  project associations. Unknown intervals stay explicit; session-directory clues
  are a separately labelled fallback, never SSH ownership proof.
- `scripts/preview-memory-history.ts <db>` performs SQLite online backup, then
  converts only that copy to immutable `bili-memory-history` v1 records. These are
  owned historical archives, not counterfeit proxy sessions. Original source,
  kind, cwd and project remain in provenance; summary reads work without old logs.
- The latest authorized rehearsal preserved 820 summaries, 679 vector rows and
  835 project links byte-for-byte (selected row fingerprints), creating 342 source
  archives. Repeated conversion was idempotent and SQLite integrity checks passed.
  Counts are a snapshot; the active old session continues growing.
- `packages/bili-memory/scripts/prepare-migration.ts` captures the old source
  policy, including built-in defaults when no custom file exists, into an isolated
  SQLite backup and emits candidate configuration. It never activates that copy.
- Tombstones follow relocated sources. The old policy allowed 661 stored summaries;
  the other 159 came from 53 historical delegate sources outside the default roots.
  The user explicitly authorized those existing records for retrieval and normal
  embedding backfill. A private approval manifest binds source path, complete
  archive hash and block count; any changed revision fails closed. It does not
  authorize future delegate files or broaden `/tmp` access. Migrated source-policy
  validation allowed all 820 records, with zero previously allowed records withheld.
- 73 Memory tests pass, including policy capture, atomic approval validation,
  archive re-scan, vector preservation, revocation and stale-plan rejection.
  Real data and production installation remain unchanged.

## Stage 3: native integration and setup

- Actual Pi loader + Billion Context native interception + mock upstream tested.
  Native `compress` followed by delayed persistence is ingested by bili-memory.
  The subsequent wire request includes the summary, not the original fixture text.
- Active Goal contract survives compression; continuation is queued once and
  `goal_complete` clears the goal. The fixture intercepts continuation delivery
  to avoid an unbounded model loop; it does not exercise real provider failures.
- Setup now replaces old compressor entries without silently widening resource
  filters and removes deferred Advisor. Its 19 tests pass. The production package
  pin and settings have not been switched.
- Update policy chosen by the user: ordinary `autoUpdate: false`, critical-defect
  `advisoryCheck: true`. Critical repairs may change the installed version outside
  the pinned baseline; environment overrides are reported by setup.

## Historical integration gates (resolved or explicitly deferred)

These were earlier-stage tasks, not remaining live instructions. Gates 1, 3–6 were subsequently implemented and validated in the cutover and completion above; Advisor (2) stays deferred and disabled.

1. Memory: retire temporary legacy runtime ingestion, finalize new config paths
   and final offline cutover preparation. Resolve bounded original-content reading
   for the new format; do not feed proxy hashes to Pi's JSONL reader.
2. Advisor: deferred by user decision. Remove it from the active profile and setup
   defaults while keeping its source. It is not a migration acceptance gate; do
   not add a second proxy or continue integration work for it. The exploratory
   fork fixture above is not certification for future re-enablement.
3. Remote SSH: exercise actual decompress receipts and delegate inheritance in
   the SSH shim. Review remaining old cache-path assumptions.
4. Statusline/Fast: verify context-usage source and Fast's native hook path in
   the combined profile; protocol forwarding and active Goal already passed.
5. Setup: replace the production package pin after all integration gates pass.
6. Run full regression and migration dry-run on copied data; compare summary,
   vector and project counts and hashes; back up and switch the real profile only
   after acceptance. Restart the host; do not hot-swap compression in an active
   long session.
