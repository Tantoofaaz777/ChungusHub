import { expect, test } from 'bun:test';
import { applySpeechRules, type SpeechRule } from './speech-rules';
const rule = (pattern: string, extra: Partial<SpeechRule> = {}): SpeechRule => ({ id: pattern, pattern, regex: false, caseSensitive: false, enabled: true, ...extra });

test('offset tracking preserves exact original occurrences after sequential deletions and whitespace cleanup', () => {
 const source = '  Same. [skip] Same.\n   Next 🌙.   ';
 const rules = [rule('\\[[^\\]]*\\]', { regex: true }), rule('Next ')];
 const mapped = applySpeechRules(source, rules, true), plain = applySpeechRules(source, rules);
 expect(mapped.text).toBe(plain.text); expect(mapped.text).toBe('Same. Same.\n🌙.');
 expect(mapped.offsets).toHaveLength(mapped.text.length);
 for (let i = 0; i < mapped.text.length; i++) if (!/\s/.test(mapped.text[i])) expect(source[mapped.offsets![i]]).toBe(mapped.text[i]);
 expect(mapped.offsets![mapped.text.lastIndexOf('Same')]).toBe(source.lastIndexOf('Same'));
});
test('mapping cannot change zero-width regex output or global Unicode removal semantics', () => {
 for (const pattern of ['(?=a)', '🌙', '(?<word>a)', '^|$']) {
  const rules = [rule(pattern, { regex: true })], source = '  a🌙 a\n\n\n b ';
  const mapped = applySpeechRules(source, rules, true);
  expect(mapped.text).toBe(applySpeechRules(source, rules).text);
  expect(mapped.offsets).toHaveLength(mapped.text.length);
 }
});
test('text rules escape all regex characters and match every occurrence without changing case of kept text', () => {
 expect(applySpeechRules('Keep A+B. a+b. [x] $5.*', [rule('a+b.'), rule('[x]'), rule('$5.*')]).text).toBe('Keep');
 expect(applySpeechRules('OOC ooc Ooc', [rule('OOC', { caseSensitive: true })]).text).toBe('ooc Ooc');
});
test('each rule receives the previous output, so reordering changes speech', () => {
 const first = rule('x'), second = rule('ab');
 expect(applySpeechRules('axb!', [first, second]).text).toBe('!');
 expect(applySpeechRules('axb!', [second, first]).text).toBe('ab!');
});
test('regex removes multiline bracketed content and disabled rules preserve their matches', () => {
 expect(applySpeechRules('Hello [stage\ndirection]. OOC', [rule('\\[[^\\]]*\\]', { regex: true }), rule('OOC', { enabled: false })]).text).toBe('Hello . OOC');
});
test('invalid patterns are attributed to a rule and blank rules cannot be saved', () => {
 const result = applySpeechRules('Hello', [rule('[' , { regex: true }), rule('')]);
 expect(result.errors['[']).toBe('Invalid regular expression.');
 expect(result.errors['']).toBeDefined();
 expect(result.text).toBe('Hello');
});
test('Unicode and zero-width matches terminate and completely removed text stays empty', () => {
 expect(applySpeechRules('😀 Ω', [rule('(?=.)', { regex: true })]).text).toBe('😀 Ω');
 expect(applySpeechRules('OOC\nOOC', [rule('OOC')]).text).toBe('');
 expect(() => applySpeechRules('a'.repeat(80001), [])).toThrow();
});


test('rule labels do not become spoken text or affect filtering', () => {
 const named = rule('OOC', { name: 'Do not speak this label' });
 expect(applySpeechRules('OOC Hello', [named]).text).toBe('Hello');
 expect(applySpeechRules('OOC Hello', [rule('OOC')]).text).toBe('Hello');
});
