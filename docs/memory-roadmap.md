# Memory roadmap

## Goal
Deliver a small BCP-compatible project and long-term memory plugin: correctly synchronized summaries, reliable project scope, sourced curated memories, and on-demand retrieval with tests and migration notes. This file tracks work; it does not activate the Goal extension or promise unattended execution after Pi exits.

## Constraints
- Do not modify BCP source or reconstruct full conversation context.
- Keep one `/memory` entry point and short, stable tool guidance.
- All maintained plugin interface text must be English (menus, status, errors, notifications, tool guidance). Preserve original language of stored memories and user-authored titles.
- No automatic production-history deletion, bulk paid model extraction, or unrelated UI edits.
- Tests use isolated stores and mock embedding providers.

## Milestones
1. **Implemented and tested: revision consistency.** Preserve row IDs while updating summary/topic/references together; update FTS and invalidate content-dependent vectors, preserve tombstones. Test revisions, rollback and idempotence.
2. **Pending: project identity and policy.** Stable project identity including SSH workspace changes; consistent source/block policy for ingestion, retrieval and uploads; project-first retrieval.
3. **Deferred (optional): curated memory.** Sourced project/global entries, authorized save/update, replacement history, `/memory` management and concise tool guidance. No automatic promotion of model guesses to user requirements.
4. **Implemented and tested: English interface consistency.** Memory menus, browser, activity cards, status and confirmation messages now use English. Runtime scans found no Chinese copy in remote-ssh, Advisor or UI extension code. Chinese credential detection and user-authored memories/test fixtures are deliberately preserved; concurrent UI edits untouched.

## Progress
- Design: `memory-design.md`; baseline audit: `memory-audit.md` (historical findings, not all fixed).
- Milestone 1 implemented: stable-ID transactional updates, FTS update trigger, content-only vector invalidation, one-time watermark reset on upgrade to repair previously stale rows. Tombstones retained; no production database rewrite during development.
- Verification: full `bun run check` passes, including isolated A→B revision, keyword replacement, pointer-only update (no extra embedding), rollback/no notification, no-op scans, reopen migration and tombstone regression. Existing Memory suites pass (35 Node test cases plus self-tests).
- English runtime copy verified with the full check suite (including narrow browser/card rendering).
- Timely indexing: successful `compress` completion now schedules bounded, coalesced current-session scans and automatic embedding during long tasks. Feedback is one English line, without previews or model details. Startup/settled/search scans remain fallbacks. Mock lifecycle regression covers processing before settled, delayed sidecar, repeat/no-op events and shutdown cancellation.
- Curated memory deferred per discussion: prioritize reliable and timely BCP summary retrieval rather than another memory layer. Next: milestone 2. Each functional milestone gets an independent commit; this document records remaining work.
