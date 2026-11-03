import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import type { ChatState, Message } from '#lib/types/chat.ts';
import type { ContinuationContext } from '#shared/conversation.ts';
import type { BuiltPrompt } from '#lib/utils/prompt-builder.ts';

const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
const realDb = { ...await import('#lib/services/database.ts') };
const realChat = { ...await import('./chat.svelte') };
const realBuilder = { ...await import('#lib/utils/prompt-builder.ts') };
const realHold = { ...await import('./promptHold.svelte') };
const realSteering = { ...await import('./steering.svelte') };
const realLlm = { ...await import('#lib/services/llm/provider.ts') };
const realToast = { ...await import('./toast.svelte') };
const realFeatures = { ...await import('./featurePrompts.svelte') };

const turns = [
	{ id: 'user', chatId: 'chat', parentId: null, role: 'user', content: 'Question', selectedVariantId: 'question-v', revision: 1 },
	{ id: 'reply', chatId: 'chat', parentId: 'user', role: 'assistant', content: 'Reply', selectedVariantId: 'reply-v', revision: 2,
		thinking: null, tokensCompletion: 2, generationMs: 1, reasoningMs: null }
] as Message[];
const state = () => ({ chat: { id: 'chat', activeLeafId: 'reply' }, activePath: turns, allMessages: turns, messagesRev: 2 }) as ChatState;
const expected: ContinuationContext = { chatId: 'chat', messageId: 'reply', variantId: 'reply-v', expectedRevision: 2, contextFingerprint: 'original-transcript' };
const built = { messages: [{ role: 'assistant', content: 'Reply' }], target: {}, continuationSent: 'Reply', oneShotSteering: [{ id: 'once', text: 'Guidance' }] } as unknown as BuiltPrompt;
let review = deferred<BuiltPrompt['messages'] | null>();
let generated = deferred<any>();
let appendWrite = deferred<any>();
let placementRevision = 2;
let validationFailure: Error | null = null;
let validated: ContinuationContext[] = [], sent: any[] = [], saved: any[] = [], errors: unknown[] = [];
let starts = 0, spent = 0, touches = 0, builds = 0;
let history: string[][] = [], appends: any[] = [];
const chat = {
	activeChatId: 'chat', currentChatState: state(), stream: null as unknown, visibleLiveElsewhere: null,
	freshSnapshot: async () => ({ chat: chat.currentChatState.chat, messages: turns, rev: 2 }),
	freshMessages: async () => turns,
	startStream: () => { starts++; chat.stream = {}; }, endStream: () => { chat.stream = null; },
	appendStreamingContent: () => {}, appendStreamingThinking: () => {}, refreshChat: async () => {},
	pushSteeringHistory: async (_chatId: string, texts: string[]) => { history.push(texts); }
};
mock.module('#lib/services/database.ts', () => ({ ...realDb, db: {
	getConversationPlacement: async () => ({ operation: 'append', expectedLeafId: 'reply', expectedVariantId: 'reply-v', expectedRevision: placementRevision, contextFingerprint: expected.contextFingerprint }),
	validateMessageContinuation: async (context: ContinuationContext) => { validated.push(context); if (validationFailure) throw validationFailure; },
	applyMessageContinuation: async (...args: unknown[]) => { saved.push(args); throw new Error('The client must not write continuations.'); },
	getNextSiblingIndex: async () => 0,
	appendConversationTurn: async (...args: unknown[]) => { appends.push(args); return appendWrite.promise; },
	touchChatActivity: async () => { touches++; }
} }));
mock.module('#lib/stores/chat.svelte.ts', () => ({ ...realChat, chatStore: chat }));
mock.module('#lib/utils/prompt-builder.ts', () => ({ ...realBuilder, buildPromptMessages: async () => { builds++; return built; } }));
mock.module('#lib/stores/promptHold.svelte.ts', () => ({ ...realHold, promptHoldStore: { holding: false, review: () => review.promise } }));
mock.module('#lib/stores/steering.svelte.ts', () => ({ ...realSteering, steeringStore: { flush: async () => {}, consumeById: async () => { spent++; return new Set(['once']); } } }));
mock.module('#lib/stores/featurePrompts.svelte.ts', () => ({ ...realFeatures, featurePromptsStore: { steeringEnabled: true } }));
mock.module('#lib/services/llm/provider.ts', () => ({ ...realLlm, llmService: { complete: async (_target: unknown, options: unknown) => { sent.push(options); return generated.promise; } } }));
mock.module('#lib/stores/toast.svelte.ts', () => ({ ...realToast, toastStore: { failed: (_action: string, error: unknown) => errors.push(error), warning: () => {} } }));
const { messageStore } = await import('./messages.svelte');
// Tokenizer loading is unrelated to persistence/context checks.
const calibration = (messageStore as any).recordCalibration;
(messageStore as any).recordCalibration = async () => {};
afterAll(() => {
	(messageStore as any).recordCalibration = calibration;
	mock.module('#lib/services/database.ts', () => realDb);
	mock.module('#lib/stores/chat.svelte.ts', () => realChat);
	mock.module('#lib/utils/prompt-builder.ts', () => realBuilder);
	mock.module('#lib/stores/promptHold.svelte.ts', () => realHold);
	mock.module('#lib/stores/steering.svelte.ts', () => realSteering);
	mock.module('#lib/services/llm/provider.ts', () => realLlm);
	mock.module('#lib/stores/toast.svelte.ts', () => realToast);
	mock.module('#lib/stores/featurePrompts.svelte.ts', () => realFeatures);
});
beforeEach(() => {
	review = deferred(); generated = deferred(); appendWrite = deferred(); placementRevision = 2; validationFailure = null;
	validated = []; sent = []; saved = []; errors = []; starts = 0; spent = 0; touches = 0; builds = 0;
	chat.activeChatId = 'chat'; chat.currentChatState = state(); chat.stream = null;
	history = []; appends = [];
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const completion = { content: 'Continued', thinking: 'Thought', model: 'test', usage: { promptTokens: 1, completionTokens: 2 }, finishReason: 'stop', reasoningMs: null, committedMessageId: 'reply', spentSteeringIds: ['once'] };

test('a context changed during review prevents streaming and the model request', async () => {
	const work = messageStore.continueMessage(); await settle();
	expect(builds).toBe(1); expect(sent).toHaveLength(0);
	validationFailure = new Error('Context changed'); review.resolve(built.messages); await work;
	expect(validated).toEqual([expected]); expect(starts).toBe(0); expect(sent).toHaveLength(0); expect(saved).toHaveLength(0);
	expect(errors).toEqual([validationFailure]);
});
test('a snapshot overtaken before context capture cannot build a mixed prompt', async () => {
	placementRevision = 3; await messageStore.continueMessage();
	expect(builds).toBe(0); expect(sent).toHaveLength(0); expect(errors).toHaveLength(1);
});
test('the reviewed context and steering reach the server, without any client continuation write', async () => {
	const work = messageStore.continueMessage(); await settle(); review.resolve(built.messages); await settle();
	expect(sent).toHaveLength(1); expect(sent[0].continuation).toEqual({ ...expected, continuationSent: 'Reply', spendSteeringIds: ['once'] }); expect(starts).toBe(1);
	generated.resolve(completion); await work;
	expect(saved).toEqual([]); expect(touches).toBe(0); expect(spent).toBe(0);
	expect(history).toEqual([['Guidance']]); expect(errors).toEqual([]); expect(chat.stream).toBeNull();
});
test('a commit conflict keeps its generated payload and does not consume steering', async () => {
	const work = messageStore.continueMessage(); await settle(); review.resolve(built.messages); await settle();
	const conflict = new Error('Saved for recovery'); generated.reject(conflict); await work;
	expect(saved).toEqual([]); expect(history).toEqual([]);
	expect(spent).toBe(0); expect(touches).toBe(0); expect(errors).toEqual([conflict]);
});
test('cancelling review or leaving the chat cannot dispatch a continuation', async () => {
	let work = messageStore.continueMessage(); await settle(); review.resolve(null); await work;
	expect(validated).toEqual([]); expect(sent).toEqual([]);
	review = deferred(); work = messageStore.continueMessage(); await settle(); chat.activeChatId = 'another'; review.resolve(built.messages); await work;
	expect(validated).toEqual([]); expect(sent).toEqual([]);
});

test('a send rejected by context conflict keeps its draft and attachments unreleased', async () => {
	chat.currentChatState.chat.conversationVersion = 2;
	let released = 0;
	const images = [{ kind: 'image' as const, path: 'images/chat/draft.png' }];
	const work = messageStore.sendMessage('Draft', images, () => { released++; });
	await settle(); review.resolve(built.messages); await settle();
	expect(appends).toHaveLength(1); expect(appends[0][0].attachments).toEqual(images);
	expect(released).toBe(0);
	appendWrite.reject(new Error('Context changed')); await work;
	expect(released).toBe(0); expect(sent).toEqual([]); expect(errors).toHaveLength(1);
});

test('a successful send releases the draft exactly once after its insert succeeds', async () => {
	chat.currentChatState.chat.conversationVersion = 2;
	let released = 0;
	const work = messageStore.sendMessage('Draft', undefined, () => { released++; });
	await settle(); review.resolve(built.messages); await settle(); expect(released).toBe(0);
	appendWrite.resolve({ expectedLeafId: 'new-turn' }); generated.resolve(completion); await work;
	expect(released).toBe(1); expect(errors).toEqual([]);
});
