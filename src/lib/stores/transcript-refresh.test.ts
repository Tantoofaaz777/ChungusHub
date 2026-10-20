/**
 * Transcript loads that overlap: the answer that comes back last is not the one that read
 * last, and the older one must never publish over the newer. Run with `bun test`.
 *
 * Two loads are in flight constantly in ordinary use, because a mutation awaits its own
 * refresh while the sync replay `endStream` fires runs unawaited beside it. Publishing the
 * older answer puts a deleted turn back, reverts an edit and moves the branch being read,
 * and nothing corrects it until the next refresh, so each half gets its own case here.
 *
 * Runes are compile-time macros and nothing compiles the store under bun test, so `$state`
 * and `$derived` are shimmed to identity BEFORE the store module loads, exactly as
 * new-chat-flow.test.ts does. Ordering is under test; reactivity is not.
 */
import { describe, test, expect, beforeEach, afterAll, mock, spyOn } from 'bun:test';

const identity = <T>(value?: T): T | undefined => value;
(globalThis as unknown as { $state: unknown }).$state = Object.assign(identity, { raw: identity });
(globalThis as unknown as { $derived: unknown }).$derived = Object.assign(identity, {
	by: <T>(fn: () => T): T => fn()
});

type Delta =
	| { rev: number; full: true; messages: unknown[] }
	| { rev: number; full: false; upserts: unknown[]; deletedIds: string[] };

/** Deltas the fake server owes, one entry per call, each settled by hand so the test
 *  decides which read comes back first. The chat row is taken when the call arrives,
 *  as the server's one read takes it. */
let owed: { resolve: (delta: Delta) => void; reject: (error: Error) => void }[] = [];
let memoryGate: Promise<void> | null = null;
let memoryLeaves: (string | null)[] = [];
let writes: { leafId: string; resolve: () => void; reject: (error: Error) => void }[] = [];

const CHAT = { id: 'chat-1', title: 'Overlap', activeLeafId: 'reply', rootMessageId: 'greeting' };
/** The chat row as the server currently holds it. Moved between reads to model a swipe,
 *  which changes this row and no message row at all. */
let serverChat = { ...CHAT };
/** A chat row read on its own, on the far side of a write from the rows. Null reads live. */
let chatReadApart: typeof serverChat | null = null;

/**
 * Bun's module registry is process-wide and one run loads every test file into it, so a stub
 * left behind here is served to every file that loads after this one, in whatever order the
 * platform happens to walk the directory. Each mock is therefore a SPREAD of the real module,
 * so nothing an importer expects can go missing, and every one is put back in `afterAll`.
 * Only the three the load path actually reaches are stubbed; the rest of the store's imports
 * are left real, since none of them runs at import and none is called from here.
 *
 * The restore is registered BEFORE the first stub goes in, so a throw anywhere in the setup
 * below cannot leave one standing.
 */
const realDatabase = { ...(await import('$lib/services/database')) };
const realTransport = { ...(await import('$lib/services/transport')) };
const realMemory = { ...(await import('$lib/memory/scene-store.svelte')) };

afterAll(() => {
	mock.module('$lib/services/database', () => realDatabase);
	mock.module('$lib/services/transport', () => realTransport);
	mock.module('$lib/memory/scene-store.svelte', () => realMemory);
});

mock.module('$lib/services/database', () => ({
	...realDatabase,
	db: {
		updateChatActiveLeaf: (_chatId: string, leafId: string) => new Promise<void>((resolve, reject) => {
			writes.push({ leafId, reject, resolve: () => { serverChat = { ...serverChat, activeLeafId: leafId }; resolve(); } });
		}),
		getChat: async () => ({ ...(chatReadApart ?? serverChat) }),
		getMessagesDelta: () => {
			const chat = { ...serverChat };
			return new Promise((resolve, reject) => owed.push({ resolve: (delta: Delta) => resolve({ ...delta, chat }), reject }));
		},
		getAllChats: async () => [{ ...serverChat }]
	}
}));
mock.module('$lib/services/transport', () => ({
	...realTransport,
	llmStatus: async () => [],
	stopGeneration: () => {}
}));
mock.module('$lib/memory/scene-store.svelte', () => ({
	...realMemory,
	memoryStore: { activeChatId: null, loadForChat: async () => { await memoryGate; },
		syncForPath: async (ctx: { leafId: string | null }) => { memoryLeaves.push(ctx.leafId); }, clear: () => {} }
}));

