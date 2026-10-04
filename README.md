# fuyao-pi

Personal Pi Agent environment with customized extensions and configuration.

[简体中文](README.zh-CN.md) · [Documentation](docs/README.md) · [Architecture](docs/architecture.md) · [Maintenance](docs/maintenance.md)

## Plugins

**10 plugin packages: 1 first-party, 3 locally modified, and 6 community packages.** Pi core is the runtime, not a plugin. The UI's five extension entries and theme count as one package.

| Plugin | Ownership / origin | Purpose |
| --- | --- | --- |
| [Remote SSH](packages/remote-ssh/README.md) | First-party, `pi-ssh-remote` | Core workspace tools over SSH, inherited delegate connections, local orchestration |
| [UI](packages/ui/UPSTREAM.md) | Locally maintained derivative | Terminal editor, messages, tool output, header, quota display and theme |
| [Advisor](packages/advisor/UPSTREAM.md) | Locally maintained derivative | Second-model review of BCP-transformed context instead of raw history replay |
| [Memory](packages/memory/UPSTREAM.md) | Locally maintained derivative | Cross-session BCP summary search, project scope, incremental synchronization and optional embedding-based hybrid retrieval |
| `billion-context-pi` (BCP) | Community, directly installable | Context compression, recovery, diagnostics and sub-agent delegation |
| `@juicesharp/rpiv-ask-user-question` | Community, directly installable | Structured single/multiple-choice questions and custom input |
| `@juicesharp/rpiv-todo` | Community, directly installable | Task lists, status tracking and dependencies |
| `pi-web-access` | Community, directly installable | Web search, content fetching and source checks |
| `@schovest/pi-goal` | Community, directly installable | Session goals with bounded automatic progress and completion/blocker reporting |
| `pi-invisible-continue` | Community, directly installable | Automatic continuation signals to reduce manual continue prompts |

The four local packages are built/configured through this repository; the six community packages use upstream implementations. See the [full inventory](docs/plugins.md) for versions, upstream links, local modifications and standalone installation commands.

## Quick start

Runtime: Pi, Node.js **22.19+**, Bun and Git; SSH workflows also require OpenSSH. The remote worker targets Linux x64/arm64. The supported Pi baseline is recorded in `config/plugins.json` and the dependency lock. See [configuration](docs/configuration.md) before applying the profile to an existing Pi installation.

```sh
git clone https://github.com/fuyao66/fuyao-pi.git
cd fuyao-pi
# Use the Pi baseline from the profile (never an unreviewed latest).
PI_VERSION=$(node -p 'JSON.parse(require("fs").readFileSync("config/plugins.json", "utf8")).piVersion')
npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@$PI_VERSION"
bun install --frozen-lockfile
bun run check

# Preview, then back up and merge the public profile.
bun run setup
bun run setup --apply
# Download the pinned companion packages, then restart Pi.
node -e 'for (const source of JSON.parse(require("fs").readFileSync("config/plugins.json", "utf8")).packages) console.log(source)' |
  while IFS= read -r source; do pi install "$source" || exit 1; done
pi
```

For a fully pinned CLI dependency tree, use the official managed installer with the reviewed release; an exact global npm version alone does not lock transitive dependencies. See [maintenance](docs/maintenance.md).

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
- Public settings disable native automatic compaction for the BCP profile and allow up to 20 retries. Setup also disables BCP's automatic updater for the pinned profile. Existing settings take precedence; review latency/cost trade-offs.
- Keep credentials, private endpoints, host inventories, sessions and databases out of Git. Setup merges declarations/defaults; it neither installs models nor copies private plugin state.
- `bun run check` includes Memory's Node-based SQLite tests. SSH smoke uses a process shim, not a real SSH server; terminal visuals, real providers and ARM64 execution need separate validation.

See [maintenance](docs/maintenance.md) for adding extensions and upgrading the stack, and the [documentation map](docs/README.md) for current contracts versus historical proposals.

[MIT](LICENSE). Imported components retain their own licenses and ownership.
