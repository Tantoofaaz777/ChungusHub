import { describe, expect, test } from 'bun:test';
import { SyncBatch } from './sync-batch';
import type { TaskScheduler } from '../utils/coalesced-task';

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

async function settle() {
	for (let i = 0; i < 30; i++) await Promise.resolve();
}

function fixture() {
	let now = 0;
	const timers = new Set<{ at: number; run: () => void }>();
	const schedule: TaskScheduler = (run, delay) => {
		const timer = { at: now + delay, run };
		timers.add(timer);
		return () => { timers.delete(timer); };
	};
	const calls: string[] = [];
	const failures: unknown[][] = [];
	const handlers = {
		chats: async () => { calls.push('chats'); },
		messages: async () => { calls.push('messages'); },
		presets: async () => { calls.push('presets'); },
		settings: async () => { calls.push('settings'); },
		threads: async () => { calls.push('threads'); }
	};
	const batch = new SyncBatch<keyof typeof handlers>(handlers, (...args) => { failures.push(args); }, { messages: 'chats' }, schedule);
	return { batch, calls, failures, handlers, async advance(ms: number) {
		now += ms;
		for (const timer of [...timers]) {
			if (timer.at <= now) { timers.delete(timer); timer.run(); }
		}
		await settle();
	} };
}

describe('batched sync invalidations', () => {
	test('deduplicates a burst, merges chat scopes and keeps the first 50ms deadline', async () => {
		const f = fixture();
		f.batch.enqueue('messages');
		await f.advance(49);
		for (let i = 0; i < 100; i++) { f.batch.enqueue('chats'); f.batch.enqueue('messages'); }
		expect(f.calls).toEqual([]);
		await f.advance(1);
		expect(f.calls).toEqual(['chats']);
		f.batch.enqueue('messages');
		await f.advance(50);
		expect(f.calls).toEqual(['chats', 'chats']);
	});

	test('loads presets before settings regardless of hint order', async () => {
		const f = fixture();
		f.batch.enqueue('settings'); f.batch.enqueue('presets'); f.batch.enqueue('settings');
		await f.advance(50);
		expect(f.calls).toEqual(['presets', 'settings']);
	});

	test('serializes reads, repeats in-flight invalidations, and absorbs hints for unread scopes', async () => {
		const f = fixture(), read = deferred();
		let reads = 0;
		f.handlers.chats = async () => { f.calls.push('chats'); if (++reads === 1) await read.promise; };
		f.batch.enqueue('chats'); f.batch.enqueue('settings');
		await f.advance(50);
		f.batch.enqueue('messages'); f.batch.enqueue('messages');
		f.batch.enqueue('settings'); f.batch.enqueue('presets');
		await f.advance(100);
		expect(f.calls).toEqual(['chats']);
		read.resolve(); await settle();
		expect(f.calls).toEqual(['chats', 'chats', 'presets', 'settings']);
	});

	test('a hint arriving in the repeated read schedules another pass too', async () => {
		const f = fixture(), first = deferred(), second = deferred();
		let reads = 0;
		f.handlers.chats = async () => {
			f.calls.push('chats');
			if (++reads === 1) await first.promise;
			else if (reads === 2) await second.promise;
		};
		f.batch.enqueue('messages'); await f.advance(50);
		f.batch.enqueue('messages'); first.resolve(); await settle();
		f.batch.enqueue('chats'); second.resolve(); await settle();
		expect(f.calls).toEqual(['chats', 'chats', 'chats']);
	});

	test('reconnect absorbs pending hints and duplicate reconnects into one full pass', async () => {
		const f = fixture();
		f.batch.enqueue('settings'); f.batch.enqueue('messages');
		f.batch.reconnect(); f.batch.reconnect();
		await f.advance(50);
		expect(f.calls).toEqual(['chats', 'presets', 'settings', 'threads']);
	});

	test('reconnect during a read refreshes every scope, including that read', async () => {
		const f = fixture(), read = deferred();
		let reads = 0;
		f.handlers.chats = async () => { f.calls.push('chats'); if (++reads === 1) await read.promise; };
		f.batch.enqueue('chats'); await f.advance(50);
		f.batch.reconnect(); read.resolve(); await settle();
		expect(f.calls).toEqual(['chats', 'chats', 'presets', 'settings', 'threads']);
	});

	test('hints during full resync repeat scopes already read, but not those still pending', async () => {
		const f = fixture(), read = deferred();
		f.handlers.settings = async () => { f.calls.push('settings'); await read.promise; };
		f.batch.reconnect(); await f.advance(50);
		f.batch.enqueue('messages'); f.batch.enqueue('presets'); f.batch.enqueue('threads');
		read.resolve(); await settle();
		expect(f.calls).toEqual(['chats', 'presets', 'settings', 'chats', 'presets', 'threads']);
	});

	test('another reconnect during resync repeats earlier scopes without overlapping reads', async () => {
		const f = fixture(), read = deferred();
		let reads = 0;
		f.handlers.settings = async () => {
			f.calls.push('settings');
			if (++reads === 1) await read.promise;
		};
		f.batch.reconnect(); await f.advance(50);
		f.batch.reconnect(); f.batch.reconnect(); await f.advance(50);
		expect(f.calls).toEqual(['chats', 'presets', 'settings']);
		read.resolve(); await settle();
		expect(f.calls).toEqual(['chats', 'presets', 'settings', 'chats', 'presets', 'settings', 'threads']);
	});

	test('a failed scope does not prevent other reads or later retries', async () => {
		const f = fixture(), error = new Error('offline');
		f.handlers.presets = async () => { f.calls.push('presets'); throw error; };
		f.batch.enqueue('presets'); f.batch.enqueue('settings'); await f.advance(50);
		expect(f.calls).toEqual(['presets', 'settings']);
		expect(f.failures).toEqual([['presets', error]]);
		f.handlers.presets = async () => { f.calls.push('presets'); };
		f.batch.enqueue('presets'); await f.advance(50);
		expect(f.calls).toEqual(['presets', 'settings', 'presets']);
	});

	test('unknown scopes, including inherited object keys, are reported and ignored', async () => {
		const f = fixture();
		f.batch.enqueue('unknown'); f.batch.enqueue('toString'); f.batch.enqueue('__proto__');
		f.batch.enqueue('threads'); await f.advance(50);
		expect(f.failures).toEqual([['unknown'], ['toString'], ['__proto__']]);
		expect(f.calls).toEqual(['threads']);
	});
});