const { chatStore } = await import('./chat.svelte');
const { uiStore } = await import('./ui.svelte');
const { toastStore } = await import('./toast.svelte');

const row = (id: string, parentId: string | null, role: string, content = `${id} text`) => ({
	id,
	chatId: CHAT.id,
	parentId,
	role,
	content,
	siblingIndex: 0
});

const BASE = [row('greeting', null, 'assistant'), row('user', 'greeting', 'user'), row('reply', 'user', 'assistant')];
const EDITED_USER = row('user', 'greeting', 'user', 'rewritten');

beforeEach(() => {
	memoryGate = null;
	memoryLeaves = [];
	owed = [];
	writes = [];
	serverChat = { ...CHAT };
	chatReadApart = null;
	chatStore.openingChatId = null;
	uiStore.welcomeOpen = false;
	chatStore.activeChatId = CHAT.id;
	chatStore.chats = [{ ...CHAT }] as never;
	chatStore.currentChatState = {
		chat: { ...CHAT },
		activePath: [...BASE],
		allMessages: [...BASE],
		messagesRev: 5
	} as never;
});

/** Let the store's own awaits drain, so the load has reached its delta and parked there. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Two overlapping loads, both parked on their delta: `stale` read first, `current` second. */
async function overlap(): Promise<{ stale: Promise<void>; current: Promise<void> }> {
	const stale = chatStore.loadChatState(CHAT.id);
	await settle();
	const current = chatStore.loadChatState(CHAT.id);
	await settle();
	expect(owed).toHaveLength(2);
	return { stale, current };
}

/** What the older read answers: the moment before the mutation, so nothing changed. */
const NOTHING_CHANGED: Delta = { rev: 5, full: false, upserts: [], deletedIds: [] };

const ids = () => chatStore.currentChatState!.allMessages.map((m) => m.id);
const userTurn = () => chatStore.currentChatState!.allMessages.find((m) => m.id === 'user')!.content;

