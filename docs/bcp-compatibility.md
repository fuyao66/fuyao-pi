# BCP compatibility

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
