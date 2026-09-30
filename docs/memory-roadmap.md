# Memory roadmap

## Goal
Deliver a small BCP-compatible project and long-term memory plugin: correctly synchronized summaries, reliable project scope, unified source policy, and on-demand retrieval with tests and migration notes. This file tracks work; it does not activate the Goal extension or promise unattended execution after Pi exits.

## Constraints
- Do not modify BCP source or reconstruct full conversation context.
- Keep one `/memory` entry point and short, stable tool guidance.
- All maintained plugin interface text must be English (menus, status, errors, notifications, tool guidance). Preserve original language of stored memories and user-authored titles.
- No automatic production-history deletion, bulk paid model extraction, or unrelated UI edits.
- Tests use isolated stores and mock embedding providers.

## Milestones
1. **Implemented and tested: revision consistency.** Preserve row IDs while updating summary/topic/references together; update FTS and invalidate content-dependent vectors, preserve tombstones. Test revisions, rollback and idempotence.
2. **Implemented and tested: project identity and policy.** Normalized workspace IDs (SSH target/port/path included), write-once message evidence, unknown/mixed legacy handling, current-by-default search/expansion. Shared file/format/block/revision authorization for retrieval and automatic/manual uploads; records excluded by policy are retained for management inspection.
3. **Deferred (optional): curated memory.** Sourced project/global entries, authorized save/update, replacement history, `/memory` management and concise tool guidance. No automatic promotion of model guesses to user requirements.
4. **Implemented and tested: English interface consistency.** Memory menus, browser, activity cards, status and confirmation messages now use English. Runtime scans found no Chinese copy in remote-ssh, Advisor or UI extension code. Chinese credential detection and user-authored memories/test fixtures are deliberately preserved; concurrent UI edits untouched.

## Progress
- Design: `memory-design.md`; baseline audit: `memory-audit.md` (historical findings, not all fixed).
- Milestone 1 implemented: stable-ID transactional updates, FTS update trigger, content-only vector invalidation, one-time watermark reset on upgrade to repair previously stale rows. Tombstones retained; no production database rewrite during development.
- Verification: full `bun run check` passes, including isolated A→B revision, keyword replacement, pointer-only update (no extra embedding), rollback/no notification, no-op scans, reopen migration and tombstone regression. Existing Memory suites pass (35 Node test cases plus self-tests).
- English runtime copy verified with the full check suite (including narrow browser/card rendering).
- Timely indexing: successful `compress` completion now schedules bounded, coalesced current-session scans and automatic embedding during long tasks. Feedback is one English line, without previews or model details. Startup/settled/search scans remain fallbacks. Mock lifecycle regression covers processing before settled, delayed sidecar, repeat/no-op events and shutdown cancellation.
- Curated memory deferred per discussion: prioritize reliable and timely BCP summary retrieval rather than another memory layer. Milestone 2 is the final minimum-version step. Curated memory, automatic fact extraction and prompt injection remain out of scope; stop expanding the architecture after validation and observe real use.
- Project attribution is deliberately conservative: no relabeling legacy sessions from cwd, no automatic merging of aliases/clones/subdirectories, no known project from capped reference lists. Unknown/mixed history requires explicit scope: all.
- Source snapshots bind identity and complete content/reference revisions before result limits. Disabled, missing, unreadable or removed blocks do not participate in tool retrieval/uploads; no automatic deletion. Existing inactive BCP children remain eligible when present. Already-dispatched requests cannot be recalled.
- /memory is the only user command entry; old subcommands are rejected without executing actions. Maintenance lives in its menu, with input and confirmation dialogs.
- Known limits retained: 10000 eligible-row vector scan window, 6000-byte embedding prefix, operation-snapshot filesystem policy (not an atomic filesystem lock).
- Validation: full check passes (including 41 Node regression cases and inherited self-tests), SSH shim smoke passes. New regressions cover same-name/remote identities, actual pre-persistence message event order, resumed sessions, unavailable remote, capped references, tool-call suffixes, source revocation/absence/revision races, pre-limit policy filtering, ineligible-prefix backfill starvation and rejected old commands. No live SSH or paid embedding calls used for this change.
