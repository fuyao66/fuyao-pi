# fuyao-pi

Fuyao's personal **Pi agent environment**: first-party plugins, a versioned third-party plugin profile, and portable configuration. This is not a Pi fork and not just an SSH plugin repository.

The original `pi-ssh-remote` repository evolves here with its Git history intact. **remote-ssh remains a first-party plugin**, with its own package identity and runtime protocol unchanged. Third-party plugins normally reference upstream packages. **UI, Advisor and Memory are explicit source exceptions**: maintained for UI customization, BCP compatibility and hybrid memory retrieval, with upstream licenses and attribution preserved.

[简体中文](README.zh-CN.md) · [Plugin inventory](docs/plugins.md) · [Configuration & migration](docs/configuration.md)

## Layout

```text
packages/remote-ssh/    First-party SSH plugin: source, tests, build scripts
packages/ui/            Customizable Sakura Cyberdeck source fork + licenses
packages/advisor/       RPIV Advisor fork using BCP-transformed context
packages/memory/        BCP enhancement: lexical + opt-in embedding hybrid retrieval
config/plugins.json    Third-party package sources pinned to versions/commits
config/settings.json   Portable personal defaults (no models or credentials)
scripts/setup.ts       Preview/apply the profile to a Pi agent directory
test/                  Profile-management tests
skills/                Future first-party skills
prompts/               Future first-party prompt templates
themes/                Future additional themes (current theme lives in packages/ui)
```

More self-developed plugins belong under `packages/<name>/`. Add their public entries to the root `pi` manifest; do not copy other third-party implementations there; UI, Advisor and Memory are documented exceptions. Resource directories currently contain placeholders, not invented personal workflows.

## Install

Baseline: **Pi 0.87.1**, **billion-context-pi 0.1.82**, Bun, Node.js 22.19+ and OpenSSH. Follow any stricter engine requirement from Pi's package. Remote workers support Linux x64/arm64. Credentials and custom model endpoints stay in the local Pi agent directory.

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.87.1
git clone https://github.com/fuyao66/fuyao-pi.git
cd fuyao-pi
bun install --frozen-lockfile
bun run check
bun run build:pi-worker:all
bun run smoke:pi

# Inspect the profile first; this does not write files or install plugins.
bun run setup
# Merge declarations and defaults; save a private backup of existing settings.
bun run setup --apply
# Pi downloads/reconciles upstream plugins. Review those packages before loading.
pi update --extensions
ACP_AUTO_UPDATE=0 pi
```

The setup script preserves existing preferences, provider/model selection, resource paths, extra packages, and third-party resource filters (except replaced external UI / Advisor / Memory declarations). Managed plugin sources are pinned to the profile. It does not copy or read `auth.json`, `models.json`, web credentials, sessions, or SSH keys. It does not install dependencies itself. Use `--agent-dir /path` to target another Pi profile; launch that profile with `PI_CODING_AGENT_DIR=/path` too.

**Clone and build is the supported installation path.** A bare `pi install git:github.com/fuyao66/fuyao-pi` does not build the ignored worker binaries or configure companion packages. The root Pi manifest exposes first-party resources and the in-tree UI / Advisor / Memory; the setup script composes the full profile.

## Remote workspace

```text
/remote-connect user@host /absolute/project
/remote-status
/remote-exit
```

Core filesystem/shell tools run remotely. Models, credentials, sessions, UI and BCP orchestration stay local. Third-party packages are **not automatically adapted to remote IO**. See [remote-ssh](packages/remote-ssh/README.md) for boundaries, build details, and limitations.

## Development

```sh
bun run check                 # core/profile typecheck + build + UI static check + tests
bun run build:pi-worker:all    # compiled Linux workers and companions
bun run smoke:pi              # real worker/SDK through an SSH process shim
```

The smoke test is not a real SSH server or model-provider test; ARM64 requires separate runtime validation. Upgrading Pi/BCP requires rebuilding and revalidating the bridge. Keep `ACP_AUTO_UPDATE=0` for the pinned BCP profile.

## UI customization

Edit [`packages/ui/`](packages/ui/UPSTREAM.md) directly. The root package loads its five extension entries and theme; setup replaces the old upstream UI declaration to prevent duplicate UI patches. The source is now yours to maintain, not auto-updated from upstream. Imported UI logic is unchanged in this migration. UI static checks do not replace interactive terminal testing.

## BCP-compatible Advisor

[`packages/advisor/`](packages/advisor/UPSTREAM.md) keeps the `/advisor` picker and parameterless consultation, but captures the request-time transformed conversation instead of rebuilding raw history. Advisor must be the only tool call in its batch. After compression or other tools, consult on the next model turn; missing/stale snapshots fail closed without journal replay.

Restart Pi and select a reviewer with `/advisor`. No model or credentials are committed. The reviewer has no tools or workspace access; each consultation is separately billed. Later provider payload transforms are not captured, and smaller reviewer context windows are not automatically fitted. See the provenance document for precise limits.

## BCP memory enhancement

[`packages/memory/`](packages/memory/README.md) derives from pi-billion-memory, preserving the existing database, allow-list and FTS5/LIKE search. Opt-in remote embeddings add SQLite vectors, cosine retrieval and RRF fusion; failures fall back to lexical search. It changes no BCP compression algorithm and never automatically uploads the entire history.

Local `autoBackfill:true` enables nonblocking startup and incremental summary embedding with bounded batches and failure backoff. `/memory embed status` reports coverage and scheduler state. Manual `/memory embed backfill [1-100]` remains available with UI confirmation. Enabled searches with indexed vectors send redacted queries to the configured service. Public defaults are disabled; endpoint and credential files remain local. Redaction is best-effort, not a guarantee of non-sensitive input. See the package docs for limits and configuration.

Memory tests require Node `node:sqlite`: `bun run test:memory`, also included in root `bun run check`. Do not run these files with Bun's test runtime.

## Privacy

Never commit credentials, private endpoints, host inventories, databases, or sessions. Machine-specific overrides belong outside the repository (or in ignored `local/`). Public defaults deliberately omit default providers/models. Native compaction is disabled in this BCP profile; re-enable it if BCP is removed. The current personal retry policy allows 20 retries and may incur extra latency/cost; adjust locally if needed.

[MIT](LICENSE). Third-party packages retain their own licenses and ownership.
