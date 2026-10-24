/**
 * Deleting a turn from the transcript, driven through the real message store against the
 * real server database, so the server's own pointer repair and deltas are what the store
 * meets. Run with `bun test`.
 *
 * What is under test is what the reader sees: the transcript moves from the story before
 * the delete to the story after it in ONE change. Every server call the delete makes is a
 * point where the page can paint, and a path left empty at any of them draws the whole chat
 * as a new one, opening-scene card included, until the next load puts it back.
 *
 * Same env dance as server/messageRev.test.ts: CHUNGUS_DATA_DIR is pinned to a throwaway
 * dir before the first db call, so nothing here can touch real user-data. Runes are shimmed
 * as in transcript-refresh.test.ts.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureScene, resolveScenes, type MemoryScene } from '../../../shared/memory-scenes';

const identity = <T>(value?: T): T | undefined => value;
(globalThis as unknown as { $state: unknown }).$state = Object.assign(identity, { raw: identity });
(globalThis as unknown as { $derived: unknown }).$derived = Object.assign(identity, {
	by: <T>(fn: () => T): T => fn()
});

let dataDir: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let serverDb: any;

const realDatabase = { ...(await import('$lib/services/database')) };
const realTransport = { ...(await import('$lib/services/transport')) };
const realMemory = { ...(await import('$lib/memory/scene-store.svelte')) };

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-message-delete-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb } = await import('../../../server/db'));
	serverDb.closeForTests();
});

afterAll(() => {
	mock.module('$lib/services/database', () => realDatabase);
	mock.module('$lib/services/transport', () => realTransport);
	mock.module('$lib/memory/scene-store.svelte', () => realMemory);
	serverDb.closeForTests();
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

/** The path on screen at every server call, and once more when the delete returns. */
let frames: string[] = [];
const frame = () => {
	const ids = chatStore.currentChatState?.activePath.map((m) => labelOf.get(m.id) ?? m.id) ?? [];
	const drawn = ids.join('>') || '(empty)';
	if (frames.at(-1) !== drawn) frames.push(drawn);
};

// Every RPC lands on the real server method, through a clone, as the wire would carry it.
mock.module('$lib/services/database', () => ({
	...realDatabase,
	db: new Proxy(
		{},
		{
			get: (_, name: string) =>
				async (...args: unknown[]) => {
					frame();
					return structuredClone(serverDb[name](...args));
				}
		}
	)
}));
mock.module('$lib/services/transport', () => ({ ...realTransport, llmStatus: async () => [], stopGeneration: () => {} }));
const fakeMemory = {
	activeChatId: null as string | null,
	loaded: true,
	scenes: [] as MemoryScene[],
	get archivedMessageIds(): Set<string> {
		const state = chatStore.currentChatState;
		return new Set(resolveScenes(fakeMemory.scenes, state?.activePath ?? [], state?.allMessages ?? [])
			.filter(r => r.status === 'active').flatMap(r => r.scene.source.map(s => s.id)));
	},
	loadForChat: async (id: string) => { fakeMemory.activeChatId = id; },
	syncForPath: async () => {},
	clear: () => { fakeMemory.activeChatId = null; fakeMemory.scenes = []; },
	invalidateMessage: async () => false
};
mock.module('$lib/memory/scene-store.svelte', () => ({ ...realMemory, memoryStore: fakeMemory }));

const { chatStore } = await import('./chat.svelte');
const { messageStore } = await import('./messages.svelte');

let clock = 1_700_000_000_000;
let chatId = '';
const idOf = new Map<string, string>();
const labelOf = new Map<string, string>();

function add(label: string, parent: string | null, role: string, siblingIndex = 0): void {
	const id = crypto.randomUUID();
	idOf.set(label, id);
	labelOf.set(id, label);
	serverDb.insertMessage({
		id,
		chatId,
		parentId: parent === null ? null : idOf.get(parent),
		role,
		content: `${label} text`,
		personaId: null,
		branchLabel: null,
		thinking: null,
		attachments: null,
		createdAt: (clock += 1000),
		editedAt: null,
		model: null,
		provider: null,
		tokensPrompt: null,
		tokensCompletion: null,
		finishReason: null,
		generationMs: null,
		siblingIndex
	});
}

/** Open the chat with `leaf` as the branch being read. */
async function open(leaf: string): Promise<void> {
	serverDb.updateChat({ id: chatId, rootMessageId: idOf.get('greeting'), activeLeafId: idOf.get(leaf) });
	chatStore.chats = [serverDb.getChat(chatId)];
	chatStore.activeChatId = chatId;
	chatStore.currentChatState = null;
	await chatStore.loadChatState(chatId);
	frames = [];
	frame();
}

