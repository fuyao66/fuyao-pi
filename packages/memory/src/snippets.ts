/** A bounded excerpt of stored summary, never raw session expansion. */
export function summarySnippet(summary: string, query = '', budget = 600): string {
  if (summary.length <= budget) return summary;
  const text = summary.toLocaleLowerCase();
  const terms = query.trim().split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length);
  let match = -1;
  for (const term of terms) {
    const position = text.indexOf(term.toLocaleLowerCase());
    if (position >= 0) { match = position; break; }
  }
  let start = match < 0 ? 0 : Math.max(0, match - Math.floor(budget / 4));
  start = Math.min(start, Math.max(0, summary.length - budget));
  // Avoid splitting UTF-16 surrogate pairs at either end.
  if (start && /[\uDC00-\uDFFF]/.test(summary[start])) start--;
  let end = Math.min(summary.length, start + budget);
  if (end < summary.length && /[\uDC00-\uDFFF]/.test(summary[end])) end--;
  return `${start ? '…' : ''}${summary.slice(start, end)}${end < summary.length ? '…' : ''}`;
}
