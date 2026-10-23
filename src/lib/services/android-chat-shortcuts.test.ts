import { expect, test } from 'bun:test';
import { installAndroidChatShortcuts } from './android-chat-shortcuts';

function setup(options: { blocked?: boolean; missing?: boolean; background?: boolean; old?: boolean } = {}) {
	const listeners = new Map<string, Set<() => void>>();
	let target: { id: string; chatId: string } | null = { id: 'launch-1', chatId: 'chat-1' };
	const opened: string[] = [], acknowledged: string[] = [], errors: unknown[] = [];
	let warnings = 0, reads = 0, blocked = !!options.blocked;
	const client = {
		version: 1, foreground: !options.background,
		pendingChatShortcut: options.old ? undefined : async () => { reads++; return target && { ...target }; },
		acknowledgeChatShortcut: async (id: string) => { acknowledged.push(id); if (target?.id === id) target = null; }
	};
	const win = {
		ChungusAndroidClient: client,
		addEventListener: (name: string, fn: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
		removeEventListener: (name: string, fn: () => void) => listeners.get(name)?.delete(fn)
	};
	const previous = globalThis.window;
	globalThis.window = win as any;
	const host = {
		blocked: () => blocked, exists: async (_id: string) => !options.missing,
		open: async (id: string) => { opened.push(id); },
		missing: () => { warnings++; }, failed: (error: unknown) => { errors.push(error); }
	};
	let dispose = () => {};
	return {
		client, host, opened, acknowledged, errors, get reads() { return reads; }, get warnings() { return warnings; },
		start() { dispose = installAndroidChatShortcuts(host); },
		emit(name = 'chungus-android-chat-shortcut') { for (const listener of listeners.get(name) ?? []) listener(); },
		setBlocked(value: boolean) { blocked = value; }, setTarget(value: typeof target) { target = value; },
		close() { dispose(); if (previous === undefined) delete (globalThis as any).window; else globalThis.window = previous; }
	};
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

test('cold workspace consumes the pending shortcut only once despite repeated ready and resume events', async () => {
	const h = setup();
	try {
		h.start(); h.emit(); h.emit('chungus-android-ready'); await settle();
		expect(h.opened).toEqual(['chat-1']); expect(h.acknowledged).toContain('launch-1');
		h.emit('chungus-android-lifecycle'); await settle(); expect(h.opened).toEqual(['chat-1']);
	} finally { h.close(); }
});

test('background and locked lifecycle waits for foreground before requesting or opening a chat', async () => {
	const h = setup({ background: true });
	try {
		h.start(); await settle(); expect(h.reads).toBe(0); expect(h.opened).toEqual([]);
		h.client.foreground = true; h.emit('chungus-android-lifecycle'); await settle();
		expect(h.opened).toEqual(['chat-1']);
	} finally { h.close(); }
});

test('unfinished edits refuse this attempt without jumping unexpectedly after the editor closes', async () => {
	const h = setup({ blocked: true });
	try {
		h.start(); await settle(); expect(h.opened).toEqual([]); expect(h.acknowledged).toEqual(['launch-1']);
		h.setBlocked(false); h.emit(); await settle(); expect(h.opened).toEqual([]);
	} finally { h.close(); }
});

test('deleted chats report the missing target and leave the current conversation intact', async () => {
	const h = setup({ missing: true });
	try {
		h.start(); await settle(); expect(h.opened).toEqual([]); expect(h.warnings).toBe(1); expect(h.acknowledged).toEqual(['launch-1']);
	} finally { h.close(); }
});

test('an incoming second shortcut is preserved while the first selection finishes', async () => {
	const h = setup();
	let finish!: () => void;
	const gate = new Promise<void>(resolve => finish = resolve);
	h.host.open = async id => { h.opened.push(id); if (id === 'chat-1') await gate; };
	try {
		h.start(); await settle(); h.setTarget({ id: 'launch-2', chatId: 'chat-2' }); h.emit();
		finish(); await settle();
		expect(h.opened).toEqual(['chat-1', 'chat-2']); expect(h.acknowledged).toEqual(['launch-1', 'launch-2']);
	} finally { h.close(); }
});

test('losing foreground or disposing during an existence check cannot open a chat later', async () => {
	const h = setup();
	let finish!: (value: boolean) => void;
	h.host.exists = () => new Promise(resolve => finish = resolve);
	try {
		h.start(); await settle(); h.client.foreground = false; finish(true); await settle();
		expect(h.opened).toEqual([]); expect(h.acknowledged).toEqual([]);
		h.close(); h.emit(); await settle(); expect(h.opened).toEqual([]);
	} finally { h.close(); }
});

test('older APKs without shortcuts do not install navigation listeners', async () => {
	const h = setup({ old: true });
	try { h.start(); h.emit(); await settle(); expect(h.reads).toBe(0); expect(h.opened).toEqual([]); }
	finally { h.close(); }
});
