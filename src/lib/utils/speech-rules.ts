export interface SpeechRule {
 id: string;
 /** Optional for rules saved before APK 0.1.10. Metadata only, never part of speech. */
 name?: string;
 pattern: string;
 /** Empty or absent keeps the original removal behavior. */
 replacement?: string;
 regex: boolean;
 caseSensitive: boolean;
 enabled: boolean;
}
export interface SpeechRuleResult { text: string; errors: Record<string, string>; offsets?: number[] }

const MAX_TEXT = 80000;
const checkLength = (length: number) => {
 if (length > MAX_TEXT) throw new Error('Processed speech exceeds 80,000 characters.');
};

/** JavaScript replacement tokens, bounded before concatenating expanded captures/context. */
function expandReplacement(template: string, match: RegExpMatchArray, source: string): string {
 const chunks: string[] = [];
 let cursor = 0, length = 0;
 const append = (value: string) => { checkLength(length += value.length); chunks.push(value); };
 for (const token of template.matchAll(/\$(\$|&|`|'|[0-9]{1,2}|<[^>]*>)/g)) {
  append(template.slice(cursor, token.index));
  const key = token[1];
  let value = token[0];
  if (key === '$') value = '$';
  else if (key === '&') value = match[0];
  else if (key === '`') value = source.slice(0, match.index);
  else if (key === "'") value = source.slice(match.index! + match[0].length);
  else if (key.startsWith('<')) {
   if (match.groups) value = match.groups[key.slice(1, -1)] ?? '';
  } else {
   const number = Number(key);
   if (number > 0 && number < match.length) value = match[number] ?? '';
   else if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) < match.length)
    value = (match[Number(key[0])] ?? '') + key[1];
  }
  append(value); cursor = token.index + token[0].length;
 }
 append(template.slice(cursor));
 return chunks.join('');
}

/** Run only inside the terminable worker: user regex must never block the UI. */
export function applySpeechRules(text: string, rules: SpeechRule[], trackOffsets = false): SpeechRuleResult {
 if (text.length > MAX_TEXT || rules.length > 30) throw new Error('Text or rule limit exceeded.');
 let offsets = trackOffsets ? Array.from({ length: text.length }, (_, i) => i) : undefined;
 const replace = (expression: RegExp, replacement: (match: string) => string, keepFrom = (_match: string) => 0) => {
  if (!offsets) { text = text.replace(expression, replacement); return; }
  const chunks: string[] = [], next: number[] = [];
  let cursor = 0;
  const append = (from: number, to: number) => { chunks.push(text.slice(from, to)); for (let i = from; i < to; i++) next.push(offsets![i]); };
  for (const match of text.matchAll(expression)) {
   append(cursor, match.index);
   const value = replacement(match[0]); chunks.push(value);
   for (let i = 0; i < value.length; i++) next.push(offsets[match.index + keepFrom(match[0]) + i]);
   cursor = match.index + match[0].length;
  }
  append(cursor, text.length); text = chunks.join(''); offsets = next;
 };
 const errors: Record<string, string> = Object.create(null);
 for (const rule of rules) {
  if (!rule.pattern.trim() || rule.pattern.length > 1000) { errors[rule.id] = 'Enter between 1 and 1,000 characters.'; continue; }
  const replacement = rule.replacement ?? '';
  if (typeof replacement !== 'string' || replacement.length > 1000) { errors[rule.id] = 'Replace to must have at most 1,000 characters.'; continue; }
  let expression: RegExp;
  try {
   const pattern = rule.regex ? rule.pattern : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   expression = new RegExp(pattern, rule.caseSensitive ? 'gu' : 'giu');
  } catch { errors[rule.id] = 'Invalid regular expression.'; continue; }
  if (!rule.enabled) continue;
  const chunks: string[] = [], next: number[] = [];
  let cursor = 0, length = 0;
  const append = (value: string, from?: number) => {
   checkLength(length += value.length); chunks.push(value);
   if (offsets) for (let i = 0; i < value.length; i++) next.push(from === undefined ? -1 : offsets[from + i]);
  };
  for (const match of text.matchAll(expression)) {
   append(text.slice(cursor, match.index), cursor);
   // Inserted text has no exact source position; never highlight unrelated original characters.
   append(rule.regex ? expandReplacement(replacement, match, text) : replacement);
   cursor = match.index + match[0].length;
  }
  append(text.slice(cursor), cursor);
  text = chunks.join(''); if (offsets) offsets = next;
 }
 replace(/[ \t]+/g, () => ' ');
 replace(/ *\n */g, () => '\n', match => match.indexOf('\n'));
 replace(/\n{3,}/g, () => '\n\n');
 const start = text.length - text.trimStart().length;
 const trimmed = text.trim();
 return { text: trimmed, errors, ...(offsets ? { offsets: offsets.slice(start, start + trimmed.length) } : {}) };
}
