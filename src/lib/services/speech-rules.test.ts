import { afterEach, expect, test } from 'bun:test';
import { SpeechRuleProcessor, type SpeechProcessingTiming } from './speech-rules';
let processor = new SpeechRuleProcessor();
afterEach(() => { processor.dispose(); processor = new SpeechRuleProcessor(); });
const processSpeechText = (...args: Parameters<SpeechRuleProcessor['process']>) => processor.process(...args);
const rule = { id: 'one', pattern: 'OOC', regex: false, caseSensitive: false, enabled: true };
test('the reusable worker returns the same processed text and validation errors as preview', async () => {
 expect(await processSpeechText('OOC Hello', [rule])).toEqual({ text: 'Hello', errors: {} });
 const invalid = await processSpeechText('', [{ ...rule, regex: true, pattern: '[' }]);
 expect(invalid.errors.one).toBe('Invalid regular expression.');
});

test('preview and playback share replacements, with safe source offsets and recoverable expansion limits', async () => {
 const rules = [{ ...rule, pattern: '(?<word>cat)', regex: true, replacement: '$<word>s' }];
 expect((await processSpeechText('A cat.', rules)).text).toBe('A cats.');
 const playback = await processSpeechText('A cat.', rules, undefined, true);
 expect(playback.text).toBe('A cats.');
 expect(playback.offsets).toEqual([0, 1, -1, -1, -1, -1, 5]);
 await expect(processSpeechText('x'.repeat(81), [{ ...rule, pattern: 'x', replacement: 'x'.repeat(1000) }])).rejects.toThrow('80,000');
 expect((await processSpeechText('OOC Safe', [rule])).text).toBe('Safe');
});
test('warm requests reuse one worker, keep previews isolated and report startup versus execution time', async () => {
 const timings: SpeechProcessingTiming[] = [];
 const measure = (timing: SpeechProcessingTiming) => timings.push(timing);
 const first = await processSpeechText('OOC First', [rule], measure);
 const second = await processSpeechText('OOC Second', [{ ...rule, pattern: 'Second' }], measure);
 expect(first.text).toBe('First'); expect(second.text).toBe('OOC');
 expect(timings[0].reusedWorker).toBe(false);
 expect(timings[1].reusedWorker).toBe(true);
 expect(timings.every(t => t.workerWaitMs >= 0 && t.processingMs >= 0 && t.totalMs >= t.processingMs)).toBe(true);
});
test('overlapping preview and playback requests get their own ordered results', async () => {
 const results = await Promise.all(Array.from({ length: 12 }, (_, i) => processSpeechText(`OOC ${i}`, [rule])));
 expect(results.map(result => result.text)).toEqual(Array.from({ length: 12 }, (_, i) => String(i)));
});
test('backgrounding allows pending processing to finish, then releases and recreates the worker', async () => {
 const timings: SpeechProcessingTiming[] = [];
 const pending = processSpeechText('OOC First', [rule]);
 processor.suspend();
 expect((await pending).text).toBe('First');
 await processSpeechText('OOC Second', [rule], timing => timings.push(timing));
 expect(timings[0].reusedWorker).toBe(false);
 processor.prepare();
 await processSpeechText('OOC Third', [rule]);
 await processSpeechText('OOC Fourth', [rule], timing => timings.push(timing));
 expect(timings[1].reusedWorker).toBe(true);
});
test('an invalid pattern does not poison subsequent requests or retain the earlier rules', async () => {
 expect((await processSpeechText('OOC Bad', [{ ...rule, regex: true, pattern: '[' }])).errors.one).toBeTruthy();
 expect(await processSpeechText('OOC Good', [rule])).toEqual({ text: 'Good', errors: {} });
});
test('diagnostic observers cannot prevent playback or stall the next request', async () => {
 expect((await processSpeechText('OOC One', [rule], () => { throw new Error('Observer failed'); })).text).toBe('One');
 expect((await processSpeechText('OOC Two', [rule])).text).toBe('Two');
});
test('disposing cancels waiting requests and does not allow late results to restart processing', async () => {
 const pending = processSpeechText('OOC Waiting', [rule]).then(() => null, error => error);
 processor.dispose();
 expect((await pending)?.message).toContain('cancelled');
 expect((await processSpeechText('OOC New', [rule])).text).toBe('New');
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
