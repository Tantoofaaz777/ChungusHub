import { expect, test } from 'bun:test';
import { DebouncedWriter } from './debounced-write';

function deferred() {
	let resolve!: () => void, reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('flush waits for an autosave already in flight and pending stays true until acknowledgement', async () => {
	const gate = deferred(); const writer = new DebouncedWriter(0, () => gate.promise);
	writer.schedule('row'); await new Promise(resolve => setTimeout(resolve, 10));
	let flushed = false; const work = writer.flush().then(() => { flushed = true; });
	await settle(); expect(flushed).toBe(false); expect(writer.pending('row')).toBe(true);
	gate.resolve(); await work; expect(flushed).toBe(true); expect(writer.pending('row')).toBe(false);
});

test('successive autosaves of one row cannot reach the server in reverse order', async () => {
	const gate = deferred(), calls: string[] = []; let value = 'first';
	const writer = new DebouncedWriter(60_000, async () => { calls.push(value); if (calls.length === 1) await gate.promise; });
	writer.schedule('row'); const first = writer.flush('row'); await settle();
	value = 'last'; writer.schedule('row'); const last = writer.flush('row'); await settle();
	expect(calls).toEqual(['first']); gate.resolve(); await Promise.all([first, last]);
	expect(calls).toEqual(['first', 'last']);
});

test('a failed autosave still permits the following write', async () => {
	const gate = deferred(); let calls = 0;
	const writer = new DebouncedWriter(60_000, async () => { if (++calls === 1) await gate.promise; });
	writer.schedule(); const first = writer.flush(); const rejected = first.catch(error => error); await settle();
	writer.schedule(); const next = writer.flush(); gate.reject(new Error('offline'));
	expect(await rejected).toEqual(new Error('offline')); await next; expect(calls).toBe(2); expect(writer.pending()).toBe(false);
});

test('a write in one row does not delay another row and cancellation drops only its timer', async () => {
	const gate = deferred(), calls: string[] = [];
	const writer = new DebouncedWriter(60_000, async key => { calls.push(key); if (key === 'a') await gate.promise; });
	writer.schedule('a'); const first = writer.flush('a'); await settle();
	writer.schedule('b'); await writer.flush('b'); writer.schedule('c'); writer.cancel('c');
	expect(calls).toEqual(['a', 'b']); expect(writer.pending('a')).toBe(true); expect(writer.pending('c')).toBe(false);
	gate.resolve(); await first;
});
