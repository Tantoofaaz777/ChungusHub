import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ChatState, Message } from '$lib/types/chat';
import type { MemoryScene } from '$shared/memory-scenes';
import { findActivePath } from '$lib/utils/message-tree';

// Exercise the real memory lifecycle and public swipe action; Svelte compiles view runes.
const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity, snapshot: structuredClone });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
const realDatabase = { ...await import('$lib/services/database') };
const realChat = { ...await import('./chat.svelte') };
const realMemory = { ...await import('$lib/memory/scene-store.svelte') };
afterAll(() => {
	mock.module('$lib/services/database', () => realDatabase);
	mock.module('$lib/stores/chat.svelte', () => realChat);
	mock.module('$lib/memory/scene-store.svelte', () => realMemory);
});

let reads: { resolve: (scenes: MemoryScene[]) => void; reject: (error: Error) => void }[] = [];
const memory = new realMemory.SceneMemoryStore();
function state(chatId: string): ChatState {
	const allMessages = [
		{ id: `${chatId}-user`, chatId, parentId: null, role: 'user', content: 'A question', siblingIndex: 0 },
		{ id: `${chatId}-reply`, chatId, parentId: `${chatId}-user`, role: 'assistant', content: 'First reply', siblingIndex: 0 },
		{ id: `${chatId}-alternate`, chatId, parentId: `${chatId}-user`, role: 'assistant', content: 'Second reply', siblingIndex: 1 }
	] as Message[];
	return {
		chat: { id: chatId, activeLeafId: `${chatId}-reply` },
		allMessages, activePath: findActivePath(allMessages, `${chatId}-reply`), messagesRev: 1
	} as ChatState;
}
const chat = {
	stream: null, visibleLiveElsewhere: null,
	currentChatState: state('a'),
	navigateToLeaf: async (leafId: string) => {
		const current = chat.currentChatState;
		chat.currentChatState = {
			...current, chat: { ...current.chat, activeLeafId: leafId }, activePath: findActivePath(current.allMessages, leafId)
		};
	}
};
mock.module('$lib/services/database', () => ({ ...realDatabase, db: {
	...realDatabase.db,
	getMemoryScenes: () => new Promise<MemoryScene[]>((resolve, reject) => reads.push({ resolve, reject }))
} }));
mock.module('$lib/stores/chat.svelte', () => ({ ...realChat, chatStore: chat }));
mock.module('$lib/memory/scene-store.svelte', () => ({ ...realMemory, memoryStore: memory }));
const { messageStore } = await import('./messages.svelte');
beforeEach(() => { memory.clear(); reads = []; chat.currentChatState = state('a'); });
async function open() {
	const loading = memory.loadForChat('a'); reads.shift()!.resolve([]); await loading;
}
async function swipe(direction: 'prev' | 'next') {
	await messageStore.navigateToSibling(chat.currentChatState.chat.activeLeafId!, direction);
}
const leaf = () => chat.currentChatState.chat.activeLeafId;

describe('response swipes across memory reconnects', () => {
	test('waits for the first snapshot, then navigates saved alternatives', async () => {
		const loading = memory.loadForChat('a');
		await swipe('next'); expect(leaf()).toBe('a-reply');
		reads.shift()!.resolve([]); await loading;
		await swipe('next'); expect(leaf()).toBe('a-alternate');
	});
	test('both arrows keep working while a same-chat refresh is pending and after it finishes', async () => {
		await open(); const refresh = memory.syncReload();
		await swipe('next'); expect(leaf()).toBe('a-alternate');
		await swipe('prev'); expect(leaf()).toBe('a-reply');
		reads.shift()!.resolve([]); await refresh;
		await swipe('next'); expect(leaf()).toBe('a-alternate');
	});
	test('a refresh failure and retry do not disable navigation over cached coverage', async () => {
		await open(); const refresh = memory.syncReload();
		reads.shift()!.reject(new Error('Offline')); await expect(refresh).rejects.toThrow('Offline');
		await swipe('next'); expect(leaf()).toBe('a-alternate');
		const retry = memory.syncReload(); await swipe('prev'); expect(leaf()).toBe('a-reply');
		reads.shift()!.resolve([]); await retry;
		await swipe('next'); expect(leaf()).toBe('a-alternate');
	});
	test('another chat cannot use the previous chat snapshot, even if a late refresh finishes', async () => {
		await open(); const refresh = memory.syncReload();
		chat.currentChatState = state('b');
		await swipe('next'); expect(leaf()).toBe('b-reply');
		const next = memory.loadForChat('b');
		reads.shift()!.resolve([]); await refresh;
		await swipe('next'); expect(leaf()).toBe('b-reply');
		reads.shift()!.resolve([]); await next;
		await swipe('next'); expect(leaf()).toBe('b-alternate');
	});
	test('a failed first load keeps swipes blocked until its retry succeeds', async () => {
		const loading = memory.loadForChat('a'); reads.shift()!.reject(new Error('Offline'));
		await expect(loading).rejects.toThrow('Offline');
		await swipe('next'); expect(leaf()).toBe('a-reply');
		await open(); await swipe('next'); expect(leaf()).toBe('a-alternate');
	});
});