beforeEach(() => {
	fakeMemory.clear();
	fakeMemory.loaded = true;
	chatId = crypto.randomUUID();
	idOf.clear();
	labelOf.clear();
	serverDb.insertChat({
		id: chatId,
		title: 'Delete chat',
		createdAt: clock,
		updatedAt: clock,
		rootMessageId: null,
		activeLeafId: null,
		canonLeafId: null,
		settings: null,
		characterId: null,
		characterVersionId: null
	});
	add('greeting', null, 'assistant');
	add('user', 'greeting', 'user');
	add('reply', 'user', 'assistant');
});

describe('deleting from the transcript', () => {
	test('the newest turn goes in one change', async () => {
		await open('reply');
		await messageStore.deleteMessage(idOf.get('reply')!, 'this_only');
		frame();
		expect(frames).toEqual(['greeting>user>reply', 'greeting>user']);
	});

	test('a swipe hands over to the one beside it in one change', async () => {
		add('swipe', 'user', 'assistant', 1);
		await open('reply');
		await messageStore.deleteMessage(idOf.get('reply')!, 'this_only');
		frame();
		expect(frames).toEqual(['greeting>user>reply', 'greeting>user>swipe']);
	});

	test('a whole branch hands over to the fork beside it in one change', async () => {
		add('other', 'greeting', 'user', 1);
		add('other-reply', 'other', 'assistant');
		await open('reply');
		await messageStore.deleteMessage(idOf.get('user')!, 'with_descendants');
		frame();
		expect(frames).toEqual(['greeting>user>reply', 'greeting>other>other-reply']);
	});

	for (const action of ['this_only', 'with_descendants'] as const) {
		test(`${action} reconciles a swipe already deleted on another device`, async () => {
			add('survivor', 'user', 'assistant', 1);
			await open('reply');
			serverDb.deleteMessageAndDescendants(idOf.get('reply')!);
			serverDb.updateChatActiveLeaf(chatId, idOf.get('survivor')!);
			await messageStore.deleteMessage(idOf.get('reply')!, action);
			expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('survivor'));
			expect(serverDb.getMessagesByChat(chatId)).toHaveLength(3);
		});

		test(`${action} uses the current parent after a remote splice`, async () => {
			await open('reply');
			// Another device removes the intervening user turn before this device refreshes.
			serverDb.deleteMessageOnly(idOf.get('user')!);
			await messageStore.deleteMessage(idOf.get('reply')!, action);
			expect(serverDb.getChat(chatId).activeLeafId).toBe(idOf.get('greeting'));
			expect(chatStore.currentChatState?.activePath.map(m => m.id)).toEqual([idOf.get('greeting')!]);
		});

		test(`${action} preserves a remote selection when deleting the previously viewed swipe`, async () => {
			add('middle', 'user', 'assistant', 1);
			add('selected-elsewhere', 'user', 'assistant', 2);
			await open('reply');
			serverDb.updateChatActiveLeaf(chatId, idOf.get('selected-elsewhere')!);
			await messageStore.deleteMessage(idOf.get('reply')!, action);
			expect(serverDb.getChat(chatId).activeLeafId).toBe(idOf.get('selected-elsewhere'));
			expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('selected-elsewhere'));
		});
	}

	test('deleting an off-path swipe removes only its subtree and bookmarks', async () => {
		add('swipe', 'user', 'assistant', 1);
		add('swipe-child', 'swipe', 'user');
		await open('reply');
		serverDb.setMessageBookmarked(idOf.get('swipe')!, true);
		serverDb.setMessageBookmarked(idOf.get('reply')!, true);
		await messageStore.deleteMessage(idOf.get('swipe')!, 'with_descendants');
		expect(chatStore.currentChatState?.activePath.map(m => labelOf.get(m.id))).toEqual(['greeting', 'user', 'reply']);
		expect(serverDb.getMessage(idOf.get('swipe-child')!)).toBeNull();
		expect(serverDb.getMessagesByChat(chatId).filter((m: { isBookmarked: boolean }) => m.isBookmarked).map((m: { id: string }) => m.id)).toEqual([idOf.get('reply')!]);
	});

	test('refuses splicing a swipe with descendants and keeps both alternatives intact', async () => {
		add('swipe', 'user', 'assistant', 1);
		add('later-user', 'reply', 'user');
		await open('later-user');
		const before = serverDb.getMessagesByChat(chatId);
		await expect(messageStore.deleteMessage(idOf.get('reply')!, 'this_only')).rejects.toThrow(/heads a branch/);
		expect(serverDb.getMessagesByChat(chatId)).toEqual(before);
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('later-user'));
	});
});

