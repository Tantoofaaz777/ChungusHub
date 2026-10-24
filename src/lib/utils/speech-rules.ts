export interface SpeechRule {
 id: string;
 /** Optional for rules saved before APK 0.1.10. Metadata only, never part of speech. */
 name?: string;
 pattern: string;
 regex: boolean;
 caseSensitive: boolean;
 enabled: boolean;
}
export interface SpeechRuleResult { text: string; errors: Record<string, string>; offsets?: number[] }

/** Run only inside the terminable worker: user regex must never block the UI. */
export function applySpeechRules(text: string, rules: SpeechRule[], trackOffsets = false): SpeechRuleResult {
 if (text.length > 80000 || rules.length > 30) throw new Error('Text or rule limit exceeded.');
 let offsets = trackOffsets ? Array.from({ length: text.length }, (_, i) => i) : undefined;
 const replace = (expression: RegExp, replacement: (match: string) => string, keepFrom = (match: string) => 0) => {
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
  try {
   const pattern = rule.regex ? rule.pattern : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   const expression = new RegExp(pattern, rule.caseSensitive ? 'gu' : 'giu');
   if (rule.enabled) replace(expression, () => '');
  } catch { errors[rule.id] = 'Invalid regular expression.'; }
 }
 replace(/[ \t]+/g, () => ' ');
 replace(/ *\n */g, () => '\n', match => match.indexOf('\n'));
 replace(/\n{3,}/g, () => '\n\n');
 const start = text.length - text.trimStart().length;
 const trimmed = text.trim();
 return { text: trimmed, errors, ...(offsets ? { offsets: offsets.slice(start, start + trimmed.length) } : {}) };
}
