import { contrastRatio } from './contrast';

/** Opaque accent backing makes contrast independent of photos, glass and dialogue colors. */
export function speechHighlightInk(accent: string): '#000000' | '#ffffff' {
 return contrastRatio('#000000', accent) >= contrastRatio('#ffffff', accent) ? '#000000' : '#ffffff';
}

function normalize(text: string) {
 const offsets: number[] = [], chars: string[] = [];
 let space = false;
 for (let i = 0; i < text.length; i++) {
  if (/\s/u.test(text[i])) {
   if (chars.length && !space) { offsets.push(i); chars.push(' '); space = true; }
  } else { offsets.push(i); chars.push(text[i]); space = false; }
 }
 if (space) { offsets.pop(); chars.pop(); }
 return { text: chars.join(''), offsets };
}
function blocks(text: string) {
 const groups = new Map<string, { offsets: number[]; start: number }[]>();
 for (const match of text.matchAll(/[^\n]+/g)) {
  const block = normalize(match[0]);
  if (!block.text) continue;
  const group = groups.get(block.text) ?? [];
  group.push({ offsets: block.offsets, start: match.index }); groups.set(block.text, group);
 }
 return groups;
}

/** Map original speech text to displayed text without guessing at altered/repeated passages.
 * Formatting and whitespace may differ. Added tracker widgets do not affect speech.
 * Unchanged blocks still map if a display regex rewrites another block; ambiguous blocks
 * stay unmapped rather than highlighting the wrong duplicate. Linear memory and time. */
export function mapSpeechToDisplay(source: string, display: string): Int32Array {
 const result = new Int32Array(source.length).fill(-1);
 if (!source || source.length > 80000 || display.length > 250000) return result;
 const a = normalize(source), b = normalize(display);
 if (!a.text) return result;
 const full = b.text.indexOf(a.text);
 const word = /[\p{L}\p{N}_]/u;
 const boundary = full >= 0 && (!word.test(a.text[0]) || full === 0 || !word.test(b.text[full - 1])) &&
  (!word.test(a.text.at(-1)!) || full + a.text.length === b.text.length || !word.test(b.text[full + a.text.length]));
 if (boundary && b.text.indexOf(a.text, full + 1) < 0) {
  for (let i = 0; i < a.offsets.length; i++) result[a.offsets[i]] = b.offsets[full + i];
  return result;
 }
 const sourceBlocks = blocks(source), displayBlocks = blocks(display);
 for (const [text, originals] of sourceBlocks) {
  const visible = displayBlocks.get(text);
  if (!visible || visible.length !== originals.length) continue;
  originals.forEach((original, occurrence) => {
   const target = visible[occurrence];
   for (let i = 0; i < original.offsets.length; i++) result[original.start + original.offsets[i]] = target.start + target.offsets[i];
  });
 }
 return result;
}
