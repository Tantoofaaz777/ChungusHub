import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ChatState, Message } from '$lib/types/chat';
import { normalizeChatFeatureState } from '$lib/types/chat';
import type { ReminderCount } from '$lib/memory/reminders';

const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity, snapshot: structuredClone });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
const realDatabase = { ...await import('$lib/services/database') };
afterAll(() => { mock.module('$lib/services/database', () => realDatabase); });
let writes: { row: { id: string; featureState?: string | null }; options: unknown }[] = [];
let gate: Promise<void> | null = null;
let failure: Error | null = null;
mock.module('$lib/services/database', () => ({ ...realDatabase, db: { ...realDatabase.db,
	updateChat: async (row: { id: string; featureState?: string | null }, options?: unknown) => {
		writes.push({ row, options }); await gate; if (failure) throw failure;
	}
} }));
const { chatStore } = await import('./chat.svelte');
const store = new (chatStore.constructor as { new(): typeof chatStore })();
const path = [{ id: 'a', parentId: null, chatId: 'chat', role: 'assistant', content: 'Hello' }] as Message[];
const count: ReminderCount = { total: 20_000, prefix: [20_000], boundaryId: null };
beforeEach(() => {
	writes = []; gate = null; failure = null;
	store.currentChatState = { chat: { id: 'chat', updatedAt: 123, featureState: JSON.stringify({ persona: 'persona' }) },
		activePath: path, allMessages: path } as ChatState;
	store.chats = [store.currentChatState.chat];
});

describe('durable memory reminder acknowledgement', () => {
	test('two simultaneous checks claim one notification without changing recency or other features', async () => {
		const results = await Promise.all([
			store.claimMemoryReminder('chat', path, count, 20_000, () => true),
			store.claimMemoryReminder('chat', path, count, 20_000, () => true)
		]);
		expect(results).toEqual([true, false]);
		expect(writes).toHaveLength(1);
		expect(writes[0].row).not.toHaveProperty('updatedAt');
		expect(writes[0].options).toBeUndefined(); // updateChat's default preserves activity.
		expect(store.currentChatState?.chat.updatedAt).toBe(123);
		expect(store.featureState('chat').persona).toBe('persona');
		expect(normalizeChatFeatureState(store.chats[0].featureState).memoryReminder?.checkpoints).toHaveLength(1);
	});
	test('a queued author note save and reminder preserve each other', async () => {
		let release!: () => void;
		gate = new Promise(resolve => { release = resolve; });
		const note = store.updateChatFeatureState('chat', { authorsNote: { text: 'Keep this' } });
		const reminder = store.claimMemoryReminder('chat', path, count, 20_000, () => true);
		release(); await note; expect(await reminder).toBe(true);
		expect(store.featureState('chat')).toMatchObject({ authorsNote: { text: 'Keep this' }, persona: 'persona' });
		expect(store.featureState('chat').memoryReminder?.chatId).toBe('chat');
	});
	test('navigation or disabling reminders while waiting for a write prevents an obsolete claim', async () => {
		let current = true, release!: () => void;
		gate = new Promise(resolve => { release = resolve; });
		const note = store.updateChatFeatureState('chat', { authorsNote: { text: 'Keep this' } });
		const reminder = store.claimMemoryReminder('chat', path, count, 20_000, () => current);
		current = false; release(); await note;
		expect(await reminder).toBe(false);
		expect(writes).toHaveLength(1);
		expect(store.featureState('chat').memoryReminder).toBeUndefined();
	});
	test('a failed checkpoint remains eligible and the queue accepts a retry', async () => {
		failure = new Error('Offline');
		const error = await store.claimMemoryReminder('chat', path, count, 20_000, () => true).catch(error => error);
		expect(error).toEqual(failure);
		expect(store.featureState('chat').memoryReminder).toBeUndefined();
		failure = null;
		expect(await store.claimMemoryReminder('chat', path, count, 20_000, () => true)).toBe(true);
	});
});
