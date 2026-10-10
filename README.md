# fuyao-pi

Personal Pi Agent environment with customized extensions and configuration.

[简体中文](README.zh-CN.md) · [Documentation](docs/README.md) · [Architecture](docs/architecture.md) · [Maintenance](docs/maintenance.md)

## Plugins

**10 enabled plugin packages: 1 first-party, 3 locally maintained derivatives, and 6 community packages.** Pi core is the runtime, not a plugin. Advisor source is retained but disabled.

| Plugin | Ownership / origin | Purpose |
| --- | --- | --- |
| [Remote SSH](packages/remote-ssh/README.md) | First-party, `pi-ssh-remote` | Core workspace tools over SSH, inherited delegate connections, local orchestration |
| [Advisor](packages/advisor/UPSTREAM.md) | Retained derivative, disabled | Historical review integration; not certified for the current BC proxy |
| [Billion Memory](packages/bili-memory/README.md) | Locally maintained derivative | Authorized BC/migrated-summary search, exact workspace evidence, incremental synchronization and optional hybrid retrieval |
| [Statusline](packages/statusline/README.md) | Locally maintained derivative | Native footer, cumulative cache rate and responsive wrapping |
| [GPT Fast](packages/gpt-fast-mode/README.md) | Locally maintained derivative | Exact user-model allowlist and priority request toggle |
| `billion-context` (BC) | Community, directly installable | Pi-native entry and local proxy for context compression, recovery, diagnostics and delegation |
| `@juicesharp/rpiv-ask-user-question` | Community, directly installable | Structured single/multiple-choice questions and custom input |
| `@juicesharp/rpiv-todo` | Community, directly installable | Task lists, status tracking and dependencies |
| `pi-web-access` | Community, directly installable | Web search, content fetching and source checks |
| `@narumitw/pi-goal` | Community, directly installable | Session goals with bounded automatic progress and completion/blocker reporting |
| `pi-invisible-continue` | Community, directly installable | Automatic continuation signals to reduce manual continue prompts |

Four local packages are enabled through this repository; Advisor remains available as source only. The six community packages use upstream implementations. See the [full inventory](docs/plugins.md) for versions, upstream links, local modifications and standalone installation commands.

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

**Clone and build is the supported installation path.** A bare `pi install git:github.com/fuyao66/fuyao-pi` does not build workers or install the companion profile. Setup registers Billion Memory, Remote SSH, Statusline and GPT Fast as separate local packages, visible in `pi list`, and removes deferred Advisor declarations. Do not also install the upstream versions of these local plugins.

## Everyday entry points

- **`/bili-memory`** — browse memories, view status or refresh authorized sources. No technical maintenance submenu. Model retrieval defaults to the current workspace; explicit `scope: "all"` is needed for cross-project or unknown/legacy history.
- **Advisor** — disabled in this profile; its legacy context contract is not proof of BC proxy compatibility.
- **`/remote-connect`**, **`/remote-status`**, **`/remote-exit`** — enter, inspect and leave an SSH workspace.
- Context compression, delegation and companion commands remain owned by their respective upstream plugins; see the [inventory](docs/plugins.md).

Memory embeddings are opt-in and send sanitized summary prefixes and queries to an external service. Sanitization is best-effort; read the [Memory configuration and limits](packages/bili-memory/README.md) before enabling them.

## Repository structure

```text
package.json / bun.lock  Composition manifest, runtime baseline and dependency lock
packages/
  advisor/               Retained legacy review derivative; disabled
  bili-memory/           Billion Memory: BC + migrated-summary retrieval
  remote-ssh/            First-party remote execution extension and worker
  statusline/             Native footer derivative
  gpt-fast-mode/          Allowlisted priority tier toggle
config/                  Public settings and pinned companion sources
scripts/                 Environment setup and integration tooling
test/                    Cross-package/profile regression tests
docs/                    Architecture, setup, maintenance and design records
themes/                  Standalone Pi theme palette
skills/ prompts/         Reserved personal resources (currently placeholders)
```

Each plugin contains its source, tests and provenance. Appearance uses Pi's native theme system and settings; `themes/fuyao-soft.json` is a standalone palette, not a UI plugin.

## Boundaries and maintenance

- Pi core remains upstream. Local derivatives retain licenses and attribution; upstream updates require deliberate review, not blind replacement.
- Models, sessions, UI, the BC proxy and Billion Memory indexing stay local; only supported workspace operations run remotely. Other plugins are **not automatically SSH-aware**.
- Public settings disable native automatic compaction for the BC profile and allow up to 20 retries. Setup sets BC `autoUpdate: false`, `advisoryCheck: true`: ordinary updates are reviewed, critical-defect repairs remain enabled and may change the installed version. Existing Pi preferences take precedence; review latency/cost trade-offs.
- Keep credentials, private endpoints, host inventories, sessions and databases out of Git. Setup merges declarations/defaults; it neither installs models nor copies private plugin state.
- `bun run check` includes Memory's Node-based SQLite tests. SSH smoke uses a process shim, not a real SSH server; terminal visuals, real providers and ARM64 execution need separate validation.

Billion Memory uses exact BC session status for collection, optional fork-safe snapshots for workspace attribution, and a separate `~/.pi/bili-memory/` index. All 845 legacy summaries are preserved in authorized immutable archives, and all 704 original vectors are retained in the new index. Separately, 16 retained legacy sessions were rebuilt under the same names with full Pi histories and native BC state (574 retained blocks, 396 active at publication). BC itself remains unmodified; nested parent `full` restoration retains the upstream limitation, with individual child restoration available. See [migration and acceptance](docs/billion-context-migration.md).

See [maintenance](docs/maintenance.md) for adding extensions and upgrading the stack, and the [documentation map](docs/README.md) for current contracts versus historical proposals.

[MIT](LICENSE). Imported components retain their own licenses and ownership.