describe('opening a chat', () => {
	function startAtHome() {
		chatStore.activeChatId = null;
		chatStore.currentChatState = null;
		uiStore.openWelcome();
	}

	test('shows loading from the click until the first transcript has arrived', async () => {
		startAtHome();
		const opening = chatStore.selectChat(CHAT.id);
		// This must be true before even the lorebook flush has had a chance to finish.
		expect(chatStore.openingChatId).toBe(CHAT.id);
		expect(uiStore.welcomeOpen).toBe(false);
		expect(chatStore.currentChatState).toBeNull();
		await settle();
		expect(chatStore.openingChatId).toBe(CHAT.id);
		owed[0].resolve({ rev: 5, full: true, messages: [...BASE] });
		await opening;
		expect(chatStore.openingChatId).toBeNull();
		expect(chatStore.currentChatState?.chat.id).toBe(CHAT.id);
	});

	test('does not show loading when reselecting the loaded chat or refreshing it', async () => {
		await chatStore.selectChat(CHAT.id);
		expect(chatStore.openingChatId).toBeNull();
		expect(owed).toHaveLength(0);
		const refresh = chatStore.loadChatState(CHAT.id);
		await settle();
		expect(chatStore.openingChatId).toBeNull();
		owed[0].resolve(NOTHING_CHANGED);
		await refresh;
	});

	test('retains the loaded transcript while the next chat opens', async () => {
		const previous = chatStore.currentChatState;
		serverChat = { ...CHAT, id: 'chat-2' };
		const opening = chatStore.selectChat('chat-2');
		await settle();
		expect(chatStore.openingChatId).toBe('chat-2');
		expect(chatStore.currentChatState).toBe(previous);
		owed[0].resolve({ rev: 1, full: true, messages: [] });
		await opening;
		expect(chatStore.openingChatId).toBeNull();
		expect(chatStore.currentChatState?.chat.id).toBe('chat-2');
	});

	test('a failed first open leaves loading and allows a retry', async () => {
		startAtHome();
		const notice = spyOn(toastStore, 'failed').mockImplementation(() => {});
		try {
			const opening = chatStore.selectChat(CHAT.id).catch((error: Error) => error);
			await settle();
			owed[0].reject(new Error('offline'));
			expect(await opening).toEqual(new Error('offline'));
			expect(chatStore.openingChatId).toBeNull();
			expect(chatStore.activeChatId).toBeNull();
			expect(uiStore.welcomeOpen).toBe(true);
			const retry = chatStore.selectChat(CHAT.id);
			await settle();
			expect(chatStore.openingChatId).toBe(CHAT.id);
			owed[1].resolve({ rev: 5, full: true, messages: [...BASE] });
			await retry;
			expect(chatStore.currentChatState?.chat.id).toBe(CHAT.id);
			expect(chatStore.openingChatId).toBeNull();
		} finally {
			notice.mockRestore();
		}
	});

	test('an older opening cannot clear a newer chat loading screen', async () => {
		startAtHome();
		const first = chatStore.selectChat(CHAT.id);
		await settle();
		serverChat = { ...CHAT, id: 'chat-2' };
		const second = chatStore.selectChat('chat-2');
		await settle();
		owed[0].resolve({ rev: 5, full: true, messages: [...BASE] });
		await first;
		expect(chatStore.openingChatId).toBe('chat-2');
		expect(chatStore.currentChatState).toBeNull();
		owed[1].resolve({ rev: 1, full: true, messages: [] });
		await second;
		expect(chatStore.openingChatId).toBeNull();
		expect(chatStore.currentChatState?.chat.id).toBe('chat-2');
	});

	test('a failed second opening returns home when neither selection had loaded', async () => {
		startAtHome();
		const notice = spyOn(toastStore, 'failed').mockImplementation(() => {});
		try {
			const first = chatStore.selectChat(CHAT.id);
			await settle();
			serverChat = { ...CHAT, id: 'chat-2' };
			const second = chatStore.selectChat('chat-2').catch((error: Error) => error);
			await settle();
			owed[1].reject(new Error('offline'));
			await second;
			expect(chatStore.openingChatId).toBeNull();
			expect(chatStore.activeChatId).toBeNull();
			expect(uiStore.welcomeOpen).toBe(true);
			owed[0].resolve({ rev: 5, full: true, messages: [...BASE] });
			await first;
			expect(chatStore.currentChatState).toBeNull();
		} finally {
			notice.mockRestore();
		}
	});

	test('going home cancels an opening before its initial flush completes', async () => {
		startAtHome();
		const opening = chatStore.selectChat(CHAT.id);
		await chatStore.goHome();
		await opening;
		expect(chatStore.openingChatId).toBeNull();
		expect(chatStore.activeChatId).toBeNull();
		expect(uiStore.welcomeOpen).toBe(true);
		expect(owed).toHaveLength(0);
	});

	test('going home during a read dismisses loading and rejects the late transcript', async () => {
		startAtHome();
		const opening = chatStore.selectChat(CHAT.id);
		await settle();
		await chatStore.goHome();
		expect(chatStore.openingChatId).toBeNull();
		expect(uiStore.welcomeOpen).toBe(true);
		owed[0].resolve({ rev: 5, full: true, messages: [...BASE] });
		await opening;
		expect(chatStore.currentChatState).toBeNull();
	});
});