/** Exercise all swipe entry points against real rows; blocked actions never reach an LLM. */
describe('swipes belong to the last visible assistant', () => {
	test('the last response navigates immediately, including back to the first swipe', async () => {
		add('swipe', 'user', 'assistant', 1);
		await open('reply');
		await messageStore.navigateToSibling(idOf.get('reply')!, 'next');
		frame();
		expect(frames).toEqual(['greeting>user>reply', 'greeting>user>swipe']);
		await messageStore.navigateToSibling(idOf.get('swipe')!, 'prev');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('reply'));
	});

	test('an older response with alternatives cannot change the current conversation', async () => {
		add('swipe', 'user', 'assistant', 1);
		add('next-user', 'reply', 'user');
		add('next-reply', 'next-user', 'assistant');
		await open('next-reply');
		await messageStore.navigateToSibling(idOf.get('reply')!, 'next');
		await messageStore.retryMessageResponse(idOf.get('reply')!, 'branch');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('next-reply'));
	});

	test('a hidden last response blocks navigation and /swipe without falling back to an older turn', async () => {
		add('swipe', 'user', 'assistant', 1);
		await open('reply');
		await messageStore.setExcludedFromPrompt(idOf.get('reply')!, true);
		await messageStore.navigateToSibling(idOf.get('reply')!, 'next');
		await messageStore.regenerateLastResponse('branch');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('reply'));
		expect(serverDb.getMessagesByChat(chatId)).toHaveLength(4);
	});

	test('including the last response again restores navigation to its saved alternatives', async () => {
		add('swipe', 'user', 'assistant', 1);
		await open('reply');
		await messageStore.setExcludedFromPrompt(idOf.get('reply')!, true);
		await messageStore.setExcludedFromPrompt(idOf.get('reply')!, false);
		await messageStore.navigateToSibling(idOf.get('reply')!, 'next');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('swipe'));
	});

	test('a hidden root greeting cannot generate another opening through a separate entry point', async () => {
		await open('greeting');
		await messageStore.setExcludedFromPrompt(idOf.get('greeting')!, true);
		await messageStore.generateOpeningScene('A different beginning');
		await messageStore.regenerateLastResponse('branch');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('greeting'));
		expect(serverDb.getMessagesByChat(chatId)).toHaveLength(3);
	});

	test('a last user message cannot swipe even when it has siblings', async () => {
		add('other-user', 'greeting', 'user', 1);
		await open('user');
		await messageStore.navigateToSibling(idOf.get('user')!, 'next');
		await messageStore.regenerateLastResponse('branch');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('user'));
		expect(serverDb.getMessagesByChat(chatId)).toHaveLength(4);
	});

	test('a chapter covering the last response blocks both directions and new alternatives', async () => {
		add('swipe', 'user', 'assistant', 1);
		await open('swipe');
		const scene = serverDb.saveMemoryScene({ chatId, title: 'Chapter 2–3', content: 'They spoke.',
			source: captureScene(chatStore.currentChatState!.activePath.slice(1)) });
		fakeMemory.scenes = [scene];
		await messageStore.navigateToSibling(idOf.get('swipe')!, 'prev');
		await messageStore.regenerateLastResponse('branch');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('swipe'));
		expect(serverDb.getMessagesByChat(chatId)).toHaveLength(4);
	});

	test('generation checks chapters saved since this device last loaded memory', async () => {
		await open('reply');
		serverDb.saveMemoryScene({ chatId, title: 'Chapter 2–3', content: 'They spoke.',
			source: captureScene(chatStore.currentChatState!.activePath.slice(1)) });
		// The cached chapter list is still empty, so only the fresh check can reject this.
		await messageStore.regenerateLastResponse('branch');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('reply'));
		expect(serverDb.getMessagesByChat(chatId)).toHaveLength(3);
	});

	test('a new visible reply after a chapter has its own swipes', async () => {
		add('swipe', 'user', 'assistant', 1);
		await open('reply');
		fakeMemory.scenes = [serverDb.saveMemoryScene({ chatId, title: 'Chapter 1–1', content: 'The beginning.',
			source: captureScene(chatStore.currentChatState!.activePath.slice(0, 1)) })];
		await messageStore.navigateToSibling(idOf.get('reply')!, 'next');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('swipe'));
	});

	test('swipes wait until chapter coverage has loaded', async () => {
		add('swipe', 'user', 'assistant', 1);
		await open('reply');
		fakeMemory.loaded = false;
		await messageStore.navigateToSibling(idOf.get('reply')!, 'next');
		await messageStore.regenerateLastResponse('branch');
		expect(chatStore.currentChatState?.activePath.at(-1)?.id).toBe(idOf.get('reply'));
	});
});
