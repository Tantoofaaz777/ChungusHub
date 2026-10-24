import { expect, test } from 'bun:test';
import { appendSpeechRules, parseSpeechRulesImport, serializeSpeechRules, SPEECH_RULE_FILE_LIMIT } from './speech-rules-io';
import { applySpeechRules, type SpeechRule } from './speech-rules';

const rules: SpeechRule[] = [
 { id: 'pronunciation', name: 'Pronúncia 🌙', pattern: '(?<word>cat)', replacement: '$<word>s', regex: true, caseSensitive: true, enabled: true },
 { id: 'hide', name: 'Hide OOC', pattern: 'OOC', replacement: '', regex: false, caseSensitive: false, enabled: false }
];

test('versioned exports round-trip every option and rule order without changing speech', () => {
 const json = serializeSpeechRules(rules);
 expect(JSON.parse(json)).toMatchObject({ format: 'chungus-speech-rules', version: 1, rules });
 const imported = parseSpeechRulesImport(json);
 expect(imported).toEqual(rules);
 expect(applySpeechRules('A cat. OOC', imported).text).toBe(applySpeechRules('A cat. OOC', rules).text);
 expect(parseSpeechRulesImport('\uFEFF' + json)).toEqual(rules);
 expect(parseSpeechRulesImport(serializeSpeechRules([]))).toEqual([]);
});

test('raw device arrays preserve legacy removal rules and strip unrelated fields', () => {
 const legacy = { id: 'old', pattern: 'OOC', regex: false, caseSensitive: false, enabled: true, server: 'not exported' };
 const imported = parseSpeechRulesImport(JSON.stringify([legacy]));
 expect(imported).toEqual([{ id: 'old', name: '', pattern: 'OOC', replacement: '', regex: false, caseSensitive: false, enabled: true }]);
 expect(applySpeechRules('OOC Hello', imported).text).toBe('Hello');
 expect(serializeSpeechRules(imported)).not.toContain('not exported');
});

test('foreign, future-version, malformed and oversized files leave the caller data untouched', () => {
 const original = structuredClone(rules);
 for (const value of ['', '{', 'null', '42', '{}', JSON.stringify({ format: 'regex-rules', version: 1, rules }),
  JSON.stringify({ format: 'chungus-speech-rules', version: 2, rules }), ' '.repeat(SPEECH_RULE_FILE_LIMIT + 1)]) {
  expect(() => parseSpeechRulesImport(value)).toThrow();
 }
 expect(rules).toEqual(original);
});

test('import and export reject invalid IDs, options and field bounds before accepting a draft', () => {
 const invalid = [
  [rules[0], rules[0]], Array(31).fill(rules[0]), [null],
  ...[{ id: '' }, { id: 'x'.repeat(81) }, { pattern: '' }, { pattern: 'x'.repeat(1001) },
   { name: null }, { name: 'x'.repeat(121) }, { replacement: 42 }, { replacement: 'x'.repeat(1001) },
   { regex: 'true' }, { caseSensitive: null }, { enabled: 1 }].map(change => [{ ...rules[0], ...change }])
 ];
 for (const value of invalid) {
  expect(() => parseSpeechRulesImport(JSON.stringify(value))).toThrow();
  expect(() => serializeSpeechRules(value as SpeechRule[])).toThrow();
 }
 const tooLarge = Array.from({ length: 30 }, (_, i) => ({ ...rules[0], id: String(i), pattern: '\n'.repeat(999) + 'x', replacement: '\n'.repeat(1000) }));
 expect(() => parseSpeechRulesImport(JSON.stringify(tooLarge))).toThrow('too large to save');
});

test('appending mints independent IDs, retains processing order and rejects the whole merge on limits', () => {
 const before = structuredClone(rules);
 let next = 0;
 const merged = appendSpeechRules(rules, rules, () => `new-${++next}`);
 expect(merged.map(rule => rule.id)).toEqual(['pronunciation', 'hide', 'new-1', 'new-2']);
 expect(merged.slice(2)).toEqual(rules.map((rule, i) => ({ ...rule, id: `new-${i + 1}` })));
 expect(rules).toEqual(before);
 expect(() => appendSpeechRules(rules, Array.from({ length: 29 }, (_, i) => ({ ...rules[0], id: String(i) })))).toThrow('30');
 expect(() => appendSpeechRules(rules, [rules[0]], () => rules[0].id)).toThrow('unique');
});
