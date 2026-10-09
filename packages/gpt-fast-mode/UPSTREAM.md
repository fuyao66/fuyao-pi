# Source and local changes

Imported `src/index.ts` and MIT `LICENSE` from the published
`@tunnckocore/pi-gpt-fast-mode@0.4.0` package.
Upstream: https://github.com/tunnckoCore/pi-gpt-fast-mode

Local changes: replace official-provider defaults with the user’s explicit CPA GPT
models and add an optional replacement allowlist
in the existing settings block; reject array payloads. The request model must
match the selected model ID. Publish an enabled-and-eligible-only `⚡ Fast` status
through the public `setStatus()` API, updating on toggle, session start and model selection, with
shutdown cleanup. No provider, auth, routing, BCP or UI component modifications.
The upstream toggle and shortcut semantics remain: defaults off, reset on session
start/reload, runtime toggles are not persisted.

Tests: `bun test packages/gpt-fast-mode/test`; root `bun run check`.
