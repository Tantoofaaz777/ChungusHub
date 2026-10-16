/**
 * `commitGeneratedTurn`, against the REAL server database (bun:sqlite).
 *
 * This is the method that writes a story turn now that a generation outlives the page that
 * asked for it (architecture/server-core.md), so everything the client used to decide a
 * paragraph at a time it decides inside one transaction instead. Each case here is a
 * situation the client could not reach, because the composer was locked for the length of a
 * generation, and can now: the reader reloads, walks to another branch, deletes the chat, or
 * edits the guidance while the model is still writing.
 *
 * Same env dance as chatList.test.ts: CHUNGUS_DATA_DIR is pinned to a throwaway dir before
 * the first db call, so no test can silently write into the real user-data.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let serverDb: any;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-committurn-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb } = await import('./db'));
	// One handle per process, bound on first use (see server/db.ts). Release whatever an
	// earlier file left open so this file's first db call binds to the dir above.
	serverDb.closeForTests();
});

afterAll(() => {
	// Release before deleting: statements against an unlinked file fail for the rest of the run.
	serverDb.closeForTests();
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

let clock = 1_700_000_000_000;

function makeChat(): string {
	const id = crypto.randomUUID();
	serverDb.insertChat({
		id,
		title: 'A story',
		createdAt: (clock += 1000),
		updatedAt: clock,
		rootMessageId: null,
		activeLeafId: null,
		canonLeafId: null,
		settings: null,
		characterId: null,
		characterVersionId: null
	});
	return id;
}

function addMessage(chatId: string, parentId: string | null, role: string, siblingIndex = 0): string {
	const id = crypto.randomUUID();
	serverDb.insertMessage({
		id,
		chatId,
		parentId,
		role,
		content: 'a line',
		createdAt: (clock += 1000),
		siblingIndex
	});
	return id;
}

function addSteeringNote(chatId: string, mode: 'once' | 'pinned'): string {
	const id = crypto.randomUUID();
	serverDb.insertSteeringNote({
		id,
		scope: 'chat',
		scopeId: chatId,
		title: null,
		text: 'keep it terse',
		enabled: true,
		mode,
		depth: null,
		role: null,
		createdAt: (clock += 1000),
		updatedAt: clock
	});
	return id;
}

/** A commit with the boring fields filled in, so each test states only what it is about. */
function commit(over: Record<string, unknown>): Record<string, unknown> {
	return {
		parentId: null,
		expectedLeafId: null,
		claimsRoot: false,
		content: 'The reply.',
		thinking: null,
		model: 'scripted',
		provider: 'openai-compatible',
		tokensPrompt: 10,
		tokensCompletion: 4,
		finishReason: 'stop',
		generationMs: 1200,
		firstTokenMs: 300,
		reasoningMs: null,
		lorebook: null,
		spendSteeringIds: [],
		...over
	};
}

describe('commitGeneratedTurn (architecture/server-core.md, the generation map)', () => {
	test('lands the reply under its parent and moves the leaf onto it', () => {
		const chatId = makeChat();
		const userTurn = addMessage(chatId, null, 'user');
		serverDb.updateChatActiveLeaf(chatId, userTurn);

		const landed = serverDb.commitGeneratedTurn(
			commit({ chatId, parentId: userTurn, expectedLeafId: userTurn, content: 'Hello there.' })
		);

		expect(landed.messageId).toBeTruthy();
		const row = serverDb.getMessage(landed.messageId);
		expect(row.content).toBe('Hello there.');
		expect(row.parentId).toBe(userTurn);
		expect(row.role).toBe('assistant');
		expect(row.generationMs).toBe(1200);
		expect(row.firstTokenMs).toBe(300);
		expect(serverDb.getChat(chatId).activeLeafId).toBe(landed.messageId);
	});

	test('a reader who walked to another branch is left there: the row lands, the leaf does not move', () => {
		const chatId = makeChat();
		const userTurn = addMessage(chatId, null, 'user');
		serverDb.updateChatActiveLeaf(chatId, userTurn);
		// The generation is under way. Meanwhile the reader goes somewhere else.
		const elsewhere = addMessage(chatId, null, 'assistant', 1);
		serverDb.updateChatActiveLeaf(chatId, elsewhere);

		const landed = serverDb.commitGeneratedTurn(
			commit({ chatId, parentId: userTurn, expectedLeafId: userTurn })
		);

		expect(serverDb.getMessage(landed.messageId)).toBeTruthy();
		expect(serverDb.getChat(chatId).activeLeafId).toBe(elsewhere);
	});

	test('a chat deleted while the model was writing lands nothing and is not an error', () => {
		const chatId = makeChat();
		const userTurn = addMessage(chatId, null, 'user');
		serverDb.deleteChat(chatId);

		expect(serverDb.commitGeneratedTurn(commit({ chatId, parentId: userTurn, expectedLeafId: userTurn }))).toBeNull();
	});

	test('a parent deleted while the model was writing is a loud failure, not a stray root', () => {
		const chatId = makeChat();
		const userTurn = addMessage(chatId, null, 'user');
		serverDb.deleteMessageAndDescendants(userTurn);

		expect(() =>
			serverDb.commitGeneratedTurn(commit({ chatId, parentId: userTurn, expectedLeafId: userTurn }))
		).toThrow(/nowhere to hang/);
		// And nothing half-written was left behind by the attempt.
		expect(serverDb.getMessagesByChat(chatId)).toHaveLength(0);
	});

	test('an opening scene claims the root only when the chat holds none', () => {
		const empty = makeChat();
		const first = serverDb.commitGeneratedTurn(commit({ chatId: empty, claimsRoot: true }));
		expect(serverDb.getChat(empty).rootMessageId).toBe(first.messageId);

		// A second opening is a root SIBLING: it must not renumber which root is the first one.
		const second = serverDb.commitGeneratedTurn(
			commit({ chatId: empty, claimsRoot: true, expectedLeafId: first.messageId })
		);
		expect(serverDb.getChat(empty).rootMessageId).toBe(first.messageId);
		expect(serverDb.getMessage(second.messageId).siblingIndex).toBe(1);
		expect(serverDb.getChat(empty).activeLeafId).toBe(second.messageId);
	});

	test('the one-shot notes that rode the turn are spent in the same transaction', () => {
		const chatId = makeChat();
		const once = addSteeringNote(chatId, 'once');

		const landed = serverDb.commitGeneratedTurn(commit({ chatId, spendSteeringIds: [once] }));

		expect(landed.spentSteeringIds).toEqual([once]);
		expect(serverDb.getAllSteeringNotes().some((n: { id: string }) => n.id === once)).toBe(false);
	});

	test('a note made permanent while the model was writing is not deleted out from under its author', () => {
		const chatId = makeChat();
		const note = addSteeringNote(chatId, 'once');
		const stored = serverDb.getAllSteeringNotes().find((n: { id: string }) => n.id === note);
		serverDb.updateSteeringNote({ ...stored, mode: 'pinned' });

		const landed = serverDb.commitGeneratedTurn(commit({ chatId, spendSteeringIds: [note] }));

		// Not merely "nothing was spent": the id is absent, which is what stops the caller
		// listing it under Recent as though it had been consumed.
		expect(landed.spentSteeringIds).toEqual([]);
		expect(serverDb.getAllSteeringNotes().some((n: { id: string }) => n.id === note)).toBe(true);
	});
});

