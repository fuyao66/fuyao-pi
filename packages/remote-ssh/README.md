# Pi SSH Remote

A first-party plugin in [fuyao-pi](../../README.md): a dedicated SSH workspace bridge, **not an arbitrary plugin compatibility layer**.

Supported baseline: the `piVersion` in [`config/plugins.json`](../../config/plugins.json). Worker dependencies are pinned; a different Pi version requires rebuilding and validating the bridge. BC is an optional peer integration: when loaded, its local context and compression tools remain on the host and are never bundled into the remote worker.

## Execution boundary

| Operation | Execution location |
| --- | --- |
| `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls` | SSH workspace |
| Models, credentials, UI, sessions, BC proxy/context/compression tools | Local Pi |
| RPIV `ask_user_question` / `todo` | Local UI / local session state |
| `acp_delegate` orchestration and child Pi process | Local; child core tools inherit SSH workspace |
| Reading BC delegate/decompress artifacts | Local, through a narrow `read` exception |
| `!` / `!!` and `powershell` while remote | Blocked, never silently executed locally |

Ordinary absolute paths (including `/tmp`) refer to the remote machine. Only `$TMPDIR/acp-delegate/`, `~/.cache/pi/acp-decompress/`, and successful explicit `decompress` exports observed by the bridge route to local `read`. Use `read`, not remote `bash`, to inspect those files. Other tools do not gain local artifact access.

Delegates open independent SSH workers. Omit delegate `cwd`; the bridge keeps the process cwd local and inherits the parent's remote cwd. An explicit matching remote cwd is accepted; switching to unrelated workspaces through delegate cwd is rejected. Restricted delegate tool lists remain restricted. The bridge uses BC's `PI_CLI_PATH` override. After the first connection, a dispatcher remains for the lifetime of this Pi process: this is necessary because BC resolves queued delegates' CLI entrypoints at launch time. New local delegates pass through to the original CLI; already queued remote delegates retain their captured SSH connection. `/reload` preserves this routing.

## Local RPIV companions

Historical companion validation used `@juicesharp/rpiv-ask-user-question@2.11.0` and `@juicesharp/rpiv-todo@2.11.0` alongside Pi + BCP; current pins are in `config/plugins.json`. They need no remote adapter or worker dependency, and no plugin source patches:

- `ask_user_question` stays on the client: terminal overlays in interactive Pi, select/input dialogs with a compatible RPC UI. Headless delegates cannot ask interactive questions; the plugin hides the tool before a turn and rejects direct calls without UI. Its optional external editor also runs locally, using local configuration and temporary files.
- `todo` belongs to the Pi session, not a server directory. Connecting, switching servers or exiting does not start a separate task list. Reload reconstructs state from local session tool-result history; child sessions have their own lists.
- Their configuration stays local. Neither tool is admitted to the SSH worker. This is a verified pair of local companions, not support for arbitrary extensions which perform workspace IO directly.

## Build and load

Requires Bun for builds, Node compatible with the locked Pi baseline on the client, and OpenSSH `ssh`/`scp`. Remote targets are Linux x64 or arm64, with Bash. Install `rg` and `fd` on remote PATH for native Pi search tools (otherwise Pi's native tool discovery/download policy applies).

Run from the **fuyao-pi repository root**:

```sh
bun install --frozen-lockfile
bun run check
bun run build:pi-worker:all
bun run smoke:pi
```

The smoke test uses the compiled worker and a real restricted Pi SDK session through an **SSH process shim**, not a real SSH server or model provider. ARM64 is cross-compiled; run it on ARM64 separately.

Load alongside your existing BC installation:

```sh
pi -e /absolute/path/fuyao-pi/packages/remote-ssh/dist/pi-extension.js
```

For your custom Pi agent, load that same built entry through `DefaultResourceLoader.additionalExtensionPaths`. Do not load `host-extension.ts` directly: the package entry wires BC inheritance. Your delegate CLI (default Pi CLI, or an existing absolute `PI_CLI_PATH`) must honor Pi's `--extension` flag and the installed BC profile.

Do not enable the old AFT/FFF/RTK/Tintin managed entries. They and the plugin-selection build system have been removed. Building does not modify global Pi settings or install extensions into your agent. For this profile, setup disables ordinary BC auto-updates and retains critical-defect repairs; verify the actual installed/proxy baseline after repairs or deliberate upgrades.

Connection measurements and benchmark instructions: [Performance](docs/performance.md).

## Failure and resource limits

- Connection preparation reserves the remote execution domain before any SSH work. Workspace tools and local `!`/`!!` are blocked while connecting; failed or cancelled preparation stays fail-closed until `/remote-exit`. A second connection or exit during preparation is rejected. Stop/cancel the current connect first.
- Worker process errors, broken input pipes and unexpected protocol stdout EOF close the transport and reject pending calls. Cancellation waits up to 5 seconds for a terminal response, then closes the entire connection (including sibling calls). No command is retried automatically: a rejected call may already have performed remote writes.
- Transport cleanup escalates from SIGTERM to SIGKILL after 250 ms and bounds pipe cleanup. This reaps the local SSH process; it cannot guarantee termination of detached remote grandchildren or background jobs.
- The worker admits at most 32 simultaneous executions. Duplicate active request IDs fail the transport. Protocol frames are limited to 16 MiB, and buffered protocol output/input to 32 MiB; excess traffic closes the connection instead of growing memory without bound.
- Uploads use `scp -O` (legacy SCP) so shell-quoted remote paths work consistently with modern OpenSSH. The remote server must allow legacy SCP. Failed uploads get bounded best-effort temporary-file cleanup; a network outage can still leave temporary files on the server.

## Usage

```text
/remote-connect user@host /absolute/remote/project
/remote-status
/remote-exit
```

SSH aliases and explicit `--identity`, `--port`, `--known-hosts`, `--worker` options are supported. Host keys must already be trusted; password prompts and agent forwarding are disabled. Model-facing controls are `remote_connect`, `remote_workspace_status`, `remote_exit`.

Workers and the Photon image-processing WASM companion are deployed by content hash and reused. Existing transport/cache naming from the original project is retained; the fixed core runtime has its own `pi-bcp-v1` namespace. Transport failure blocks workspace calls until explicit exit; there is no local fallback. Exit waits for idle and reloads Pi's local tool registry. Reload restoration failure remains fail-closed.

Local configuration, skills and project instructions are **not** synchronized to remote. The prompt identifies the remote workspace and asks the agent to inspect its `AGENTS.md`; the bridge does not replace local resource discovery or sandbox arbitrary custom extensions. The supported stack is Pi core plus BC, with the local RPIV companions described above.

[简体中文](README.zh-CN.md) · [MIT](LICENSE)
