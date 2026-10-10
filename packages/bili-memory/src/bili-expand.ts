import { createHash } from 'node:crypto';
import { readSourceFile } from './source-files.js';

interface Options {
  file: string; blockId: string; summary: string; mode: 'list' | 'full';
  select?: number[] | null; revision?: string | null;
  maxReadBytes: number; maxChars: number; maxMessages: number;
  signal?: AbortSignal; redact(text: string): { text: string };
  normalizeSummary?(text: string): string;
}

/** The upstream persisted block is formatted text, not a structured message list.
 * Expose numbered text chunks without interpreting embedded role/ref markers.
 * Never follow raw placeholders into other files or recurse through nested blocks. */
export async function expandBiliBlock(options: Options) {
  const check = () => { if (options.signal?.aborted) throw new Error('Memory expansion cancelled'); };
  check();
  const { body } = await readSourceFile(options.file, options.maxReadBytes);
  check();
  const doc = JSON.parse(body);
  if (doc.version !== 3 || doc.payload?.version !== 3 || typeof doc.id !== 'string' || !doc.id || doc.id !== doc.payload.id ||
      !Array.isArray(doc.payload.state?.blocks)) throw new Error('Unsupported proxy persistence');
  const blocks = doc.payload.state.blocks.filter((b: any) => b?.blockId === options.blockId);
  if (blocks.length !== 1 || typeof blocks[0].summary !== 'string' ||
      (options.normalizeSummary?.(blocks[0].summary) ?? blocks[0].summary) !== options.summary)
    throw new Error('Block revision changed; search again');
  const text = doc.payload.blockContents?.[options.blockId]?.full?.text;
  if (typeof text !== 'string') throw new Error('Original block text is not retained; use mode=summary');
  const revision = createHash('sha256').update(JSON.stringify([doc.id, options.blockId, options.summary, text])).digest('hex');
  if (options.mode === 'full' && options.revision !== revision) throw new Error('Run mode=list first and supply its revision');
  // Redact before splitting so a secret spanning chunk boundaries cannot leak.
  const clean = options.redact(text).text;
  const chunks: string[] = [];
  for (let offset = 0; offset < clean.length;) {
    let end = Math.min(clean.length, offset + 4000);
    if (end < clean.length && /[\uD800-\uDBFF]/.test(clean[end - 1])) end--;
    chunks.push(clean.slice(offset, end)); offset = end;
  }
  check();
  if (options.mode === 'list') return { revision, chunks: chunks.length, returnedChars: 0, truncated: false,
    text: `Retained block text: ${clean.length} characters in ${chunks.length} numbered chunks (up to 4000 characters each).\n` +
      `Revision: ${revision}\nUse mode=full select=[1] revision=${revision} to read a chunk. Indices are text chunks, not message indices.\n` +
      'Nested summaries and upstream placeholders are not automatically expanded.' };
  const selected = [...new Set(options.select ?? [])];
  if (!selected.length || selected.some(n => !Number.isSafeInteger(n) || n < 1 || n > chunks.length)) {
    throw new Error('Select valid chunk indices from mode=list');
  }
  const maxChars = Math.max(0, Math.floor(options.maxChars));
  let output = ''; let truncated = selected.length > options.maxMessages;
  for (const n of selected.slice(0, options.maxMessages)) {
    const part = `${output ? '\n\n' : ''}### Chunk ${n}\n${chunks[n - 1]}`;
    let take = Math.min(part.length, maxChars - output.length);
    if (take > 0 && take < part.length && /[\uD800-\uDBFF]/.test(part[take - 1])) take--;
    output += part.slice(0, take);
    if (take < part.length) { truncated = true; break; }
  }
  return { revision, chunks: chunks.length, returnedChars: output.length, truncated, text: output };
}
