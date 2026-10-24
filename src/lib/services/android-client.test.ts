import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isAndroidClient, installAndroidBack, shareNativeText, canPinChatShortcut, pinChatShortcut } from './android-client';
import { serializeFeedAsPlainText } from '$shared/threads/feed';
import { exportEntryAsSillyTavern, buildSillyTavernCard } from './sillyTavernExport';
import { importSillyTavernCard } from './sillyTavernImport';
import type { LibraryEntry } from '$lib/types/library';
import { saveGeneratedDownload } from './libraryExport';
import { copyText } from '$lib/utils/clipboard';

const script = readFileSync(new URL('../../../android/app/src/main/assets/client.js', import.meta.url), 'utf8');
function harness(options: { cancel?: boolean; failChunk?: boolean; frame?: boolean; holdPicker?: boolean; failCopy?: boolean; holdCopy?: boolean; dropCopy?: boolean;
	holdShare?: boolean; failShare?: boolean; incoming?: { name: string; mime: string; bytes: Uint8Array }[] } = {}) {
	let browserClicks = 0, objectId = 0;
	let pickerReply: (() => void) | undefined;
	let copyReply: (() => void) | undefined;
	let copiedText = '', copyBuffer = '';
	let sharedText = '', shareBuffer = '';
	let shareReply: (() => void) | undefined;
	const shared: Buffer[] = [], shareChunks: Buffer[] = [];
	const inbox = new Map((options.incoming ?? []).map((file, i) => [String(i), file]));
	const messages: any[] = [], saved: Buffer[] = [], chunks: Buffer[] = [], revoked: string[] = [];
	const events = new Map<string, (event: any) => void>();
	class Anchor {
		constructor(public href: string, public download = 'export.bin') {}
		hasAttribute(name: string) { return name === 'download'; }
		closest() { return this; }
		remove() {}
		click() { browserClicks++; }
	}
	class BrowserURL extends URL {
		static createObjectURL(_blob: Blob) { return `blob:https://chungus.test/${++objectId}`; }
		static revokeObjectURL(url: string) { revoked.push(url); }
	}
	const window: any = { dispatchEvent: () => {} };
	window.top = options.frame ? {} : window;
	window.ChungusNative = { postMessage(text: string) {
		const message = JSON.parse(text); messages.push(message);
		const respond = () => {
			let response: any = { id: message.id, ok: true };
			if (message.type === 'shortcut.pending') response.target = { id: 'launch-1', chatId: 'chat-1' };
			if (message.type === 'speech.state' || message.type === 'speech.command') response.state = { phase: 'paused', sentence: 2, total: 5 };
			if (message.type === 'speech.rules') response.rules = [];
			if (message.type === 'speech.settings') response.settings = { engine: 'google', voice: '', rate: 1, voices: [] };
			if (message.type === 'speech.settings.save') response.settings = { engine: message.engine, voice: message.voice, rate: message.rate, ...(message.mixAudio !== undefined ? { mixAudio: message.mixAudio } : {}), ...(message.highlightSpeech !== undefined ? { highlightSpeech: message.highlightSpeech } : {}) };
			if (message.type === 'share.text.begin') { shareBuffer = ''; response.transfer = 'text-share'; }
			if (message.type === 'share.text.chunk') {
				expect(message.offset).toBe(shareBuffer.length);
				expect(message.text.length).toBeLessThanOrEqual(8192);
				shareBuffer += message.text;
			}
			if (message.type === 'share.text.end') {
				if (options.failShare) response = { ...response, ok: false, error: 'Sharing unavailable' };
				else sharedText = shareBuffer;
			}
			if (message.type === 'share.begin') { response.transfer = 'share'; shareChunks.length = 0; }
			if (message.type === 'share.chunk') {
				if (options.failChunk) response = { ...response, ok: false, error: 'Cache full' };
				else {
					expect(message.offset).toBe(shareChunks.reduce((sum, chunk) => sum + chunk.length, 0));
					const bytes = Buffer.from(message.data, 'base64'); expect(bytes.length).toBeLessThanOrEqual(49152); shareChunks.push(bytes);
				}
			}
			if (message.type === 'share.end') {
				if (options.failShare) response = { ...response, ok: false, error: 'Sharing unavailable' };
				else shared.push(Buffer.concat(shareChunks));
			}
			if (message.type === 'incoming.list') response.files = [...inbox].map(([id, f]) => ({ id, name: f.name, mime: f.mime, size: f.bytes.length }));
			if (message.type === 'incoming.read') {
				const item = inbox.get(message.file);
				response = item ? { ...response, data: Buffer.from(item.bytes.slice(message.offset, message.offset + 49152)).toString('base64') }
					: { ...response, ok: false, error: 'The shared file is no longer available' };
			}
			if (message.type === 'incoming.remove') inbox.delete(message.file);
			if (message.type === 'clipboard.begin') { copyBuffer = ''; response.transfer = 'clipboard'; }
			if (message.type === 'clipboard.chunk') {
				expect(message.offset).toBe(copyBuffer.length);
				expect(message.text.length).toBeLessThanOrEqual(8192);
				expect(text.length).toBeLessThanOrEqual(100000);
				copyBuffer += message.text;
			}
			if (message.type === 'clipboard.end') {
				if (options.failCopy) response = { ...response, ok: false, error: 'Android refused the copy' };
				else copiedText = copyBuffer;
			}
			if (message.type === 'export.begin') response = options.cancel ? { ...response, ok: false, error: 'cancelled' } : { ...response, transfer: 'file' };
			if (message.type === 'export.chunk') {
				if (options.failChunk) response = { ...response, ok: false, error: 'Disk full' };
				else {
					expect(message.offset).toBe(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
					const bytes = Buffer.from(message.data, 'base64'); expect(bytes.length).toBeLessThanOrEqual(49152); chunks.push(bytes);
				}
			}
			if (message.type === 'export.end') saved.push(Buffer.concat(chunks));
			window.ChungusNative.onmessage({ data: JSON.stringify(response) });
		};
		if (message.type === 'clipboard.begin' && options.dropCopy) return;
		if (['share.end', 'share.text.end'].includes(message.type) && options.holdShare) shareReply = respond;
		else if (message.type === 'clipboard.end' && options.holdCopy) copyReply = respond;
		else if (message.type === 'export.begin' && options.holdPicker) pickerReply = respond;
		else queueMicrotask(respond);
	} };
	let fetches = 0;
	const bytes = Uint8Array.from({ length: 160000 }, (_, i) => i % 256);
	runInNewContext(script, { window, location: { href: 'https://chungus.test/', origin: 'https://chungus.test' }, URL: BrowserURL,
		Blob, File, HTMLAnchorElement: Anchor, Element: Anchor, Event: class { constructor(public type: string) {} }, KeyboardEvent: class {}, btoa, atob, setTimeout, clearTimeout,
		document: { addEventListener: (type: string, fn: (event: any) => void) => events.set(type, fn) },
		fetch: async (_url: string, init: RequestInit) => { fetches++; expect(init.credentials).toBe('same-origin'); return new Response(bytes); }
	});
	return { window, messages, saved, bytes, revoked, Anchor, BrowserURL, events,
		shared, get sharedText() { return sharedText; },
		confirmShare() { if (!shareReply) throw Error('No share to confirm'); shareReply(); shareReply = undefined; },
		get copiedText() { return copiedText; },
		confirmCopy() { if (!copyReply) throw Error('No copy to confirm'); copyReply(); copyReply = undefined; },
		chooseDestination() { if (!pickerReply) throw new Error('Picker has not opened'); pickerReply(); pickerReply = undefined; },
		get browserClicks() { return browserClicks; }, get fetches() { return fetches; } };
}
async function until(condition: () => boolean) {
	const deadline = Date.now() + 2000;
	while (!condition()) { if (Date.now() > deadline) throw Error('Adapter did not settle'); await new Promise(resolve => setTimeout(resolve, 1)); }
}

test('browser builds do not install Android navigation hooks', () => {
	expect(isAndroidClient()).toBe(false);
	expect(() => installAndroidBack(() => true)()).not.toThrow();
	expect(canPinChatShortcut()).toBe(false);
});

test('native reader preserves speech text, bounds metadata and exposes transport state', async () => {
	const h = harness(), client = h.window.ChungusAndroidClient;
	const text = '“Olá!”\nThe moon 🌙 rose.';
	await client.readAloud(text, 'x'.repeat(250));
	expect(h.messages[0]).toMatchObject({ type: 'speech.start', text, title: 'x'.repeat(180) });
	expect(await client.readingState()).toEqual({ phase: 'paused', sentence: 2, total: 5 });
	for (const command of ['play', 'pause', 'previous', 'next', 'stop']) {
		await client.readingCommand(command);
		expect(h.messages.at(-1)).toMatchObject({ type: 'speech.command', command });
	}
});

test('invalid and excessively escaped speech never reaches the Android bridge', async () => {
	const h = harness(), client = h.window.ChungusAndroidClient;
	for (const text of ['', ' \n', 'x'.repeat(80001), '\\'.repeat(60000)]) await expect(client.readAloud(text, 'Chat')).rejects.toThrow();
	await expect(client.readingCommand('delete')).rejects.toThrow('Unknown reading command');
	expect(h.messages).toHaveLength(0);
});

test('sentence highlighting carries a bounded reading identity and preserves optional preferences', async () => {
 const h = harness(), client = h.window.ChungusAndroidClient;
 expect(client.readingHighlights).toBe(true);
 await client.readAloud('One. One.', 'Chat', 'reading-123');
 expect(h.messages.at(-1)).toMatchObject({ requestId: 'reading-123', text: 'One. One.' });
 for (const requestId of ['', 'x'.repeat(81), {}, 'with space']) await expect(client.readAloud('Text.', 'Chat', requestId)).rejects.toThrow();
 for (const highlightSpeech of [true, false]) expect(await client.saveReadingSettings({ engine: 'google', voice: '', rate: 1, highlightSpeech })).toMatchObject({ highlightSpeech });
 for (const highlightSpeech of ['true', null, 1]) await expect(client.saveReadingSettings({ engine: 'google', voice: '', rate: 1, highlightSpeech })).rejects.toThrow();
});

test('voice settings bridge preserves exact voice IDs and rejects invalid speeds and identifiers', async () => {
	const h = harness(), client = h.window.ChungusAndroidClient;
	expect(await client.readingSettings()).toMatchObject({ engine: 'google', rate: 1 });
	expect(await client.saveReadingSettings({ engine: 'google', voice: 'en-us-x-iom-local', rate: 1.35 })).toEqual({ engine: 'google', voice: 'en-us-x-iom-local', rate: 1.35 });
	expect(h.messages.at(-1)).toMatchObject({ type: 'speech.settings.save', engine: 'google', voice: 'en-us-x-iom-local', rate: 1.35 });
	const count = h.messages.length;
	for (const rate of [NaN, Infinity, 0.49, 2.01, '1']) await expect(client.saveReadingSettings({ engine: 'google', voice: '', rate })).rejects.toThrow();
	await expect(client.saveReadingSettings({ engine: 'google', voice: 'x'.repeat(513), rate: 1 })).rejects.toThrow();
	expect(h.messages).toHaveLength(count);
});

test('native shortcuts send chat metadata and acknowledge the exact launch request', async () => {
	const h = harness();
	const previous = globalThis.window;
	globalThis.window = h.window;
	try {
		expect(canPinChatShortcut()).toBe(true);
		await pinChatShortcut('chat-1', 'Minha história 🦝');
		expect(h.messages[0]).toMatchObject({ type: 'shortcut.pin', chatId: 'chat-1', title: 'Minha história 🦝' });
		expect(await h.window.ChungusAndroidClient.pendingChatShortcut()).toEqual({ id: 'launch-1', chatId: 'chat-1' });
		await h.window.ChungusAndroidClient.acknowledgeChatShortcut('launch-1');
		expect(h.messages.at(-1)).toMatchObject({ type: 'shortcut.acknowledge', request: 'launch-1' });
	} finally { if (previous === undefined) delete (globalThis as any).window; else globalThis.window = previous; }
});

test('audio mixing capability carries real booleans and legacy voice saves omit the new field', async () => {
	const h = harness(), client = h.window.ChungusAndroidClient;
	expect(client.readingMixAudio).toBe(true);
	for (const mixAudio of [true, false]) {
		expect(await client.saveReadingSettings({ engine: 'google', voice: '', rate: 1, mixAudio })).toMatchObject({ mixAudio });
		expect(h.messages.at(-1).mixAudio).toBe(mixAudio);
	}
	await client.saveReadingSettings({ engine: 'google', voice: '', rate: 1.25 });
	expect('mixAudio' in h.messages.at(-1)).toBe(false);
	const count = h.messages.length;
	for (const mixAudio of [null, 'true', 1, {}]) await expect(client.saveReadingSettings({ engine: 'google', voice: '', rate: 1, mixAudio })).rejects.toThrow();
	expect(h.messages).toHaveLength(count);
});

test('native copy preserves long Unicode and escaped text and waits for the final acknowledgement', async () => {
	const h = harness({ holdCopy: true });
	const previousWindow = globalThis.window;
	globalThis.window = h.window;
	try {
		const text = ('🦝 ação, 日本語, "quotes" \\ tabs\t\n\n' + '\u0001'.repeat(100)).repeat(1000);
		let done = false;
		const copying = copyText(text).then(() => { done = true; });
		await until(() => h.messages.at(-1)?.type === 'clipboard.end');
		expect(done).toBe(false);
		expect(h.copiedText).toBe('');
		await expect(copyText('A concurrent copy')).rejects.toThrow('Another copy is in progress');
		h.confirmCopy();
		await copying;
		expect(done).toBe(true);
		expect(h.copiedText).toBe(text);
		expect(h.messages[0]).toMatchObject({ type: 'clipboard.begin', size: text.length });
	} finally {
		if (previousWindow === undefined) delete (globalThis as any).window; else globalThis.window = previousWindow;
	}
});

test('native clipboard errors reject, abort and never report browser success', async () => {
	const h = harness({ failCopy: true });
	await expect(h.window.ChungusAndroidClient.copyText('Keep my text')).rejects.toThrow('Android refused the copy');
	expect(h.copiedText).toBe('');
	expect(h.messages.map(m => m.type)).toEqual(['clipboard.begin', 'clipboard.chunk', 'clipboard.end', 'clipboard.abort']);
	await expect(h.window.ChungusAndroidClient.copyText('Retry')).rejects.toThrow('Android refused the copy');
	await expect(h.window.ChungusAndroidClient.copyText('')).rejects.toThrow('empty or too large');
});

test('a missing Android clipboard acknowledgement rejects instead of leaving the button stuck', async () => {
	const h = harness({ dropCopy: true });
	await expect(h.window.ChungusAndroidClient.copyText('test')).rejects.toThrow('Android did not confirm');
}, 7000);

test('native sharing uses the feed plain-text serializer and waits for the Sharesheet', async () => {
	const h = harness({ holdShare: true }), previousWindow = globalThis.window;
	globalThis.window = h.window;
	try {
		const text = serializeFeedAsPlainText({ title: 'A fictional thread', post: { username: 'reader', body: 'A post about the chapter.', score: 10 },
			comments: [{ username: 'another_reader', body: 'A reply with ação 🦝.', score: 3, replies: [] }] });
		let done = false;
		const sharing = shareNativeText(text).then(() => { done = true; });
		await until(() => h.messages.at(-1)?.type === 'share.text.end');
		expect(done).toBe(false);
		await expect(shareNativeText('Second click')).rejects.toThrow('Another share is in progress');
		h.confirmShare(); await sharing;
		expect(h.sharedText).toBe(text);
		expect(h.sharedText).toContain('A reply with ação 🦝.');
		expect(h.sharedText).not.toContain('"username":');
		expect(h.messages.every(message => !message.type.startsWith('clipboard.'))).toBe(true);
	} finally {
		if (previousWindow === undefined) delete (globalThis as any).window; else globalThis.window = previousWindow;
	}
});

test('file sharing preserves binary bytes in bounded chunks and aborts preparation and write failures', async () => {
	const h = harness();
	await h.window.ChungusAndroidClient.shareFile('character.png', 'image/png', async () => new Blob([h.bytes]));
	expect(h.shared[0]).toEqual(Buffer.from(h.bytes));
	expect(h.saved).toHaveLength(0);
	expect(h.messages[0]).toMatchObject({ type: 'share.begin', filename: 'character.png', mime: 'image/png', size: -1 });
	const failed = harness({ failChunk: true });
	await expect(failed.window.ChungusAndroidClient.shareFile('character.png', 'image/png', async () => new Blob([h.bytes]))).rejects.toThrow('Cache full');
	expect(failed.messages.at(-1).type).toBe('share.abort');
	expect(failed.shared).toHaveLength(0);
	const preparation = harness();
	await expect(preparation.window.ChungusAndroidClient.shareFile('character.png', 'image/png', async () => { throw Error('Portrait failed'); })).rejects.toThrow('Portrait failed');
	expect(preparation.messages.map(message => message.type)).toEqual(['share.begin', 'share.abort']);
});

test('Sharesheet failures propagate instead of reporting a successful share', async () => {
	const h = harness({ failShare: true });
	await expect(h.window.ChungusAndroidClient.shareText('A message')).rejects.toThrow('Sharing unavailable');
	await expect(h.window.ChungusAndroidClient.shareFile('character.json', 'application/json', async () => new Blob(['{}']))).rejects.toThrow('Sharing unavailable');
	expect(h.messages.at(-1).type).toBe('share.abort');
	expect(h.shared).toHaveLength(0);
});

const sharedCharacter: LibraryEntry = { id: 'shared-test', type: 'character', identity: { name: 'A shared character' },
	data: { traits: { description: 'A fictional character, preserved across sharing.' } }, isFavorite: false, createdAt: 1, updatedAt: 2 };

test('incoming shares are listed without reading their bytes, retain Unicode names and import through the normal parser', async () => {
	const json = JSON.stringify(buildSillyTavernCard(sharedCharacter, [], 'all'));
	const h = harness({ incoming: [{ name: '🦝 ação.json', mime: 'application/json', bytes: new TextEncoder().encode(json) }] });
	const [item] = await h.window.ChungusAndroidClient.incomingFiles();
	expect(h.messages.map(message => message.type)).toEqual(['incoming.list']);
	const file = await h.window.ChungusAndroidClient.readIncomingFile(item);
	expect(file.name).toBe('🦝 ação.json');
	expect(await file.text()).toBe(json);
	const imported = await importSillyTavernCard(file);
	expect(imported.character.name).toBe(sharedCharacter.identity.name);
	expect(imported.character.traits.description).toBe(sharedCharacter.data.traits.description);
	expect(await h.window.ChungusAndroidClient.incomingFiles()).toHaveLength(1);
	await h.window.ChungusAndroidClient.removeIncomingFile(item.id);
	expect(await h.window.ChungusAndroidClient.incomingFiles()).toHaveLength(0);
	await expect(h.window.ChungusAndroidClient.readIncomingFile(item)).rejects.toThrow('no longer available');
});

test('incoming large files reassemble exactly and reject invalid lengths before allocating', async () => {
	const bytes = Uint8Array.from({ length: 160000 }, (_, i) => i % 256);
	const h = harness({ incoming: [{ name: 'character.png', mime: 'image/png', bytes }] });
	const [item] = await h.window.ChungusAndroidClient.incomingFiles();
	const file = await h.window.ChungusAndroidClient.readIncomingFile(item);
	expect(Buffer.from(await file.arrayBuffer())).toEqual(Buffer.from(bytes));
	expect(h.messages.filter(m => m.type === 'incoming.read').map(m => m.offset)).toEqual([0, 49152, 98304, 147456]);
	await expect(h.window.ChungusAndroidClient.readIncomingFile({ ...item, size: 0 })).rejects.toThrow('Invalid shared file size');
	await expect(h.window.ChungusAndroidClient.readIncomingFile({ ...item, size: 129 * 1024 * 1024 })).rejects.toThrow('Invalid shared file size');
});

test('shared PNG exports use the same card metadata and original portrait as saved PNG exports', async () => {
	const h = harness(), previousWindow = globalThis.window, previousFetch = globalThis.fetch;
	globalThis.window = h.window;
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=', 'base64');
	globalThis.fetch = (async () => new Response(png, { headers: { 'content-type': 'image/png' } })) as typeof fetch;
	try {
		const entry = { ...sharedCharacter, identity: { ...sharedCharacter.identity, imageUrl: 'images/characters/test.png' } };
		await exportEntryAsSillyTavern(entry, [], 'all', { format: 'png', schema: 'v3', destination: 'share' });
		expect(h.messages[0].type).toBe('share.begin');
		expect(h.saved).toHaveLength(0);
		const imported = await importSillyTavernCard(new File([h.shared[0]], 'character.png', { type: 'image/png' }));
		expect(imported.character.name).toBe(entry.identity.name);
		expect(imported.character.traits.description).toBe(entry.data.traits.description);
		expect(Buffer.from(await imported.imageFile!.arrayBuffer())).toEqual(png);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousWindow === undefined) delete (globalThis as any).window; else globalThis.window = previousWindow;
	}
});

