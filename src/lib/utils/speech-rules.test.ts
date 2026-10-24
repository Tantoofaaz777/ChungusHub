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

test('empty and legacy replacements remove, literal replacements keep dollar signs and honor case', () => {
 expect(applySpeechRules('OOC Hello OOC', [rule('OOC', { replacement: '' })]).text).toBe('Hello');
 expect(applySpeechRules('cat Cat CAT', [rule('cat', { replacement: '$1 $& $$' })]).text).toBe('$1 $& $$ $1 $& $$ $1 $& $$');
 expect(applySpeechRules('cat Cat', [rule('cat', { replacement: 'dog', caseSensitive: true })]).text).toBe('dog Cat');
 expect(applySpeechRules('cat', [rule('cat', { replacement: 'dog', enabled: false })]).text).toBe('cat');
});

test('regex replacements match JavaScript capture, dollar and surrounding-context semantics', () => {
 const cases = [
  ['(?<first>a)(b)?', 'ab a', '$<first>-$2-$&-$$-$<missing>'],
  ['(a)(b)?', 'ab a', '$1:$2:$3:$01:$00:$10:$20:$99:$<first>'],
  ['(a)', 'cat', "$`|$&|$'"],
  ['(?=a)|$', 'a🌙a', '[$&]'],
  ['🌙', '🌙🌙', 'moon'],
 ];
 for (const [pattern, source, replacement] of cases) {
  const expected = source.replace(new RegExp(pattern, 'giu'), replacement).trim();
  const rules = [rule(pattern, { regex: true, replacement })];
  expect(applySpeechRules(source, rules).text).toBe(expected);
  expect(applySpeechRules(source, rules, true).text).toBe(expected);
 }
});

test('replacements feed subsequent rules and preserve exact offsets outside generated text', () => {
 const source = '  Hi cat. Same. cat Same. 🌙  ';
 const rules = [rule('cat', { replacement: 'kitten' }), rule('kitten', { replacement: 'dog' })];
 const result = applySpeechRules(source, rules, true);
 expect(result.text).toBe('Hi dog. Same. dog Same. 🌙');
 expect(result.offsets).toHaveLength(result.text.length);
 for (let i = 0; i < result.text.length; i++) {
  if (result.offsets![i] >= 0) expect(source[result.offsets![i]]).toBe(result.text[i]);
 }
 expect(result.offsets!.slice(3, 6)).toEqual([-1, -1, -1]);
 expect(result.offsets![result.text.lastIndexOf('Same')]).toBe(source.lastIndexOf('Same'));
 expect(applySpeechRules('cat', [...rules].reverse()).text).toBe('kitten');
});

test('replacement bounds fail closed before expansion can create an oversized reading', () => {
 expect(applySpeechRules('x', [rule('x', { replacement: 'y'.repeat(1001) })]).errors.x).toContain('1,000');
 expect(applySpeechRules('x', [rule('x', { replacement: 'y'.repeat(1000) })]).text).toHaveLength(1000);
 expect(() => applySpeechRules('x'.repeat(81), [rule('x', { replacement: 'y'.repeat(1000) })])).toThrow('80,000');
 expect(() => applySpeechRules('a'.repeat(1000), [rule('a', { regex: true, replacement: "$'$'" })], true)).toThrow('80,000');
});