describe('immediate branch navigation', () => {
	function addAlternative() {
		chatStore.currentChatState!.allMessages.push(row('reply-2', 'user', 'assistant') as never);
	}

	test('the selected response paints before any network write completes, without rereading the chat', async () => {
		addAlternative();
		const move = chatStore.navigateToLeaf('reply-2');
		expect(chatStore.currentChatState!.activePath.at(-1)?.id).toBe('reply-2');
		expect(owed).toHaveLength(0);
		await settle();
		expect(writes.map((w) => w.leafId)).toEqual(['reply-2']);
		writes[0].resolve();
		await move;
		expect(owed).toHaveLength(0);
	});

	test('rapid clicks paint immediately but persist in click order', async () => {
		addAlternative();
		const first = chatStore.navigateToLeaf('reply-2');
		const second = chatStore.navigateToLeaf('reply');
		expect(chatStore.currentChatState!.activePath.at(-1)?.id).toBe('reply');
		await settle();
		expect(writes).toHaveLength(1);
		writes[0].resolve();
		await first;
		await settle();
		expect(writes.map((w) => w.leafId)).toEqual(['reply-2', 'reply']);
		writes[1].resolve();
		await second;
		expect(serverChat.activeLeafId).toBe('reply');
		expect(chatStore.currentChatState!.chat.activeLeafId).toBe('reply');
	});

	test('a stale read cannot put the previous swipe back over an immediate choice', async () => {
		addAlternative();
		const stale = chatStore.loadChatState(CHAT.id);
		await settle();
		const move = chatStore.navigateToLeaf('reply-2');
		owed[0].resolve(NOTHING_CHANGED);
		await stale;
		expect(chatStore.currentChatState!.chat.activeLeafId).toBe('reply-2');
		await settle();
		writes[0].resolve();
		await move;
	});

	test('generation freshness waits until the selected swipe has reached the server', async () => {
		addAlternative();
		const move = chatStore.navigateToLeaf('reply-2');
		const fresh = chatStore.freshMessages(CHAT.id);
		await settle();
		expect(owed).toHaveLength(0);
		writes[0].resolve();
		await move;
		await settle();
		expect(owed).toHaveLength(1);
		owed[0].resolve(NOTHING_CHANGED);
		await fresh;
		expect(chatStore.currentChatState!.chat.activeLeafId).toBe('reply-2');
	});

	test('a rejected save reconciles the selection from the server', async () => {
		addAlternative();
		const move = chatStore.navigateToLeaf('reply-2').catch((error) => error);
		await settle();
		writes[0].reject(new Error('offline'));
		await settle();
		expect(owed).toHaveLength(1);
		owed[0].resolve(NOTHING_CHANGED);
		expect((await move).message).toBe('offline');
		expect(chatStore.currentChatState!.chat.activeLeafId).toBe('reply');
	});

	test('leaving the chat while a selection saves does not reopen it', async () => {
		addAlternative();
		const move = chatStore.navigateToLeaf('reply-2');
		chatStore.activeChatId = null;
		chatStore.currentChatState = null;
		await settle();
		writes[0].resolve();
		await move;
		expect(chatStore.currentChatState).toBeNull();
		expect(serverChat.activeLeafId).toBe('reply-2');
	});

	test('replacement streams keep the old response saved and clear their placement when they finish', () => {
		chatStore.startStream(CHAT.id, { replacingMessageId: 'reply' });
		chatStore.appendStreamingContent('New response');
		expect(chatStore.stream?.replacingMessageId).toBe('reply');
		expect(chatStore.stream?.content).toBe('New response');
		expect(chatStore.currentChatState!.activePath.at(-1)?.content).toBe('reply text');
		chatStore.endStream();
		expect(chatStore.stream).toBeNull();
	});
});

