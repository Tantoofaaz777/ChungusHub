import { afterEach, expect, test } from 'bun:test';
import type { AndroidSpeechChoice, AndroidSpeechSettings } from '$lib/services/android-client';
(globalThis as unknown as { $state: <T>(value: T) => T }).$state = value => value;
const { SpeechSettingsStore } = await import('./speech-settings.svelte');
const previousWindow = globalThis.window;
afterEach(() => { globalThis.window = previousWindow; });
const catalog: AndroidSpeechSettings = {
	engine: 'google', engineLabel: 'Google', voice: '', rate: 1, defaultVoice: 'en', selectionAvailable: true,
	voices: [{ id: 'en', language: 'en-US', languageLabel: 'English (United States)', network: false }]
};
function client(save: (options: AndroidSpeechChoice) => Promise<AndroidSpeechChoice> = async value => value, mixAudio?: boolean) {
	globalThis.window = { ChungusAndroidClient: { version: 1, settings: async () => {}, back: () => false,
		readingMixAudio: mixAudio !== undefined,
		readingSettings: async () => ({ ...catalog, ...(mixAudio !== undefined ? { mixAudio } : {}) }), saveReadingSettings: save } } as Window & typeof globalThis;
}

test('catalog and choices stay device-local and successful writes clear pending state', async () => {
	let sent: AndroidSpeechChoice | undefined;
	client(async value => { sent = value; return value; });
	const store = new SpeechSettingsStore(); await store.load();
	store.update({ voice: 'en', rate: 1.5 }); await store.save();
	expect(sent).toEqual({ engine: 'google', voice: 'en', rate: 1.5 });
	expect(store.unsaved).toBe(false);
});

test('a slow native write cannot overwrite a newer gesture and saves are serialized', async () => {
	let resolveFirst!: (value: AndroidSpeechChoice) => void;
	const writes: AndroidSpeechChoice[] = [];
	client(value => { writes.push(value); return writes.length === 1 ? new Promise(resolve => resolveFirst = resolve) : Promise.resolve(value); });
	const store = new SpeechSettingsStore(); await store.load();
	store.update({ rate: 1.25 }); const pending = store.save();
	store.update({ rate: 1.75 }); await store.save();
	expect(writes).toHaveLength(1);
	resolveFirst(writes[0]); await pending;
	expect(writes.map(value => value.rate)).toEqual([1.25, 1.75]);
	expect(store.data!.rate).toBe(1.75);
	expect(store.unsaved).toBe(false);
});

test('failed saves stay visible and can be retried or explicitly reloaded', async () => {
	client(async () => { throw new Error('Native save failed'); });
	const store = new SpeechSettingsStore(); await store.load();
	store.update({ rate: 1.5 }); await store.save();
	expect(store.error).toBe('Native save failed'); expect(store.unsaved).toBe(true);
	client(); await store.save(); expect(store.unsaved).toBe(false);
	client(async () => { throw new Error('Voice missing'); });
	store.update({ voice: 'en' }); await store.save();
	client(); await store.load(true);
	expect(store.unsaved).toBe(false); expect(store.error).toBe(''); expect(store.data!.voice).toBe('');
});

test('failure of an older write does not leave an error after a newer choice saves', async () => {
	let rejectFirst!: (reason: Error) => void;
	let writes = 0;
	client(value => ++writes === 1 ? new Promise((_resolve, reject) => rejectFirst = reject) : Promise.resolve(value));
	const store = new SpeechSettingsStore(); await store.load();
	store.update({ rate: 1.25 }); const pending = store.save();
	store.update({ rate: 1.5 });
	rejectFirst(new Error('Old request failed')); await pending;
	expect(store.error).toBe(''); expect(store.unsaved).toBe(false); expect(store.data!.rate).toBe(1.5);
});

test('mixing survives later voice and speed changes and is unavailable on old APKs', async () => {
	const writes: AndroidSpeechChoice[] = [];
	client(async value => { writes.push(value); return value; }, true);
	const store = new SpeechSettingsStore(); await store.load();
	expect(store.canMixAudio).toBe(true); expect(store.data!.mixAudio).toBe(true);
	store.update({ rate: 1.25, voice: 'en' }); await store.save();
	expect(writes[0]).toEqual({ engine: 'google', voice: 'en', rate: 1.25, mixAudio: true });
	store.update({ mixAudio: false }); await store.save();
	expect(writes[1].mixAudio).toBe(false); expect(store.unsaved).toBe(false);
	client();
	expect(store.canMixAudio).toBe(false);
});

test('a slow mixing save cannot overwrite a newer switch position or speed', async () => {
	let finish!: (value: AndroidSpeechChoice) => void;
	const writes: AndroidSpeechChoice[] = [];
	client(value => { writes.push(value); return writes.length === 1 ? new Promise(resolve => finish = resolve) : Promise.resolve(value); }, false);
	const store = new SpeechSettingsStore(); await store.load();
	store.update({ mixAudio: true }); const pending = store.save();
	store.update({ mixAudio: false, rate: 1.5 });
	finish(writes[0]); await pending;
	expect(writes.map(value => value.mixAudio)).toEqual([true, false]);
	expect(store.data!.mixAudio).toBe(false); expect(store.data!.rate).toBe(1.5);
	expect(store.unsaved).toBe(false);
});
