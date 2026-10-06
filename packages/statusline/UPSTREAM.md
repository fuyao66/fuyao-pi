# Source and local changes

Imported `src/`, `docs/` and MIT `LICENSE` from the published
`@narumitw/pi-statusline@0.50.2` package.
Upstream: https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-statusline

Local changes:
- Load source directly through Pi, with the upstream runtime dependency pinned.
- Context displays percentage and used/window tokens from `getContextUsage()`.
- Cache hit rate uses cumulative session input usage, not the latest request.
- Footer segments wrap before removal: prefer two balanced rows, use more rows
  when needed; respect explicit line breaks and terminal-column widths.

The original settings file and `/statusline` menu remain compatible. No editor,
tool execution, transcript or prototype patch is installed. Git refresh and other
extension statuses retain upstream behavior. Tests: `bun test packages/statusline/test`.
