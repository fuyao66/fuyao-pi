# Statusline

Native footer derivative. [Source and license](UPSTREAM.md).

Setup replaces `npm:@narumitw/pi-statusline` with this local package. Do not load
both: they own the same footer and `/statusline` command. Run `bun install
--frozen-lockfile`, then setup, and reload Pi.

Existing `<agent-dir>/pi-statusline.json` settings and the `/statusline` menu are
preserved, including palette, segment order, model shortening and icons.

- Context: `26.0% 104k/400k`. Values come from Pi and may be estimates; unknown
  usage is `?`, and over-window values are not clamped. BC now folds the outgoing
  request in a local proxy after Pi builds its context. This footer does not
  independently measure that final proxy-folded payload or its token count; Pi's
  context estimate can therefore differ. It is not a compression-block count or
  an independent provider measurement.
- Cache: `R… W… CHavg 82.7%`. Average = cumulative cacheRead /
  (input + cacheRead + cacheWrite). Cache writes are misses, output is excluded.
  Includes recorded tool side-call, compaction and branch-summary usage, following
  the upstream session totals across all persisted entries, not only the active
  branch. Unknown/unrecorded usage is not estimated. Zero total has no percentage.
- Layout: one row when it fits, otherwise two balanced rows when possible, keeping
  segment order. Extremely narrow screens can need more rows; no priority-based
  segment removal. A glyph wider than the whole terminal cannot be displayed.
  Explicit `line_break` settings still work.
- Fast: the `fast` segment displays `⚡ Fast` in the main line only when enabled
  and eligible, without a duplicate status row. Disabled or unsupported models
  leave no segment or placeholder. This indicates client eligibility, not provider
  confirmation. Its icon and palette are configurable like other main segments.
- Extension rows: `showExtensionStatuses: false` hides all separate extension
  status rows (including sub-agent usage), but keeps main segments and the
  underlying hooks running. Default `true` preserves existing behavior; change it
  in `/statusline` → Advanced → Extension status rows. Two-row wrapping describes
  the main statusline, not the total height when extra status rows are enabled.

Only footer rendering changes. No additional model calls, editor modifications,
or keyboard overrides. Git status continues using upstream local Git commands;
this does not make it remote-workspace aware. Tests cover ANSI/CJK widths, resizing,
usage arithmetic and Pi's native footer lifecycle using isolated data.
