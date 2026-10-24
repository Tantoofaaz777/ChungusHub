import { expect, test } from 'bun:test';
import { processSpeechText } from './speech-rules';
const rule = { id: 'one', pattern: 'OOC', regex: false, caseSensitive: false, enabled: true };
test('the disposable worker returns the same processed text and validation errors as preview', async () => {
 expect(await processSpeechText('OOC Hello', [rule])).toEqual({ text: 'Hello', errors: {} });
 const invalid = await processSpeechText('', [{ ...rule, regex: true, pattern: '[' }]);
 expect(invalid.errors.one).toBe('Invalid regular expression.');
});
test('an unresponsive processing worker is terminated and subsequent processing still works', async () => {
 const original = globalThis.Worker;
 let terminated = false;
 class UnresponsiveWorker {
  onmessage: ((event: { data: { ready: boolean } }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { queueMicrotask(() => this.onmessage?.({ data: { ready: true } })); }
  postMessage() { /* Simulate a regex that never returns, independently of engine optimizations. */ }
  terminate() { terminated = true; }
 }
 try {
  globalThis.Worker = UnresponsiveWorker as unknown as typeof Worker;
  await expect(processSpeechText('Any input', [rule])).rejects.toThrow('took too long');
  expect(terminated).toBe(true);
 } finally { globalThis.Worker = original; }
 expect((await processSpeechText('OOC Safe', [rule])).text).toBe('Safe');
});
