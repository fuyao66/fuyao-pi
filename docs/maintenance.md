# Maintenance guide

[Documentation index](README.md) · [Architecture](architecture.md)

## Where changes belong

| Change | Location |
| --- | --- |
| First-party capability or necessary upstream adaptation | `packages/<name>/` |
| Third-party capability usable without local modifications | Pin source/version in `config/plugins.json` |
| Public, portable default | `config/settings.json` |
| Enabled local extension/resource entry | Root `package.json` → `pi` |
| Profile migration/setup behavior | `scripts/setup.ts` and `test/setup.test.ts` |
| Plugin-local tests | That plugin's test directory and root check integration |
| Cross-package behavior | Root `test/` or owning package integration tests |
| Private keys, providers, sessions and memory data | Local runtime configuration, never Git |

Prefer upstream packages unless local changes require maintaining a derivative.
Retain licenses, import version/commit and local differences in `UPSTREAM.md`, and
update provenance when merging upstream changes.

Maintained runtime interface text is **English**. Do not translate user content or stored
memory summaries. English and Chinese root documentation should describe the same feature
set.

Host-provided Pi modules and TypeBox belong in extension `peerDependencies` with a
`"*"` range, not runtime dependencies. The root workspace dependencies and lockfile
own the build baseline. A regression test checks local manifests; upstream warnings
should be fixed in a reviewed update, not hidden by editing installed package files.

## Development loop

1. Keep each change focused and preserve unrelated work.
2. Read the package contract and Pi APIs relevant to the change. Add regression tests for
   lifecycle, cancellation and non-interactive behavior, not just the happy path.
3. Run from the repository root:

   ```sh
   bun install --frozen-lockfile
   bun run check
   ```

   `check` performs typechecks, builds the local SSH entry and runs tests. Memory uses Node's `node:sqlite`; run `bun run test:memory`, not `bun test` on
   its test directory. Tests disable real embedding configuration and use isolated data.
4. For remote worker/protocol or Pi runtime changes:

   ```sh
   bun run build:pi-worker:all
   bun run smoke:pi
   ```

   The smoke uses an SSH process shim and real worker/SDK code. It does not prove real
   network authentication, ARM64 execution or model-provider behavior.
5. Update the owning package contract and relevant integration docs. Restart Pi when
   changing loaded extension code; do not assume the running process hot-reloads it.

For documentation-only changes, check links, paths and example commands. BC wire/native integration is checked separately with `node --import tsx scripts/verify-billion-context.mjs <reviewed-installed-package> [installed-goal-package]`; this harness invokes the native probe, which launches `scripts/verify-billion-delegate.mjs` through the real dispatcher for delegate/SSH-shim routing. Run the parent harness, not the internal delegate child alone. The harness isolates runtime state and uses a loopback mock provider. See [migration and acceptance](billion-context-migration.md); retained BCP records are historical only.

## Upgrading the environment

- Keep the installed Pi CLI consistent with root Pi dependencies and
  `config/plugins.json`'s `piVersion`; inspect child peer constraints and any fixed
  handshake/worker runtime expectations too. `setup` does not enforce the CLI version.
  The official managed installation pins the CLI's transitive tree via its release
  `package-lock.json`; an exact global npm package version alone does not. Review the
  installer target against the manifest before switching, and keep the previous
  executable/profile backup for rollback. Do not run an unreviewed core update.
- Community packages are pinned in `config/plugins.json`; update them as one reviewed
  profile. `bun run setup --apply` sets BC `autoUpdate: false`, `advisoryCheck: true`: ordinary upgrades are reviewed, while critical-defect auto-repairs remain enabled and may change the installed baseline. Environment overrides take precedence; verify actual proxy and disk versions.
- A companion update changes `config/plugins.json`. Preview `bun run setup`, then apply
  and run `pi install <exact-source>` for each changed manifest entry using the correct
  agent directory (see the root README loop for a fresh profile). Pi's extension updater
  skips pinned npm sources; its success message does not prove a changed pin was installed.
  Verify installed manifests against the profile. Audit third-party executable/install
  behavior; a version pin is not a security review.
- Local source derivatives are the second locked class: checked-in source and Git commit
  are authoritative, while `UPSTREAM.md` records imported source and local differences.
  `pi update --extensions` is not an upstream-merge mechanism for code under `packages/`.
- Rebuild generated artifacts after relevant runtime changes. Keep `bun.lock` committed;
  never commit `node_modules`, worker binaries or local databases.

Changing a setting does not migrate every plugin's state. Some plugins use fixed paths
under the user's home directory. See [configuration](configuration.md) for backup,
rollback and agent-directory limitations.

## Release/checklist

- [ ] Behavior, docs and manifest entries agree; no promises for deferred designs.
- [ ] Required tests/builds passed; untested real-world boundaries are recorded.
- [ ] No duplicate local/upstream extension declarations; root resources and child plugins remain separate.
- [ ] `git diff --check` passes; only intended files are staged.
- [ ] No private configuration, tokens, host inventory, sessions or databases staged.
- [ ] Licenses and source provenance remain intact.
- [ ] User-facing changes mention restart/migration requirements.

Packages are private workspaces and are not published to npm.