test('browsers and older APKs never silently download a file requested for native sharing', async () => {
	let builds = 0;
	await expect(saveGeneratedDownload('character.json', 'application/json', async () => { builds++; return new Blob(['{}']); }, 'share')).rejects.toThrow('Update the Android app');
	expect(builds).toBe(0);
});

test('native lifecycle exposes current foreground state and signals only changes', () => {
	const h = harness(), changes: boolean[] = [];
	h.window.dispatchEvent = (event: Event) => {
		if (event.type === 'chungus-android-lifecycle') changes.push(h.window.ChungusAndroidClient.foreground);
	};
	expect(h.window.ChungusAndroidClient.foreground).toBe(true);
	h.window.ChungusAndroidClient.setForeground(false);
	h.window.ChungusAndroidClient.setForeground(false);
	h.window.ChungusAndroidClient.setForeground(true);
	expect(changes).toEqual([false, true]);
	expect(h.window.ChungusAndroidClient.foreground).toBe(true);
	expect(h.messages).toHaveLength(0);
});
test('Android exports preserve binary data despite immediate object URL revocation', async () => {
	const h = harness(), blob = new Blob([h.bytes], { type: 'image/png' });
	const url = h.BrowserURL.createObjectURL(blob);
	new h.Anchor(url, 'character.png').click(); h.BrowserURL.revokeObjectURL(url);
	await until(() => h.saved.length === 1);
	expect(h.saved[0]).toEqual(Buffer.from(h.bytes));
	expect(h.messages[0]).toMatchObject({ type: 'export.begin', filename: 'character.png', mime: 'image/png', size: h.bytes.length });
	expect(h.browserClicks).toBe(0); expect(h.fetches).toBe(0); expect(h.revoked).toEqual([url]);
});
test('normal download links and authenticated server responses use the same chunked path', async () => {
	const h = harness(), anchor = new h.Anchor('https://chungus.test/api/export?token=one-use', 'backup.zip');
	let prevented = false;
	h.events.get('click')!({ target: anchor, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
	await until(() => h.saved.length === 1);
	expect(prevented).toBe(true); expect(h.fetches).toBe(1); expect(h.saved[0]).toEqual(Buffer.from(h.bytes));
	expect(h.messages[0]).toMatchObject({ filename: 'backup.zip', size: -1 });
});
test('cancelling the document picker creates no chunks and no failure notice', async () => {
	const h = harness({ cancel: true });
	await h.window.ChungusAndroidClient.download('https://chungus.test/export', 'test.zip');
	expect(h.messages.map(message => message.type)).toEqual(['export.begin']);
	expect(h.saved).toHaveLength(0);
});
test('failed writes abort the native transfer and report the failure', async () => {
	const h = harness({ failChunk: true });
	await h.window.ChungusAndroidClient.download('https://chungus.test/export', 'test.zip');
	expect(h.messages.map(message => message.type)).toEqual(['export.begin', 'export.chunk', 'export.abort', 'notice']);
	expect(h.saved).toHaveLength(0);
});
test('external sources and subframes do not get access to native exports', async () => {
	const h = harness();
	await h.window.ChungusAndroidClient.download('https://evil.test/export', 'test.zip');
	expect(h.fetches).toBe(0); expect(h.messages.map(message => message.type)).toEqual(['notice']);
	expect(harness({ frame: true }).window.ChungusAndroidClient).toBeUndefined();
});

test('character PNG opens the picker before fetching art, prepares it once, and reimports losslessly', async () => {
	const h = harness({ holdPicker: true });
	const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
	globalThis.window = h.window;
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=', 'base64');
	let portraitFetches = 0;
	globalThis.fetch = (async () => { portraitFetches++; return new Response(png, { headers: { 'content-type': 'image/png' } }); }) as typeof fetch;
	const entry: LibraryEntry = { id: 'export-test', type: 'character', identity: { name: 'Test character', imageUrl: 'images/characters/test.png' },
		data: { traits: { description: 'A fictional test character.' }, alternateGreetings: ['Another greeting.'] },
		isFavorite: false, createdAt: 1, updatedAt: 2 };
	try {
		const saving = exportEntryAsSillyTavern(entry, [], 'all', { format: 'png', schema: 'v3' });
		expect(h.messages).toHaveLength(1);
		expect(h.messages[0]).toMatchObject({ type: 'export.begin', filename: 'Test character.png', mime: 'image/png', size: -1 });
		expect(portraitFetches).toBe(0);
		expect(h.saved).toHaveLength(0);
		h.chooseDestination();
		await saving;
		expect(portraitFetches).toBe(1);
		expect(h.saved).toHaveLength(1);
		expect(h.messages.at(-1).type).toBe('export.end');
		const imported = await importSillyTavernCard(new File([h.saved[0]], 'character.png', { type: 'image/png' }));
		expect(imported.character.name).toBe(entry.identity.name);
		expect(imported.character.traits.description).toBe(entry.data.traits.description);
		expect(imported.character.alternateGreetings).toEqual(entry.data.alternateGreetings);
		expect(Buffer.from(await imported.imageFile!.arrayBuffer())).toEqual(png);
	} finally {
		globalThis.fetch = previousFetch;
		if (previousWindow === undefined) delete (globalThis as any).window; else globalThis.window = previousWindow;
	}
});

test('cancelling a generated export never runs its producer', async () => {
	const h = harness({ cancel: true });
	let builds = 0;
	await h.window.ChungusAndroidClient.save('character.png', 'image/png', async () => { builds++; return new Blob([h.bytes]); });
		expect(builds).toBe(0);
		expect(h.messages.map(message => message.type)).toEqual(['export.begin']);
		expect(h.saved).toHaveLength(0);
});

test('generation failure aborts the chosen file and reaches the export UI', async () => {
	const h = harness();
	await expect(h.window.ChungusAndroidClient.save('character.png', 'image/png', async () => { throw new Error('Image fetch failed'); })).rejects.toThrow('Image fetch failed');
		expect(h.messages.map(message => message.type)).toEqual(['export.begin', 'export.abort']);
		expect(h.saved).toHaveLength(0);
});

test('a generated file still uses bounded binary chunks and aborts failed writes', async () => {
	const h = harness(), blob = new Blob([h.bytes]);
	await h.window.ChungusAndroidClient.save('large.png', 'image/png', async () => blob);
		expect(h.saved[0]).toEqual(Buffer.from(h.bytes));
	const failed = harness({ failChunk: true });
	await expect(failed.window.ChungusAndroidClient.save('large.png', 'image/png', async () => blob)).rejects.toThrow('Disk full');
		expect(failed.messages.map(message => message.type)).toEqual(['export.begin', 'export.chunk', 'export.abort']);
		expect(failed.saved).toHaveLength(0);
});

test('older Android clients retain the anchor-download fallback', async () => {
	const h = harness(), previousWindow = globalThis.window, previousDocument = globalThis.document, previousURL = globalThis.URL;
	const { save: _save, ...oldClient } = h.window.ChungusAndroidClient;
	h.window.ChungusAndroidClient = oldClient;
	globalThis.window = h.window;
	globalThis.URL = h.BrowserURL;
	globalThis.document = { createElement: () => new h.Anchor(''), body: { appendChild() {} } } as any;
	try {
		let builds = 0;
		await saveGeneratedDownload('legacy.png', 'image/png', async () => { builds++; return new Blob([h.bytes], { type: 'image/png' }); });
		await until(() => h.saved.length === 1);
		expect(builds).toBe(1);
		expect(h.messages[0]).toMatchObject({ type: 'export.begin', filename: 'legacy.png', size: h.bytes.length });
		expect(h.saved[0]).toEqual(Buffer.from(h.bytes));
	} finally {
		globalThis.URL = previousURL;
		if (previousWindow === undefined) delete (globalThis as any).window; else globalThis.window = previousWindow;
		if (previousDocument === undefined) delete (globalThis as any).document; else globalThis.document = previousDocument;
	}
});


test('speech rules preserve order and regex source, reject malformed payloads before native writes', async () => {
 const h = harness();
 expect(await h.window.ChungusAndroidClient.readingRules()).toEqual([]);
 const rules = [{ id: 'b', pattern: String.raw`\[[^\]]*\]`, regex: true, caseSensitive: false, enabled: true },
  { id: 'a', pattern: 'OOC', regex: false, caseSensitive: true, enabled: false }];
 await h.window.ChungusAndroidClient.saveReadingRules(rules);
 expect(h.messages.at(-1)).toMatchObject({ type: 'speech.rules.save', rules });
 const count = h.messages.length;
 for (const invalid of [[...rules, rules[0]], [{ ...rules[0], pattern: '' }], [{ ...rules[0], regex: 'true' }], Array(31).fill(rules[0])])
  await expect(h.window.ChungusAndroidClient.saveReadingRules(invalid)).rejects.toThrow('Invalid speech rules');
 expect(h.messages).toHaveLength(count);
});


test('rule-name capability preserves labels and legacy unnamed rules, and bounds names before native writes', async () => {
 const h = harness();
 expect(h.window.ChungusAndroidClient.readingRuleNames).toBe(true);
 const named = { id: 'named', name: 'Hide emojis', pattern: '[a-z]', regex: true, caseSensitive: false, enabled: true };
 const legacy = { id: 'old', pattern: 'OOC', regex: false, caseSensitive: false, enabled: false };
 await h.window.ChungusAndroidClient.saveReadingRules([named, legacy]);
 expect(h.messages.at(-1).rules).toEqual([named, { ...legacy, name: '' }]);
 const count = h.messages.length;
 for (const name of [null, 42, 'x'.repeat(121)])
  await expect(h.window.ChungusAndroidClient.saveReadingRules([{ ...named, name }])).rejects.toThrow('Invalid speech rules');
 expect(h.messages).toHaveLength(count);
});
