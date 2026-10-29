import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ChatState, Message } from '#lib/types/chat.ts';
import type { BuiltPrompt, PromptBuildContext } from '#lib/utils/prompt-builder.ts';
import type { MemoryScene } from '#shared/memory-scenes.ts';
import { captureScene } from '#shared/memory-scenes.ts';

const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(yes => { resolve = yes; });
	return { promise, resolve };
}
const realDb = { ...await import('#lib/services/database.ts') };
const realChat = { ...await import('./chat.svelte') };
const realMemory = { ...await import('#lib/memory/scene-store.svelte.ts') };
const realBuilder = { ...await import('#lib/utils/prompt-builder.ts') };
const realHold = { ...await import('./promptHold.svelte') };
const realSteering = { ...await import('./steering.svelte') };
afterAll(() => {
	messageStore.generateResponse = originalGenerate;
	mock.module('#lib/services/database.ts', () => realDb);
	mock.module('#lib/stores/chat.svelte.ts', () => realChat);
	mock.module('#lib/memory/scene-store.svelte.ts', () => realMemory);
	mock.module('#lib/utils/prompt-builder.ts', () => realBuilder);
	mock.module('#lib/stores/promptHold.svelte.ts', () => realHold);
	mock.module('#lib/stores/steering.svelte.ts', () => realSteering);
});

const messages = [
	{ id: 'user', chatId: 'chat', parentId: null, role: 'user', content: 'A question', siblingIndex: 0 },
	{ id: 'reply', chatId: 'chat', parentId: 'user', role: 'assistant', content: 'A reply', siblingIndex: 0 }
] as Message[];
const state = (): ChatState => ({ chat: { id: 'chat', activeLeafId: 'reply' }, allMessages: messages, activePath: messages, messagesRev: 1 }) as ChatState;
type Snapshot = { chat: ChatState['chat']; messages: Message[]; rev: number };
let history: ReturnType<typeof deferred<Snapshot>>[] = [];
let memory: ReturnType<typeof deferred<MemoryScene[]>>[] = [];
let review = deferred<BuiltPrompt['messages'] | null>();
let contexts: PromptBuildContext[] = [];
let generated: unknown[][] = [];
const chat = {
	stream: null, visibleLiveElsewhere: null, currentChatState: state(),
	freshSnapshot: () => { const d = deferred<Snapshot>(); history.push(d); return d.promise; }
};
const built = { messages: [{ role: 'user', content: 'Reviewed prompt' }], target: {}, oneShotSteering: [] } as unknown as BuiltPrompt;
mock.module('#lib/services/database.ts', () => ({ ...realDb, db: {
	getMemoryScenes: () => { const d = deferred<MemoryScene[]>(); memory.push(d); return d.promise; }
} }));
mock.module('#lib/stores/chat.svelte.ts', () => ({ ...realChat, chatStore: chat }));
mock.module('#lib/memory/scene-store.svelte.ts', () => ({ ...realMemory, memoryStore: {
	loaded: true, activeChatId: 'chat', archivedMessageIds: new Set<string>()
} }));
mock.module('#lib/utils/prompt-builder.ts', () => ({ ...realBuilder,
	buildPromptMessages: async (context: PromptBuildContext) => { contexts.push(context); return built; }
}));
mock.module('#lib/stores/promptHold.svelte.ts', () => ({ ...realHold, promptHoldStore: {
	holding: false, review: () => review.promise
} }));
mock.module('#lib/stores/steering.svelte.ts', () => ({ ...realSteering, steeringStore: { flush: async () => {} } }));
const { messageStore } = await import('./messages.svelte');
const originalGenerate = messageStore.generateResponse;
messageStore.generateResponse = async (...args) => { generated.push(args); return 'generated'; };
beforeEach(() => { history = []; memory = []; contexts = []; generated = []; review = deferred(); chat.currentChatState = state(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function snapshot(extra: Partial<Snapshot> = {}): Snapshot { return { chat: { ...chat.currentChatState.chat }, messages, rev: 1, ...extra }; }
async function initial() {
	expect(history).toHaveLength(1);
	expect(memory).toHaveLength(1); // Both reads start before either result arrives.
	history[0].resolve(snapshot()); memory[0].resolve([]);
	await settle();
}

describe('swipe preparation snapshots', () => {
	test('reuses the initial fresh history/memory for assembly and rechecks once after review', async () => {
		const work = messageStore.retryMessageResponse('reply', 'branch');
		await initial();
		expect(contexts).toHaveLength(1);
		expect(contexts[0].chatMessages.map(m => m.id)).toEqual(['user']);
		expect(contexts[0].snapshot?.chat.activeLeafId).toBe('reply');
		expect(contexts[0].snapshot?.scenes).toEqual([]);
		expect(history).toHaveLength(1);
		review.resolve(built.messages); await settle();
		expect(history).toHaveLength(2); expect(memory).toHaveLength(2);
		expect(generated).toHaveLength(0);
		history[1].resolve(snapshot()); memory[1].resolve([]);
		await work;
		expect(generated).toHaveLength(1);
		expect(generated[0][3]).toMatchObject({ expectedLeafId: 'reply', replacingMessageId: 'reply' });
	});

	test('cancelled review starts no final reads or generation', async () => {
		const work = messageStore.retryMessageResponse('reply', 'branch');
		await initial(); review.resolve(null); await work;
		expect(history).toHaveLength(1); expect(memory).toHaveLength(1); expect(generated).toHaveLength(0);
	});

	for (const change of ['hidden', 'deleted', 'leaf changed', 'chat changed', 'new chapter']) {
		test(`a ${change} during review prevents the swipe from being sent`, async () => {
			const work = messageStore.retryMessageResponse('reply', 'branch');
			await initial(); review.resolve(built.messages); await settle();
			const next = snapshot();
			let scenes: MemoryScene[] = [];
			if (change === 'hidden') next.messages = [messages[0], { ...messages[1], excludedFromPrompt: true }];
			if (change === 'deleted') next.messages = [messages[0]];
			if (change === 'leaf changed') next.chat.activeLeafId = 'another reply';
			if (change === 'chat changed') chat.currentChatState = { ...state(), chat: { id: 'another chat' } } as ChatState;
			if (change === 'new chapter') scenes = [{ id: 'chapter', chatId: 'chat', title: 'New memory', content: 'Summary',
				source: captureScene(messages), createdAt: 1, updatedAt: 1, revision: 1, reviewReason: null }];
			history[1].resolve(next); memory[1].resolve(scenes);
			await work; expect(generated).toHaveLength(0);
		});
	}

	test('a remote leaf change detected initially stops before prompt preparation', async () => {
		const work = messageStore.retryMessageResponse('reply', 'branch');
		history[0].resolve(snapshot({ chat: { ...chat.currentChatState.chat, activeLeafId: 'another reply' } })); memory[0].resolve([]);
		await work;
		expect(contexts).toHaveLength(0); expect(generated).toHaveLength(0);
	});
});
