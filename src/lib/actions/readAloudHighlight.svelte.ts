import { readAloudStore as reader } from '$lib/stores/read-aloud.svelte';
import { themeStore } from '$lib/stores/theme.svelte';
import { mapSpeechToDisplay, speechHighlightInk } from '$lib/utils/speech-highlight';

interface Options { key: string; version: string; text: () => string }
interface Chunk { node: Text; start: number; end: number }
const NAME = 'tts-reading';
const BLOCK = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SUMMARY', 'TR', 'BR']);

/** Read existing nodes only. No wrappers, innerHTML writes, selection changes or scrolling. */
function visibleText(root: HTMLElement) {
 const pieces: string[] = [], chunks: Chunk[] = [];
 let length = 0;
 const append = (text: string) => { pieces.push(text); length += text.length; };
 const visit = (node: Node) => {
  if (length > 250000) return;
  if (node.nodeType === Node.TEXT_NODE) {
   const text = node as Text;
   chunks.push({ node: text, start: length, end: length + text.length }); append(text.data); return;
  }
  if (!(node instanceof Element) || node.matches('script,style,img,audio,video,iframe,[hidden],[aria-hidden="true"]')) return;
  if (node instanceof HTMLDetailsElement && !node.open) {
   const summary = node.querySelector('summary'); if (summary) visit(summary); return;
  }
  const block = BLOCK.has(node.tagName);
  if (block) append('\n');
  for (const child of node.childNodes) visit(child);
  if (block) append('\n');
 };
 const scopes = root.querySelectorAll<HTMLElement>('[data-speech-text]');
 if (scopes.length) for (const scope of scopes) { append('\n'); visit(scope); append('\n'); }
 else visit(root);
 return { text: pieces.join(''), chunks };
}

function rangesFor(chunks: Chunk[], map: Int32Array, offsets: number[], start: number, end: number): Range[] {
 const ranges: Range[] = [];
 let current: Range | null = null, lastRaw = -2, lastNode: Text | null = null;
 for (let i = start; i < end; i++) {
  const raw = map[offsets[i]];
  if (raw === undefined || raw < 0) { current = null; continue; }
  // Binary search because display transformations can move intact blocks.
  let low = 0, high = chunks.length - 1, chunk: Chunk | undefined;
  while (low <= high) {
   const middle = (low + high) >>> 1, candidate = chunks[middle];
   if (raw < candidate.start) high = middle - 1;
   else if (raw >= candidate.end) low = middle + 1;
   else { chunk = candidate; break; }
  }
  if (!chunk) { current = null; continue; }
  const offset = raw - chunk.start;
  if (current && lastNode === chunk.node && lastRaw + 1 === raw) current.setEnd(chunk.node, offset + 1);
  else {
   current = document.createRange(); current.setStart(chunk.node, offset); current.setEnd(chunk.node, offset + 1); ranges.push(current);
  }
  lastRaw = raw; lastNode = chunk.node;
 }
 return ranges;
}

export function readAloudHighlight(node: HTMLElement, initial: Options) {
 let options = $state(initial), changed = $state(0);
 let cache: { original: string; version: string; map: Int32Array; chunks: Chunk[] } | null = null;
 const stop = $effect.root(() => {
  $effect(() => {
   const active = reader.highlight, settings = options;
   changed;
   if (!active || active.key !== settings.key || typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') {
    if (reader.sourceKey !== settings.key) cache = null;
    return;
   }
   // Edits, identity changes and swipe replacements must not inherit an earlier reading.
   const original = settings.text();
   if (original !== active.original) { cache = null; return; }
   if (!cache || cache.original !== original || cache.version !== settings.version) {
    const dom = visibleText(node);
    cache = { original, version: settings.version, map: mapSpeechToDisplay(original, dom.text), chunks: dom.chunks };
   }
   const accent = themeStore.accentColor;
   node.style.setProperty('--tts-reading-bg', accent);
   node.style.setProperty('--tts-reading-ink', speechHighlightInk(accent));
   const highlight = new Highlight(...rangesFor(cache.chunks, cache.map, active.offsets, active.start, active.end));
   highlight.priority = 10;
   CSS.highlights.set(NAME, highlight);
   const observer = new MutationObserver(() => { cache = null; changed++; });
   observer.observe(node, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'open'] });
   return () => {
    observer.disconnect();
    if (CSS.highlights.get(NAME) === highlight) CSS.highlights.delete(NAME);
    node.style.removeProperty('--tts-reading-bg'); node.style.removeProperty('--tts-reading-ink');
   };
  });
 });
 return { update(next: Options) { options = next; }, destroy() { stop(); cache = null; } };
}
