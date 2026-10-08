# BCP compatibility

## Error-usage protection and Goal integration

The current exact source is pinned in `config/plugins.json`. Its reviewed upstream
PR build includes [#601](https://github.com/ranxianglei/billion-context-pi/pull/601)
and [#611](https://github.com/ranxianglei/billion-context-pi/pull/611): failed-request
usage without a trusted anchor is not treated as real emergency pressure, and the
status panel uses the same policy. Genuine pressure and overflow protection remain
active. This is not a fix for Pi or third-party footer estimates.

Validation: 20 focused upstream tests, seven isolated published-package cases,
actual sidecar ingestion into Memory plus mock vector backfill, and local regression
suites. No paid provider or deliberate live network-failure test was used. Sidecar
format and Memory storage remain compatible; no re-embedding is required.

`test/goal-compat.test.ts` verifies the installed Narumitw Goal with BCP in both load
orders: canonical old single-goal restoration, actual compression, retained active
contract without raw-history resurrection, one continuation, reload and completion.
Tests require the profile packages to be installed; `FUYAO_TEST_AGENT_DIR` selects a
profile. Remote SSH host routing and compiled-worker shim were also checked: Goal
controls remain local and workspace tools remain remote. Real SSH/ARM execution is
not covered. Resume Goal with `/goal resume`, not `/continue`; experimental old queue
states are outside the tested migration contract.

## Pi runtime upgrade validation

The Pi runtime and companion versions are pinned in `config/plugins.json`.
The reviewed runtime upgrade preserved the BCP pin and required no Memory migration.
Validation covered both Goal/BCP load orders, real compression, reload/completion,
and aborted-run pausing; Remote SSH workers were rebuilt for both architectures.
The compiled x64 worker and inherited child passed the SSH process shim, including
text/image `structuredContent` forwarding. The full profile loaded without extension
errors or warnings; native Codemode read text and images in an isolated SDK session.
No paid model calls, real SSH server or ARM execution were involved.

## 0.1.82 → 0.1.83

[Upstream comparison](https://github.com/ranxianglei/billion-context-pi/compare/v0.1.82...v0.1.83)

Release changes:

- Fork hosts derive their configuration directory from the host, with a legacy `.pi` fallback. Normal Pi behavior is unchanged.
- Optional `hostSession.customMessageTypes` limits which custom messages count as turn boundaries. This is not a context-content filter.
- BCP decompression can recover fork-host `live-*` references through sidecar identity mappings and ancestor logs.
- Nudge reminders are persisted as display-only `acp-nudge` entries; log strings escape embedded newlines.

No Memory migration is required for this release: sidecar schema v1, block fields,
compression save ordering and delegate launch contracts remain compatible. The kernel
dependency remains 0.0.98. Custom nudge entries are not conversation messages or Memory
summary blocks.

Validation used an isolated checkout and the downloaded 0.1.83 artifact: the real BCP
compression/Advisor-context regression passed, as did the existing Memory suites.
The Memory suites use synthetic fixtures and mocked providers; they are not a live
provider or every-host certification. No production database migration or embedding
rebuild was performed.

Known boundaries:

- Memory's optional `memory_expand` does not implement BCP's new fork-host identity/
  ancestor recovery. Missing references remain reported as missing.
- A successful compress tool result is not proof of durable sidecar persistence;
  Memory retains bounded rescan retries and startup/settled scan fallbacks.
- `pi list` shows the configured package source, not the loaded process version.
  Disk packages, configured pins and already-running processes can differ.

BCP is a pinned community peer plugin, not a fuyao-pi or Remote SSH source dependency.
The current profile selects the validated release in `config/plugins.json` and disables
BCP's official automatic updater through `setup --apply`. Future BCP releases should be
reviewed as a complete profile update; this compatibility record should be extended
before changing that pin.