describe('replacing response swipes', () => {
	test('commits a replacement and removes every named alternative and its continuation together', () => {
		const chatId = makeChat();
		const user = addMessage(chatId, null, 'user');
		const a = addMessage(chatId, user, 'assistant', 0);
		const b = addMessage(chatId, user, 'assistant', 1);
		const continuation = addMessage(chatId, b, 'user');
		serverDb.updateChatActiveLeaf(chatId, a);
		serverDb.updateChat({ id: chatId, canonLeafId: continuation });
		const result = serverDb.commitGeneratedTurn(commit({ chatId, parentId: user, expectedLeafId: a, replaceMessageIds: [a, b] }));
		expect(serverDb.getMessagesByChat(chatId).map((m: { id: string }) => m.id).sort()).toEqual([user, result.messageId].sort());
		expect(serverDb.getChat(chatId).activeLeafId).toBe(result.messageId);
		expect(serverDb.getMessage(a)).toBeNull();
		expect(serverDb.getMessage(b)).toBeNull();
		expect(serverDb.getMessage(continuation)).toBeNull();
		expect(serverDb.getChat(chatId).canonLeafId).not.toBe(continuation);
	});
	test('canceling even after tokens arrived, or receiving empty text, preserves all swipes', () => {
		for (const fields of [{ finishReason: 'cancelled', content: 'partial reply' }, { content: '  ' }]) {
			const chatId = makeChat();
			const parent = addMessage(chatId, null, 'user');
			const a = addMessage(chatId, parent, 'assistant');
			const b = addMessage(chatId, parent, 'assistant', 1);
			serverDb.updateChatActiveLeaf(chatId, a);
			expect(serverDb.commitGeneratedTurn(commit({ chatId, parentId: parent, expectedLeafId: a, replaceMessageIds: [a, b], ...fields }))).toBeNull();
			expect(serverDb.getMessagesByChat(chatId)).toHaveLength(3);
			expect(serverDb.getChat(chatId).activeLeafId).toBe(a);
		}
	});
	test('refuses a replacement targeting another turn or chat without writing anything', () => {
		const chatId = makeChat();
		const parent = addMessage(chatId, null, 'user');
		const original = addMessage(chatId, parent, 'assistant');
		const anotherChat = makeChat();
		const foreign = addMessage(anotherChat, null, 'assistant');
		for (const badId of [parent, foreign]) {
			expect(() => serverDb.commitGeneratedTurn(commit({ chatId, parentId: parent, replaceMessageIds: [original, badId] }))).toThrow(/alternatives/);
			expect(serverDb.getMessagesByChat(chatId)).toHaveLength(2);
			expect(serverDb.getMessage(foreign)).not.toBeNull();
		}
	});
	test('replacing opening swipes repairs the root and leaves one new opening', () => {
		const chatId = makeChat();
		const first = serverDb.commitGeneratedTurn(commit({ chatId, claimsRoot: true }));
		const second = serverDb.commitGeneratedTurn(commit({ chatId, claimsRoot: true, expectedLeafId: first.messageId }));
		const next = serverDb.commitGeneratedTurn(commit({ chatId, claimsRoot: true, expectedLeafId: second.messageId,
			replaceMessageIds: [first.messageId, second.messageId] }));
		expect(serverDb.getMessagesByChat(chatId)).toHaveLength(1);
		expect(serverDb.getChat(chatId).rootMessageId).toBe(next.messageId);
		expect(serverDb.getChat(chatId).activeLeafId).toBe(next.messageId);
	});
	test('keeps an alternative created after the request snapshot', () => {
		const chatId = makeChat();
		const parent = addMessage(chatId, null, 'user');
		const old = addMessage(chatId, parent, 'assistant');
		const newer = addMessage(chatId, parent, 'assistant', 1);
		serverDb.commitGeneratedTurn(commit({ chatId, parentId: parent, replaceMessageIds: [old] }));
		expect(serverDb.getMessage(newer)).not.toBeNull();
	});
});