describe('overlapping transcript loads', () => {
	test('a delete that landed is not undone by a read that started before it', async () => {
		const { stale, current } = await overlap();

		owed[1].resolve({ rev: 6, full: false, upserts: [], deletedIds: ['reply'] });
		await current;
		expect(ids()).toEqual(['greeting', 'user']);

		owed[0].resolve(NOTHING_CHANGED);
		await stale;

		expect(chatStore.currentChatState!.messagesRev).toBe(6);
		expect(ids()).toEqual(['greeting', 'user']);
	});

	test('an edit that landed is not undone by a read that started before it', async () => {
		const { stale, current } = await overlap();

		owed[1].resolve({ rev: 6, full: false, upserts: [EDITED_USER], deletedIds: [] });
		await current;
		expect(userTurn()).toBe('rewritten');

		owed[0].resolve(NOTHING_CHANGED);
		await stale;

		expect(userTurn()).toBe('rewritten');
	});

	test('the branch being read is not moved back, though no message row changed', async () => {
		const stale = chatStore.loadChatState(CHAT.id);
		await settle();
		// A swipe: the chat row moves to another sibling and the rev does not move at all,
		// so nothing about the messages can tell these two reads apart.
		serverChat = { ...CHAT, activeLeafId: 'reply-2' };
		const current = chatStore.loadChatState(CHAT.id);
		await settle();

		owed[1].resolve({ rev: 5, full: false, upserts: [row('reply-2', 'user', 'assistant')], deletedIds: [] });
		await current;
		expect(chatStore.currentChatState!.chat.activeLeafId).toBe('reply-2');

		owed[0].resolve(NOTHING_CHANGED);
		await stale;

		expect(chatStore.currentChatState!.chat.activeLeafId).toBe('reply-2');
	});

	test('a read for a chat the reader has left publishes nothing', async () => {
		const stale = chatStore.loadChatState(CHAT.id);
		await settle();
		// goHome, or the chat deleted under a sync: both null the pair together.
		chatStore.activeChatId = null;
		chatStore.currentChatState = null;

		owed[0].resolve(NOTHING_CHANGED);
		await stale;

		expect(chatStore.currentChatState).toBeNull();
	});

	test('a load that stood down leaves the next read current, not stale', async () => {
		// The rows a prompt is built from are re-read per build, and that read is asked
		// against the rev the store holds, so standing down must not strand it behind.
		const { stale, current } = await overlap();
		owed[1].resolve({ rev: 6, full: false, upserts: [EDITED_USER], deletedIds: [] });
		await current;
		owed[0].resolve(NOTHING_CHANGED);
		await stale;

		const fresh = chatStore.freshMessages(CHAT.id);
		await settle();
		owed[2].resolve({ rev: 7, full: false, upserts: [], deletedIds: ['reply'] });

		expect((await fresh).find((m) => m.id === 'user')!.content).toBe('rewritten');
		expect(ids()).toEqual(['greeting', 'user']);
	});
});

/** Deleting the turn being read retreats the leaf on the server. Every step between that
 *  write and the next load is a frame, and an empty path draws as an empty chat. */
describe('a delete that takes the leaf', () => {
	const DELETED_REPLY: Delta = { rev: 6, full: false, upserts: [], deletedIds: ['reply'] };
	const pathIds = () => chatStore.currentChatState!.activePath.map((m) => m.id);

	test('a mid-delete refresh leaves the transcript alone, and the load moves it once', async () => {
		serverChat = { ...CHAT, activeLeafId: 'user' };

		const fresh = chatStore.freshMessages(CHAT.id);
		await settle();
		owed[0].resolve(DELETED_REPLY);
		expect((await fresh).map((m) => m.id)).toEqual(['greeting', 'user']);
		expect(pathIds()).toEqual(['greeting', 'user', 'reply']);
		expect(chatStore.currentChatState!.messagesRev).toBe(5);

		const load = chatStore.loadChatState(CHAT.id);
		await settle();
		owed[1].resolve(DELETED_REPLY);
		await load;
		expect(pathIds()).toEqual(['greeting', 'user']);
		expect(chatStore.currentChatState!.messagesRev).toBe(6);
	});

	test('a load draws its path from the chat row read with its rows', async () => {
		serverChat = { ...CHAT, activeLeafId: 'user' };
		chatReadApart = { ...CHAT };

		const load = chatStore.loadChatState(CHAT.id);
		await settle();
		owed[0].resolve(DELETED_REPLY);
		await load;

		expect(pathIds()).toEqual(['greeting', 'user']);
	});
});


