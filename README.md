# fuyao-pi

Personal Pi Agent environment with customized extensions and configuration.

[简体中文](README.zh-CN.md) · [Documentation](docs/README.md) · [Architecture](docs/architecture.md) · [Maintenance](docs/maintenance.md)

## What the environment includes

| Capability | Implementation | Responsibility |
| --- | --- | --- |
| Agent runtime | Upstream Pi core | Model access, sessions, tools and extension lifecycle |
| Context management | Pinned billion-context-pi (BCP) | Compression, recovery and delegation |
| Terminal experience | [`packages/ui`](packages/ui/UPSTREAM.md) | Locally maintained Sakura-derived interface and theme |
| Second opinion | [`packages/advisor`](packages/advisor/UPSTREAM.md) | Tool-free review using BCP-transformed conversation snapshots |
| Project memory | [`packages/memory`](packages/memory/README.md) | Cross-session summary search, workspace scope and optional embeddings |
| Remote workspace | [`packages/remote-ssh`](packages/remote-ssh/README.md) | Run core workspace tools over SSH while keeping orchestration local |
| Companion tools | [`config/plugins.json`](config/plugins.json) | Pinned question, task, web, goal and continuation extensions |

## Quick start

Baseline: **Pi 0.87.1 + BCP 0.1.82**. Use Node.js **22.19+**, Bun and Git; SSH workflows also require OpenSSH. The remote worker targets Linux x64/arm64. See [configuration](docs/configuration.md) before applying the profile to an existing Pi installation.

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.87.1
git clone https://github.com/fuyao66/fuyao-pi.git
cd fuyao-pi
bun install --frozen-lockfile
bun run check

# Preview, then back up and merge the public profile.
bun run setup
bun run setup --apply
# Review companion packages before downloading/loading them.
pi update --extensions
ACP_AUTO_UPDATE=0 pi
```

`check` builds the local remote-ssh entry; **it does not compile remote workers**. Before the first SSH connection:

```sh
bun run build:pi-worker:all
bun run smoke:pi
```

Configure model access separately in your local Pi environment. Advisor model selection and Memory embedding service credentials are not supplied by this repository. For a custom agent directory, use the same `PI_CODING_AGENT_DIR` for setup, update and launch; some plugin-specific state still uses fixed home-directory paths.

**Clone and build is the supported installation path.** A bare `pi install git:github.com/fuyao66/fuyao-pi` does not build workers or install the companion profile. Setup registers UI, Advisor, Memory and Remote SSH as separate local packages, visible in `pi list`. Do not also install the upstream versions of these local plugins.

## Everyday entry points

- **`/memory`** — browse indexed summaries and manage sources, vector status and maintenance. Model retrieval defaults to the current workspace; explicit `scope: "all"` is needed for cross-project or unknown/legacy history.
- **`/advisor`** — choose a reviewer model. Consultations are separately billed and must run alone, using a fresh transformed-context snapshot.
- **`/remote-connect`**, **`/remote-status`**, **`/remote-exit`** — enter, inspect and leave an SSH workspace.
- Context compression, delegation and companion commands remain owned by their respective upstream plugins; see the [inventory](docs/plugins.md).

Memory embeddings are opt-in and send sanitized summary prefixes and queries to an external service. Sanitization is best-effort; read the [Memory configuration and limits](packages/memory/README.md) before enabling them.

## Repository structure

```text
package.json / bun.lock  Composition manifest, runtime baseline and dependency lock
packages/
  ui/                    Maintained terminal UI derivative
  advisor/               Maintained BCP-compatible Advisor derivative
  memory/                Maintained BCP memory enhancement
  remote-ssh/            First-party remote execution extension and worker
config/                  Public settings and pinned companion sources
scripts/                 Environment setup and integration tooling
test/                    Cross-package/profile regression tests
docs/                    Architecture, setup, maintenance and design records
skills/ prompts/ themes/ Reserved personal resources (currently placeholders)
```

Each plugin contains its source, tests and provenance. Current UI themes live in `packages/ui/themes`.

## Boundaries and maintenance

- Pi core remains upstream. Local derivatives retain licenses and attribution; upstream updates require deliberate review, not blind replacement.
- Models, sessions, UI, Advisor, Memory and BCP orchestration stay local; only supported workspace operations run remotely. Other plugins are **not automatically SSH-aware**.
- Public settings disable native automatic compaction for the BCP profile and allow up to 20 retries. Existing settings take precedence; review latency/cost trade-offs. Keep `ACP_AUTO_UPDATE=0` when validating against the pinned BCP version.
- Keep credentials, private endpoints, host inventories, sessions and databases out of Git. Setup merges declarations/defaults; it neither installs models nor copies private plugin state.
- `bun run check` includes Memory's Node-based SQLite tests. SSH smoke uses a process shim, not a real SSH server; terminal visuals, real providers and ARM64 execution need separate validation.

See [maintenance](docs/maintenance.md) for adding extensions and upgrading the stack, and the [documentation map](docs/README.md) for current contracts versus historical proposals.

[MIT](LICENSE). Imported components retain their own licenses and ownership.
