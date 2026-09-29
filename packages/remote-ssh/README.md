# Pi SSH Remote — Pi + billion-context-pi

A first-party plugin in [fuyao-pi](../../README.md): a dedicated SSH workspace bridge, **not an arbitrary plugin compatibility layer**.

Supported baseline: **Pi 0.87.1 + billion-context-pi 0.1.82 (`billion-context-pi:dist`)**. Worker dependencies are pinned; a different Pi version requires rebuilding and validating the bridge. BCP is supplied by the local agent, never bundled into the remote worker.

## Execution boundary

| Operation | Execution location |
| --- | --- |
| `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls` | SSH workspace |
| Models, credentials, UI, sessions, ACP context/compression tools | Local Pi |
| RPIV `ask_user_question` / `todo` | Local UI / local session state |
| `acp_delegate` orchestration and child Pi process | Local; child core tools inherit SSH workspace |
| Reading BCP delegate/decompress artifacts | Local, through a narrow `read` exception |
| `!` / `!!` and `powershell` while remote | Blocked, never silently executed locally |

Ordinary absolute paths (including `/tmp`) refer to the remote machine. Only `$TMPDIR/acp-delegate/`, `~/.cache/pi/acp-decompress/`, and successful explicit `decompress` exports observed by the bridge route to local `read`. Use `read`, not remote `bash`, to inspect those files. Other tools do not gain local artifact access.

Delegates open independent SSH workers. Omit delegate `cwd`; the bridge keeps the process cwd local and inherits the parent's remote cwd. An explicit matching remote cwd is accepted; switching to unrelated workspaces through delegate cwd is rejected. Restricted delegate tool lists remain restricted. The bridge uses BCP's `PI_CLI_PATH` override. After the first connection, a dispatcher remains for the lifetime of this Pi process: this is necessary because BCP resolves queued delegates' CLI entrypoints at launch time. New local delegates pass through to the original CLI; already queued remote delegates retain their captured SSH connection. `/reload` preserves this routing.

## Local RPIV companions

Verified with `@juicesharp/rpiv-ask-user-question@2.11.0` and `@juicesharp/rpiv-todo@2.11.0`, installed alongside Pi + BCP. They need no remote adapter or worker dependency, and no plugin source patches:

- `ask_user_question` stays on the client: terminal overlays in interactive Pi, select/input dialogs with a compatible RPC UI. Headless delegates cannot ask interactive questions; the plugin hides the tool before a turn and rejects direct calls without UI. Its optional external editor also runs locally, using local configuration and temporary files.
- `todo` belongs to the Pi session, not a server directory. Connecting, switching servers or exiting does not start a separate task list. Reload reconstructs state from local session tool-result history; child sessions have their own lists.
- Their configuration stays local. Neither tool is admitted to the SSH worker. This is a verified pair of local companions, not support for arbitrary extensions which perform workspace IO directly.

## Build and load

Requires Bun for builds, Node compatible with Pi 0.87.1 on the client, and OpenSSH `ssh`/`scp`. Remote targets are Linux x64 or arm64, with Bash. Install `rg` and `fd` on remote PATH for native Pi search tools (otherwise Pi's native tool discovery/download policy applies).

Run from the **fuyao-pi repository root**:

```sh
bun install --frozen-lockfile
bun run check
bun run build:pi-worker:all
bun run smoke:pi
```

The smoke test uses the compiled worker and a real restricted Pi SDK session through an **SSH process shim**, not a real SSH server or model provider. ARM64 is cross-compiled; run it on ARM64 separately.

Load alongside your existing BCP installation:

```sh
ACP_AUTO_UPDATE=0 pi -e /absolute/path/fuyao-pi/packages/remote-ssh/dist/pi-extension.js
```

For your custom Pi agent, load that same built entry through `DefaultResourceLoader.additionalExtensionPaths`. Do not load `host-extension.ts` directly: the package entry wires BCP inheritance. Your delegate CLI (default Pi CLI, or an existing absolute `PI_CLI_PATH`) must honor Pi's `--extension` flag and the installed BCP profile.

Do not enable the old AFT/FFF/RTK/Tintin managed entries. They and the plugin-selection build system have been removed. Building does not modify global Pi settings or install extensions into your agent. Disable BCP auto-update for this pinned profile, and revalidate when upgrading BCP.

## Usage

```text
/remote-connect user@host /absolute/remote/project
/remote-status
/remote-exit
```

SSH aliases and explicit `--identity`, `--port`, `--known-hosts`, `--worker` options are supported. Host keys must already be trusted; password prompts and agent forwarding are disabled. Model-facing controls are `remote_connect`, `remote_workspace_status`, `remote_exit`.

Workers and the Photon image-processing WASM companion are deployed by content hash and reused. Existing transport/cache naming from the original project is retained; the fixed core runtime has its own `pi-bcp-v1` namespace. Transport failure blocks workspace calls until explicit exit; there is no local fallback. Exit waits for idle and reloads Pi's local tool registry. Reload restoration failure remains fail-closed.

Local configuration, skills and project instructions are **not** synchronized to remote. The prompt identifies the remote workspace and asks the agent to inspect its `AGENTS.md`; the bridge does not replace local resource discovery or sandbox arbitrary custom extensions. The supported stack is Pi core plus BCP, with the local RPIV companions described above.

[简体中文](README.zh-CN.md) · [MIT](LICENSE)