describe('scene-memory publication', () => {
 test('a reactive wrapper around the published array does not prevent memory from loading', async () => {
  let release!: () => void;
  memoryGate = new Promise<void>((resolve) => { release = resolve; });
  const load = chatStore.loadChatState(CHAT.id);
  await settle();
  owed[0].resolve({rev:6,full:true,messages:[...BASE]});
  await load;
  const state = chatStore.currentChatState!;
  state.allMessages = new Proxy(state.allMessages, {});
  release(); await settle();
  expect(memoryLeaves).toEqual(['reply']);
 });
 test('a memory read finishing after a swipe cannot restore the previous path', async () => {
  let release!: () => void;
  memoryGate = new Promise<void>((resolve) => { release = resolve; });
  const load = chatStore.loadChatState(CHAT.id);
  await settle();
  owed[0].resolve({rev:6,full:true,messages:[...BASE,row('reply-2','user','assistant')]});
  await load;
  const move = chatStore.navigateToLeaf('reply-2');
  release(); await settle();
  expect(memoryLeaves).toEqual(['reply-2']);
  writes[0].resolve(); await move;
 });
});


describe('display-only streaming snapshots', () => {
	test('raw content and reasoning stay complete while the visual copy coalesces both channels', async () => {
		chatStore.startStream(CHAT.id, { replacingMessageId: 'reply' });
		try {
			for (let i=0;i<20;i++) { chatStore.appendStreamingContent('x'); chatStore.appendStreamingThinking('y'); }
			expect(chatStore.stream?.content).toBe('x'.repeat(20));expect(chatStore.stream?.thinking).toBe('y'.repeat(20));
			expect(chatStore.visibleStreamPreview?.content).toBe('');
			await new Promise(resolve=>setTimeout(resolve,70));
			expect(chatStore.visibleStreamPreview).toMatchObject({content:'x'.repeat(20),thinking:'y'.repeat(20),replacingMessageId:'reply'});
		} finally { chatStore.endStream(); }
	});
	test('a new generation cannot inherit a pending visual update from the previous one', async () => {
		chatStore.startStream(CHAT.id);chatStore.appendStreamingContent('old reply');
		chatStore.startStream(CHAT.id,{continuingMessageId:'reply'});
		try {
			await new Promise(resolve=>setTimeout(resolve,70));expect(chatStore.visibleStreamPreview?.content).toBe('');
			chatStore.appendStreamingContent('new continuation');await new Promise(resolve=>setTimeout(resolve,70));
			expect(chatStore.visibleStreamPreview).toMatchObject({content:'new continuation',continuingMessageId:'reply',replacingMessageId:null});
		} finally { chatStore.endStream(); }
	});
	test('ending or stopping before a paint interval preserves raw text and releases pending callbacks', async () => {
		chatStore.startStream(CHAT.id,{openingScene:true});chatStore.appendStreamingContent('short partial');chatStore.appendStreamingThinking('short thought');
		const received=chatStore.stream;chatStore.endStream();
		expect(received).toMatchObject({content:'short partial',thinking:'short thought',openingScene:true});
		await new Promise(resolve=>setTimeout(resolve,70));expect(chatStore.stream).toBeNull();expect(chatStore.visibleStreamPreview).toBeNull();
	});
	test('a stream remains owned by its chat when navigation changes during a queued paint', async () => {
		chatStore.startStream(CHAT.id);chatStore.appendStreamingContent('A reply');
		const original=chatStore.currentChatState!;
		try {
			chatStore.currentChatState={...original,chat:{...original.chat,id:'other-chat'}};
			await new Promise(resolve=>setTimeout(resolve,70));expect(chatStore.visibleStreamPreview).toBeNull();
			expect(chatStore.stream?.content).toBe('A reply');chatStore.currentChatState=original;
			expect(chatStore.visibleStreamPreview?.content).toBe('A reply');
		} finally { chatStore.currentChatState=original;chatStore.endStream(); }
	});
});
