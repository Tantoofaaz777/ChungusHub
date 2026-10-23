import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDatabaseFixture } from './test-fixtures';
import { normalizeReasoningRetention, parseReasoningRetention } from '../shared/reasoning-retention';

let root: string;
let db: typeof import('./db')['serverDb'];
beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), 'chungus-reasoning-retention-'));
	process.env.CHUNGUS_DATA_DIR = root;
	({ serverDb: db } = await import('./db'));
	db.closeForTests();
});
beforeEach(() => {
	process.env.CHUNGUS_DATA_DIR = root;
	db.setSetting('generalSettings', '{}');
});
afterAll(() => {
	db.closeForTests();
	removeDatabaseFixture(root, 'chungus-reasoning-retention-');
});

function policy(enabled: boolean, depth: number) {
	db.setSetting('generalSettings', JSON.stringify({ autoClearReasoning: enabled, reasoningDepth: depth }));
}
function chat(count = 6) {
	const id = crypto.randomUUID();
	db.insertChat({ id, title: 'Retention fixture', createdAt: 1, updatedAt: 1 });
	const ids: string[] = [];
	for (let i = 0; i < count; i++) {
		const messageId = crypto.randomUUID(); ids.push(messageId);
		db.insertMessage({ id: messageId, chatId: id, parentId: ids[i - 1] ?? null, role: i % 2 ? 'user' : 'assistant',
			content: `Story ${i}`, thinking: i % 2 ? null : `Thought ${i}`, reasoningMs: 17000,
			generationMs: 25000, tokensCompletion: 25, createdAt: i + 1, editedAt: 22, isBookmarked: true });
	}
	db.updateChat({ id, activeLeafId: ids.at(-1), rootMessageId: ids[0] });
	return { id, ids };
}
const messages = (id: string) => (db.getMessagesByChat(id) as Array<Record<string, any>>).sort((a, b) => a.createdAt - b.createdAt);

describe('automatic reasoning retention', () => {
	test('is opt-in and safely normalizes corrupt, legacy and out-of-range settings', () => {
		expect(parseReasoningRetention('{broken')).toEqual({ autoClearReasoning: false, reasoningDepth: 10 });
		expect(normalizeReasoningRetention({ autoClearReasoning: 'true', reasoningDepth: '2' })).toEqual({ autoClearReasoning: false, reasoningDepth: 10 });
		expect(normalizeReasoningRetention({ reasoningDepth: -3 }).reasoningDepth).toBe(0);
		expect(normalizeReasoningRetention({ reasoningDepth: 1e9 }).reasoningDepth).toBe(1000);
		expect(normalizeReasoningRetention({ reasoningDepth: 2.6 }).reasoningDepth).toBe(3);
		const fixture = chat();
		expect(messages(fixture.id).filter(m => m.thinking)).toHaveLength(3);
	});

	test('enabling prunes old reasoning immediately across chats, preserves story/stats and publishes message deltas', () => {
		const first = chat(), second = chat(3);
		const before = db.getMessagesDelta(first.id, null) as any;
		const original = messages(first.id);
		policy(true, 2);
		const after = messages(first.id);
		expect(after.map(m => m.thinking)).toEqual([null, null, null, null, 'Thought 4', null]);
		for (let i = 0; i < after.length; i++) {
			for (const key of ['content', 'reasoningMs', 'generationMs', 'tokensCompletion', 'editedAt', 'isBookmarked']) {
				expect(after[i][key]).toEqual(original[i][key]);
			}
		}
		expect(messages(second.id).map(m => m.thinking)).toEqual([null, null, 'Thought 2']);
		const delta = db.getMessagesDelta(first.id, before.rev) as any;
		expect(delta.upserts.map((m: any) => m.id).sort()).toEqual([first.ids[0], first.ids[2]].sort());
		const rev = delta.rev;
		db.setSetting('generalSettings', JSON.stringify({ autoClearReasoning: true, reasoningDepth: 2, welcomeSeen: true }));
		expect((db.getMessagesDelta(first.id, rev) as any).rev).toBe(rev);
	});

	test('swipes share depth and old alternatives are also cleared', () => {
		const fixture = chat(5);
		const recentSwipe = crypto.randomUUID(), oldSwipe = crypto.randomUUID();
		for (const [id, parentId] of [[recentSwipe, fixture.ids[3]], [oldSwipe, fixture.ids[1]]]) {
			db.insertMessage({ id, chatId: fixture.id, parentId, role: 'assistant', content: 'Alternative', thinking: 'Alternative thought', createdAt: Date.now() });
		}
		policy(true, 2);
		expect((db.getMessage(recentSwipe) as any).thinking).toBe('Alternative thought');
		expect((db.getMessage(oldSwipe) as any).thinking).toBeNull();
		db.updateChatActiveLeaf(fixture.id, recentSwipe);
		expect((db.getMessage(fixture.ids[4]) as any).thinking).toBe('Thought 4');
	});

	test('a server-committed reply ages reasoning with no client cleanup call', () => {
		const fixture = chat(4);
		policy(true, 2);
		expect((db.getMessage(fixture.ids[2]) as any).thinking).toBe('Thought 2');
		const result = db.commitGeneratedTurn({ chatId: fixture.id, parentId: fixture.ids[3], expectedLeafId: fixture.ids[3], claimsRoot: false,
			content: 'New story', thinking: 'New thought', model: 'fixture', provider: 'fixture', tokensPrompt: 100, tokensCompletion: 20,
			finishReason: 'stop', generationMs: 20000, firstTokenMs: 1000, reasoningMs: 15000, lorebook: null, spendSteeringIds: [] });
		expect(result).not.toBeNull();
		expect((db.getMessage(fixture.ids[2]) as any).thinking).toBeNull();
		expect((db.getMessage(result!.messageId) as any).thinking).toBe('New thought');
	});

	test('depth zero clears completed generations and continuations, without changing their output', () => {
		const fixture = chat(3);
		policy(true, 0);
		expect(messages(fixture.id).every(m => m.thinking === null)).toBe(true);
		db.applyMessageContinuation(fixture.ids[2], { content: 'Extended story', thinking: 'New continued thought', tokensPrompt: 10,
			tokensCompletion: 20, finishReason: 'stop', generationMs: 30000, reasoningMs: 20000 });
		expect((db.getMessage(fixture.ids[2]) as any).thinking).toBeNull();
		expect((db.getMessage(fixture.ids[2]) as any).content).toBe('Extended story');
	});

	test('disabling stops future cleanup and raising depth does not invent deleted reasoning', () => {
		const fixture = chat(3);
		policy(true, 0);
		policy(true, 100);
		expect(messages(fixture.id).every(m => m.thinking === null)).toBe(true);
		policy(false, 0);
		db.applyMessageContinuation(fixture.ids[2], { content: 'Extended story', thinking: 'Kept', tokensPrompt: 10,
			tokensCompletion: 20, finishReason: 'stop', generationMs: 30000, reasoningMs: 20000 });
		expect((db.getMessage(fixture.ids[2]) as any).thinking).toBe('Kept');
	});
});
