# Advisor source provenance

- Upstream: https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-advisor
- Imported npm artifact: `@juicesharp/rpiv-advisor@2.11.0`
- npm gitHead: `61904e69e1a50e12585bdf15f0310e633a62ba36`
- npm integrity: `sha512-/kFh5QW09LdsUlhY+3XSOOtpeBBPseRCjEHf440gKKfCk686v8LcHHzLCn6Mqzj6+IoGnDLn7HxayUFgnVgJ6w==`
- License: MIT, retained in `LICENSE`; original author: juicesharp.
- Local private package: `@fuyao/pi-advisor@2.11.0-fuyao.1`. Not published to npm.

## Local changes

The upstream `buildSessionContext(getEntries(), getLeafId())` path bypassed BCP's
request-time `context` transform. This fork instead captures a deep copy in
`context_with_system`, which Pi 0.87.1 dispatches after **all** `context` handlers.
It removes executor system/tool declarations, uses the Advisor system prompt,
adds the current caller's visible text (no unfinished calls/thinking), and keeps
the tool-free authenticated model call. Images are always replaced by a privacy
placeholder: nested model calls do not inherit Pi's `blockImages` or BCP's
provider-level image filtering. Active tools only are advertised; inventory cache
keys include descriptions/schemas so SSH target changes do not retain stale data.
Nested usage is returned at top level for Pi totals, including empty-response retries.

No fallback reads the session journal, sidecars, files, Git, or SSH workspace.
The snapshot is invalidated on turn/run/session/branch/compaction boundaries and
other tool execution. Advisor must be the **only** call in its assistant message.
Mixed batches, including `compress + advisor`, fail closed; call Advisor on the
next model turn after a fresh context transform. This trades same-turn parallel
consultation for predictable compressed context. A missing snapshot throws before
provider authentication/call; the Pi tool result reports the error.

The snapshot represents the conversation at this hook, not an exact serialized
provider payload. Later `context_with_system` handlers and provider payload
transforms are not captured. **Supported ordering contract:** no extension loaded
after Advisor may redact/replace context in `context_with_system` or replace the
caller in `message_end`. Ordinary `context` transforms are always safe regardless
of load order. If adding such an extension, arrange Advisor after it or disable
Advisor; Pi currently exposes no final read-only observation hook to enforce this
automatically. The tested profile uses BCP's ordinary `context` transform.
If BCP itself fails or is disabled, this hook receives
whatever context Pi continues with; it cannot independently certify BCP success.
Keep the pinned Pi/BCP baseline and revalidate on upgrade. Advisor's context window
may be smaller than the executor's; this patch adds no automatic fitting/truncation.

## Usage and configuration

Loaded through the root `fuyao-pi` manifest. Do not additionally install upstream
RPIV Advisor. `bun run setup --apply` removes duplicate npm/standalone package
entries. Explicit legacy `settings.extensions` paths need manual removal.

Restart Pi, then `/advisor` to choose a reviewer and effort. No model is selected
by this repository. Existing local `~/.config/rpiv-advisor/advisor.json` is reused;
its model and credentials are never committed. With no selection the tool stays
inactive. Advice is a separately billed model call and receives the **visible
compressed conversation**, which may still contain sensitive material.

Upstream README and reference docs are retained as historical documentation;
this file supersedes their statements about replaying the entire session branch.
The picker, model blocklist, prompt guidance, and reply handling are otherwise
retained. Advisor remains local and has no tools, including decompression.

Tests: `bun test packages/advisor/test`; root `bun run check` also includes Advisor
typechecking and regression tests. BCP is a pinned development dependency for the
real-compression test, not a second runtime extension loaded by this package.
