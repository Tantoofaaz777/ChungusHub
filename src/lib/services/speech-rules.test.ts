import { expect, test } from 'bun:test';
import { processSpeechText } from './speech-rules';
const rule = { id: 'one', pattern: 'OOC', regex: false, caseSensitive: false, enabled: true };
test('the disposable worker returns the same processed text and validation errors as preview', async () => {
 expect(await processSpeechText('OOC Hello', [rule])).toEqual({ text: 'Hello', errors: {} });
 const invalid = await processSpeechText('', [{ ...rule, regex: true, pattern: '[' }]);
 expect(invalid.errors.one).toBe('Invalid regular expression.');
});
test('pathological regex is terminated and subsequent processing still works', async () => {
 await expect(processSpeechText('a'.repeat(200) + '!', [{ ...rule, regex: true, pattern: '(a+)+$' }])).rejects.toThrow('took too long');
 expect((await processSpeechText('OOC Safe', [rule])).text).toBe('Safe');
});
