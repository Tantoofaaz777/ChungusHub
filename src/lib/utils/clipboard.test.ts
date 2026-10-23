import { afterEach, expect, test } from 'bun:test';
import { copyText } from './clipboard';

const originals = new Map<string, PropertyDescriptor | undefined>();
function globalValue(name: string, value: unknown) {
	if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterEach(() => {
	for (const [name, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
	originals.clear();
});

function browser(writeText?: (text: string) => Promise<void>, allowed = true) {
	let legacyCalls = 0, copied = '';
	const selection = {
		rangeCount: 1, getRangeAt: () => ({ cloneRange: () => ({}) }), removeAllRanges() {},
		// Chromium can reset an input's caret when its document range is restored.
		addRange() { previous.setSelectionRange(0, 0, 'forward'); }
	};
	class Field {
		value = ''; style = { cssText: '' }; readOnly = false;
		isConnected = true; selectionStart = 2; selectionEnd = 4; selectionDirection = 'backward';
		focus() { doc.activeElement = this; }
		closest() { return null; }
		select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
		setSelectionRange(start: number, end: number, direction = 'none') {
			this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
		}
		remove() { this.isConnected = false; }
	}
	const previous = new Field();
	const doc = {
		activeElement: previous, body: { appendChild() {} }, querySelector() { return null; },
		createElement: () => new Field(),
		execCommand(command: string) {
			expect(command).toBe('copy'); legacyCalls++;
			if (allowed) copied = doc.activeElement.value.slice(doc.activeElement.selectionStart, doc.activeElement.selectionEnd);
			return allowed;
		}
	};
	globalValue('window', { getSelection: () => selection });
	globalValue('navigator', { clipboard: writeText ? { writeText } : undefined, userAgent: 'Test browser' });
	globalValue('document', doc);
	globalValue('HTMLInputElement', Field); globalValue('HTMLTextAreaElement', Field);
	return { previous, doc, get copied() { return copied; }, get legacyCalls() { return legacyCalls; } };
}

test('modern clipboard waits for the browser and avoids selection changes', async () => {
	let confirm!: () => void;
	const h = browser(text => { expect(text).toBe('hello'); return new Promise(resolve => { confirm = resolve; }); });
	let done = false;
	const copying = copyText('hello').then(() => { done = true; });
	await Promise.resolve(); expect(done).toBe(false);
	confirm(); await copying;
	expect(done).toBe(true); expect(h.legacyCalls).toBe(0);
});

for (const mode of ['missing', 'rejected'] as const) {
	test(`a ${mode} browser Clipboard API falls back without losing focus or the input selection`, async () => {
		const h = browser(mode === 'rejected' ? async () => { throw Error('Permission denied'); } : undefined);
		await copyText('ação\n🦝\nJapanese 日本語');
		expect(h.copied).toBe('ação\n🦝\nJapanese 日本語');
		expect(h.legacyCalls).toBe(1);
		expect(h.doc.activeElement).toBe(h.previous);
		expect([h.previous.selectionStart, h.previous.selectionEnd, h.previous.selectionDirection]).toEqual([2, 4, 'backward']);
	});
}

test('failed fallback and empty text reject instead of showing copied', async () => {
	const h = browser(undefined, false);
	await expect(copyText('')).rejects.toThrow('There is no text');
	expect(h.legacyCalls).toBe(0);
	await expect(copyText('hello')).rejects.toThrow('refused the copy');
	expect(h.doc.activeElement).toBe(h.previous);
});

test('Android failure is not hidden by a successful browser write', async () => {
	let browserCalls = 0;
	browser(async () => { browserCalls++; });
	window.ChungusAndroidClient = { version: 1, settings: async () => {}, back: () => false,
		copyText: async () => { throw Error('Native write failed'); } };
	await expect(copyText('hello')).rejects.toThrow('Native write failed');
	expect(browserCalls).toBe(0);
});

test('older APKs use the browser path until they are upgraded', async () => {
	let written = '';
	browser(async text => { written = text; });
	window.ChungusAndroidClient = { version: 1, settings: async () => {}, back: () => false };
	await copyText('compatible');
	expect(written).toBe('compatible');
});
