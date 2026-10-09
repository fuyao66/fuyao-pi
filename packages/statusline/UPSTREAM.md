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
- Add an inline `fast` segment sourced from the GPT Fast plugin’s public status,
  suppress its duplicate extension row, and allow hiding all separate extension
  status rows via `showExtensionStatuses` and the Advanced menu.

The original settings file and `/statusline` menu remain compatible. No editor,
tool execution, transcript or prototype patch is installed. Git refresh and other
extension statuses retain upstream behavior unless their separate rows are hidden;
their underlying hooks and data are unaffected. Tests: `bun test packages/statusline/test`.
