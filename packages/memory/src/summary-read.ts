import { createHash } from 'node:crypto';

/** Offsets count UTF-16 code units, like JS string lengths. Never split a surrogate pair. */
export function summaryPage(summary: string, options: { offset: number; chars: number; revision?: string | null }) {
  const revision = createHash('sha256').update(summary).digest('hex');
  if (options.offset > 0 && !options.revision) throw new Error('Summary continuation requires the revision from the first page');
  if (options.revision && options.revision !== revision) throw new Error('Summary changed; restart at offset 0 without revision');
  if (options.offset > summary.length) throw new Error('Summary offset exceeds its length');
  let start = options.offset;
  const isLow = (i: number) => i < summary.length && summary.charCodeAt(i) >= 0xdc00 && summary.charCodeAt(i) <= 0xdfff;
  const isHigh = (i: number) => i >= 0 && summary.charCodeAt(i) >= 0xd800 && summary.charCodeAt(i) <= 0xdbff;
  if (isLow(start) && isHigh(start - 1)) throw new Error('Summary offset splits a Unicode character; use nextOffset from the preceding page');
  let end = Math.min(summary.length, start + options.chars);
  if (isLow(end) && isHigh(end - 1)) end--;
  // A one-unit limit cannot fit a surrogate pair. Reject rather than overrun the cap or stall.
  if (end === start && start < summary.length) throw new Error('Character limit too small for the next Unicode character');
  return { text: summary.slice(start, end), revision, offset: start, nextOffset: end < summary.length ? end : null,
    totalChars: summary.length, returnedChars: end - start };
}
