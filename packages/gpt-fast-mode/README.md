# GPT Fast mode

A small local derivative: `/fast` toggles `service_tier: "priority"` for exact
provider/model allowlist matches. No provider registration, network probes, tools,
footer or editor patches. Default off. The backend may ignore or reject priority;
this plugin does not prove acceleration or adjust displayed costs.

Loaded by repository setup as `packages/gpt-fast-mode`. Do not also load another
`/fast` extension. Command arguments are ignored, matching upstream: `/fast on`
would still toggle; use `/fast` alone. Default shortcut `ctrl+alt+m`; configure
`"pi-gpt-fast-mode": []` in `<agent-dir>/keybindings.json` to disable it.

Defaults include only the user’s CPA GPT models (no official OpenAI providers):
`cpa/gpt-5.5`, `cpa/gpt-5.6-sol`, `cpa/gpt-5.6-terra`, `cpa/gpt-5.6-luna`,
`cpa/gpt-6.1-sol`, `cpa/gpt-6-luna`, `cpa/gpt-6-astra`, and the user’s alternate
`cpa-any/Any/gpt-6-astra`. Other models are unchanged.

Optional `<agent-dir>/settings.json` configuration:

```json
{
  "pi-gpt-fast-mode": {
    "enabled": false,
    "models": ["cpa/gpt-5.6-sol", "cpa/gpt-6-astra"]
  }
}
```

`models` replaces defaults, not adds to them; omit it to use defaults, `[]` disables
all matches. Invalid lists fail closed. Names are exact, no wildcards. Request
payload `model` must equal the selected model ID. `enabled` controls the initial
state; `/fast` changes only in-memory state and resets on session switch/reload.
Configuration lookup retains upstream behavior: `PI_CODING_AGENT_DIR`, XDG Pi
locations, then `~/.pi/agent`. Project settings are not read.

In the TUI, the public `setStatus()` API publishes `⚡ Fast` only when enabled and
the selected model matches the allowlist. The icon and label have one space between
them. When disabled, unsupported or absent, the status is removed entirely.

It updates on `/fast`, the shortcut, model selection and session start/reload; it
is cleared on shutdown. The local Statusline can display it inline with the `fast`
segment, using its configured palette and wrapping; a recognized inline value is
not repeated in a separate row. Hiding extension status rows does not hide this
main-line segment. Without the segment, the usual separate-row behavior applies
when extension rows are enabled. Non-TUI modes do not publish
footer status. The indicator describes client eligibility, not backend confirmation: the
request payload must still match the selected model, and the service may ignore
or reject priority. Model/lifecycle updates do not create extra notifications.

Only requests passing through this Pi instance’s payload hook are affected; this
is not a global switch for independent sub-agents or direct provider calls.
[Source and local changes](UPSTREAM.md).
