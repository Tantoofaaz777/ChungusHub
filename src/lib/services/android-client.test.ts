import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { isAndroidClient, installAndroidBack } from './android-client';
import { exportEntryAsSillyTavern } from './sillyTavernExport';
import { importSillyTavernCard } from './sillyTavernImport';
import type { LibraryEntry } from '$lib/types/library';
import { saveGeneratedDownload } from './libraryExport';
import { copyText } from '$lib/utils/clipboard';

const script = readFileSync(new URL('../../../android/app/src/main/assets/client.js', import.meta.url), 'utf8');
function harness(options: { cancel?: boolean; failChunk?: boolean; frame?: boolean; holdPicker?: boolean; failCopy?: boolean; holdCopy?: boolean; dropCopy?: boolean } = {}) {
	let browserClicks = 0, objectId = 0;
	let pickerReply: (() => void) | undefined;
	let copyReply: (() => void) | undefined;
	let copiedText = '', copyBuffer = '';
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
		if (message.type === 'clipboard.end' && options.holdCopy) copyReply = respond;
		else if (message.type === 'export.begin' && options.holdPicker) pickerReply = respond;
		else queueMicrotask(respond);
	} };
	let fetches = 0;
	const bytes = Uint8Array.from({ length: 160000 }, (_, i) => i % 256);
	runInNewContext(script, { window, location: { href: 'https://chungus.test/', origin: 'https://chungus.test' }, URL: BrowserURL,
		Blob, HTMLAnchorElement: Anchor, Element: Anchor, Event: class { constructor(public type: string) {} }, KeyboardEvent: class {}, btoa, setTimeout, clearTimeout,
		document: { addEventListener: (type: string, fn: (event: any) => void) => events.set(type, fn) },
		fetch: async (_url: string, init: RequestInit) => { fetches++; expect(init.credentials).toBe('same-origin'); return new Response(bytes); }
	});
	return { window, messages, saved, bytes, revoked, Anchor, BrowserURL, events,
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
