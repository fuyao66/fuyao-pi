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

Do not vendor third-party code just to collect it. Keep a source derivative only when
personal changes or compatibility work justify maintenance ownership. Current examples
are UI customization, Advisor's BCP context adaptation and Memory's summary indexing.
Retain upstream licenses, import version/commit and local differences in `UPSTREAM.md`.
Update provenance when merging upstream changes; do not imply upstream endorses the fork.

Maintained runtime interface text is **English**. Do not translate user content or stored
memory summaries. English and Chinese root documentation should describe the same feature
set; Chinese documentation is not a runtime UI inconsistency.

## Development loop

1. Inspect `git status` before editing. Preserve unrelated work, especially concurrent UI
   changes; explicitly stage only the intended files.
2. Read the package contract and Pi APIs relevant to the change. Add regression tests for
   lifecycle, cancellation and non-interactive behavior, not just the happy path.
3. Run from the repository root:

   ```sh
   bun install --frozen-lockfile
   bun run check
   ```

   `check` performs typechecks, builds the local SSH entry, checks UI statically and runs
   tests. Memory uses Node's `node:sqlite`; run `bun run test:memory`, not `bun test` on
   its test directory. Tests disable real embedding configuration and use isolated data.
4. For remote worker/protocol or Pi runtime changes:

   ```sh
   bun run build:pi-worker:all
   bun run smoke:pi
   ```

   The smoke uses an SSH process shim and real worker/SDK code. It does not prove real
   network authentication, ARM64 execution or model-provider behavior.
5. For UI changes, inspect regular/fullscreen behavior, narrow terminals, resizing,
   Chinese input and theme changes. Static checks do not constitute visual acceptance.
6. Update the owning package contract and relevant integration docs. Restart Pi when
   changing loaded extension code; do not assume the running process hot-reloads it.

Document-only changes need link/path/command review, not paid model requests or another
full SSH test. If other work prevents a clean validation, test HEAD plus the intended
patch in an isolated directory rather than reverting someone else's work.

## Upgrading the environment

- Keep the installed Pi CLI consistent with root Pi dependencies and
  `config/plugins.json`'s `piVersion`; inspect child peer constraints and any fixed
  handshake/worker runtime expectations too. `setup` does not enforce the CLI version.
- BCP has both a runtime profile pin and a development dependency used in compatibility
  tests. Update deliberately, keep `ACP_AUTO_UPDATE=0` for pinned-stack validation,
  and revalidate Advisor's event ordering, Memory's sidecar parsing and remote delegation.
- A companion update changes `config/plugins.json`. Preview `bun run setup`, then apply
  and run `pi update --extensions` using the correct agent directory. Audit third-party
  executable/install behavior; a version pin is not a security review.
- Local source derivatives are merged manually. `pi update` is not an upstream-merge
  mechanism for code under `packages/`.
- Rebuild generated artifacts after relevant runtime changes. Keep `bun.lock` committed;
  never commit `node_modules`, worker binaries or local databases.

Changing a setting does not migrate every plugin's state. Some plugins use fixed paths
under the user's home directory. See [configuration](configuration.md) for backup,
rollback and agent-directory limitations.

## Release/checklist

- [ ] Behavior, docs and manifest entries agree; no promises for deferred designs.
- [ ] Required tests/builds passed; untested real-world boundaries are recorded.
- [ ] No duplicate root/child/upstream extension declarations.
- [ ] `git diff --check` passes; only intended files are staged.
- [ ] No private configuration, tokens, host inventory, sessions or databases staged.
- [ ] Licenses and source provenance remain intact.
- [ ] User-facing changes mention restart/migration requirements.

The packages are currently private workspace packages. Do not treat their versions or
retained upstream publishing metadata as an npm release pipeline. The repository is the
unit of delivery; an independent executable or automatic release framework is not provided.
