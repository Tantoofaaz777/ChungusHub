import { afterEach, expect, test } from 'bun:test';
import type { AndroidReadingState } from '$lib/services/android-client';

// State-transition tests, as in new-chat-flow.test.ts; reactivity is exercised in the browser.
(globalThis as unknown as { $state: <T>(v: T) => T }).$state = value => value;
const { readAloudStore: reader } = await import('./read-aloud.svelte');
const previousWindow = globalThis.window;
afterEach(() => { reader.suspend(); globalThis.window = previousWindow; reader.state = { phase: 'idle' }; reader.busy = false; reader.available = false; });

function client(overrides: Partial<NonNullable<Window['ChungusAndroidClient']>> = {}) {
	globalThis.window = { ChungusAndroidClient: {
		version: 1, settings: async () => {}, back: () => false,
		readAloud: async () => {}, readingState: async () => ({ phase: 'playing' }),
		readingCommand: async () => ({ phase: 'paused' }), ...overrides
	} } as Window & typeof globalThis;
}

test('an old APK cannot expose a partially supported reader', async () => {
	client({ readingCommand: undefined });
	await reader.refresh();
	expect(reader.available).toBe(false);
});

test('a delayed status snapshot cannot overwrite a newer reading request', async () => {
	let resolveOld!: (state: AndroidReadingState) => void;
	let reads = 0;
	client({ readingState: () => ++reads === 1 ? new Promise(resolve => resolveOld = resolve) : Promise.resolve({ phase: 'playing', title: 'New message' }) });
	const oldRefresh = reader.refresh();
	await reader.start('New message.', 'New message');
	resolveOld({ phase: 'paused', title: 'Old message' });
	await oldRefresh;
	expect(reader.state).toEqual({ phase: 'playing', title: 'New message' });
});

test('overlapping transport taps send one command and failures release the controls', async () => {
	let resolve!: (state: AndroidReadingState) => void;
	let commands = 0;
	client({ readingCommand: () => { commands++; return new Promise(done => resolve = done); } });
	reader.available = true;
	const pause = reader.command('pause');
	await reader.command('pause');
	expect(commands).toBe(1);
	resolve({ phase: 'paused', sentence: 2, total: 3 });
	await pause;
	expect(reader.state.phase).toBe('paused');
	client({ readingCommand: async () => { throw new Error('Disconnected'); } });
	await expect(reader.command('play')).rejects.toThrow('Disconnected');
	expect(reader.busy).toBe(false);
});


test('native rule-load failures stop playback instead of reading unfiltered text', async () => {
 let starts = 0;
 client({ readingRules: async () => { throw new Error('Could not load rules'); }, readAloud: async () => { starts++; } });
 await expect(reader.start('Private words.', 'Chat')).rejects.toThrow('Could not load rules');
 expect(starts).toBe(0); expect(reader.busy).toBe(false);
});

test('the player sends only filtered text, preserving the title, and refuses empty output', async () => {
 const spoken: string[] = [];
 client({ readingRules: async () => [{ id: 'one', pattern: 'OOC', regex: false, caseSensitive: false, enabled: true }],
  readAloud: async (text, title) => { spoken.push(text); expect(title).toBe('Chat'); } });
 await reader.refresh();
 await reader.start('OOC Hello', 'Chat');
 expect(spoken).toEqual(['Hello']);
 const emptyError = await reader.start('OOC', 'Chat').then(() => null, error => error);
 expect(emptyError?.message).toContain('Nothing remains');
 expect(reader.lastProcessingTiming?.reusedWorker).toBe(true);
 expect(spoken).toEqual(['Hello']); expect(reader.busy).toBe(false);
});
