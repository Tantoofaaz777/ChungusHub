import { afterEach, beforeEach, expect, test } from 'bun:test';
import { BrowserSpeechPlayer, englishSpeechParts } from './edge-speech';
import type { AndroidReadingState } from './android-client';

const originalAudio = globalThis.Audio;
const originalFetch = globalThis.fetch;
let state: AndroidReadingState;
let player: BrowserSpeechPlayer;
let clips: string[];
let failNext: boolean;

class TestAudio {
	static current: TestAudio;
	onended: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor() { TestAudio.current = this; }
	async play() {}
	pause() {}
	load() {}
	removeAttribute() {}
}

beforeEach(() => {
	globalThis.Audio = TestAudio as unknown as typeof Audio;
	clips = [];
	failNext = false;
	globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
		clips.push(JSON.parse(init.body as string).text);
		if (failNext && clips.length > 1) return new Response(null, { status: 429 });
		return new Response(new Uint8Array(100), { headers: { 'content-type': 'audio/mpeg' } });
	}) as typeof fetch;
	player = new BrowserSpeechPlayer(next => { state = next; });
});

afterEach(() => {
	player.stop();
	globalThis.Audio = originalAudio;
	globalThis.fetch = originalFetch;
});

test('split text keeps the exact offsets and never cuts in the middle of an emoji', () => {
	const text = '  First sentence. ' + 'A'.repeat(2999) + '🙂.';
	const parts = englishSpeechParts(text, 'en-US-AriaNeural');
	expect(parts[0]).toEqual({ text: 'First sentence.', start: 2, end: 17 });
	expect(parts.at(-1)?.text).toBe('🙂.');
	for (const part of parts) expect(text.slice(part.start, part.end)).toBe(part.text);
});

test('browser reads only the active and upcoming parts and reuses the prefetched audio', async () => {
	player.start('First sentence. Second sentence. Third sentence.', 'Chat', 'request', { voice: 'en-GB-SoniaNeural', rate: 1 });
	await Bun.sleep(0);
	expect(clips).toEqual(['First sentence.', 'Second sentence.']);
	expect(state).toMatchObject({ phase: 'playing', requestId: 'request', range: { start: 0, end: 15 } });
	player.command('pause');
	expect(state.phase).toBe('paused');
	player.command('play');
	await Bun.sleep(0);
	expect(state).toMatchObject({ phase: 'playing', sentence: 1 });
	TestAudio.current.onended?.();
	await Bun.sleep(0);
	expect(state).toMatchObject({ phase: 'playing', sentence: 2 });
	expect(clips).toEqual(['First sentence.', 'Second sentence.', 'Third sentence.']);
	player.command('stop');
	expect(state.phase).toBe('idle');
});

test('the upstream limit on a prefetched part does not cut off the current audio', async () => {
	failNext = true;
	player.start('First sentence. Second sentence.', 'Chat', 'request', { voice: 'en-US-AriaNeural', rate: 1 });
	await Bun.sleep(0);
	expect(state.phase).toBe('playing');
	TestAudio.current.onended?.();
	await Bun.sleep(0);
	expect(state).toMatchObject({ phase: 'error', error: 'Edge TTS is busy. Wait a moment and try again.' });
});
