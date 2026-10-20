/**
 * Chat-list aggregates + chat duplication, against the REAL server database
 * (bun:sqlite). These are the pieces of the chats panel that can't be checked by
 * reading the code: a recursive walk up the active branch, a structural fingerprint
 * that must survive an id remap, a search fold that lives half in SQL and half in JS,
 * and a deep copy whose whole job is to leave no reference pointing at the original.
 *
 * Same env dance as promptLog.test.ts: CHUNGUS_DATA_DIR is pinned to a throwaway dir
 * before the first db call, so no test can silently write into the real user-data.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let serverDb: any;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-chatlist-'));
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

function makeChat(overrides: Record<string, unknown> = {}): string {
	const id = crypto.randomUUID();
	serverDb.insertChat({
		id,
		title: 'Test chat',
		createdAt: clock,
		updatedAt: clock,
		rootMessageId: null,
		activeLeafId: null,
		canonLeafId: null,
		settings: null,
		characterId: null,
		characterVersionId: null,
		...overrides
	});
	return id;
}

function addMessage(chatId: string, parentId: string | null, role: string, content: string, siblingIndex = 0): string {
	const id = crypto.randomUUID();
	serverDb.insertMessage({
		id,
		chatId,
		parentId,
		role,
		content,
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
	return id;
}

/** greeting + alternate greeting, one exchange, and one off-path swipe on the reply.
 *  The tail carries the title by default so chats from different tests can't collide
 *  in the fingerprint groups. The twin tests pass one tail on purpose instead. */
function seedBranchedChat(title: string, tail = `The door opened. (${title})`): { chatId: string; ids: Record<string, string> } {
	const chatId = makeChat({ title });
	const greeting = addMessage(chatId, null, 'assistant', 'Hello there.', 0);
	const altGreeting = addMessage(chatId, null, 'assistant', 'Or, hello over here.', 1);
	const user = addMessage(chatId, greeting, 'user', 'I knock on the door.', 0);
	const reply = addMessage(chatId, user, 'assistant', tail, 0);
	const swipe = addMessage(chatId, user, 'assistant', 'Nothing happens at all.', 1);
	serverDb.updateChat({ id: chatId, rootMessageId: greeting, activeLeafId: reply });
	return { chatId, ids: { greeting, altGreeting, user, reply, swipe } };
}

describe('getChatListStats', () => {
	test('separates the active branch from the whole tree, and times it off the leaf', () => {
		const { chatId, ids } = seedBranchedChat('Stats chat', 'The door opened.');
		const stats = serverDb.getChatListStats()[chatId];
		const leaf = (serverDb.getMessagesByChat(chatId) as any[]).find((m) => m.id === ids.reply);

		// 5 rows exist; the branch you'd actually read is greeting -> user -> reply.
		expect(stats.total).toBe(5);
		expect(stats.path).toBe(3);
		// The leaf's own time, not the newest row in the chat: the off-path swipe was
		// written after it and must not become this branch's "last activity".
		expect(stats.lastAt).toBe(leaf.createdAt);
	});

	test('a chat with no messages simply has no entry', () => {
		const chatId = makeChat({ title: 'Empty' });
		expect(serverDb.getChatListStats()[chatId]).toBeUndefined();
	});
});

describe('getChatContentGroups', () => {
	test('groups chats whose trees are identical and leaves unique ones alone', () => {
		const a = seedBranchedChat('Twin A', 'The door opened.').chatId;
		const b = seedBranchedChat('Twin B', 'The door opened.').chatId;
		const different = seedBranchedChat('Not a twin', 'The door stayed shut.').chatId;

		const groups = serverDb.getChatContentGroups();
		expect(groups[a]).toBeDefined();
		expect(groups[a]).toBe(groups[b]);
		expect(groups[different]).toBeUndefined();
	});

	test('a duplicate is recognized as identical to its source', () => {
		const { chatId } = seedBranchedChat('Original');
		const copyId = serverDb.duplicateChat({ chatId, title: 'Original (copy)', includeMemory: false });

		const groups = serverDb.getChatContentGroups();
		expect(groups[copyId]).toBe(groups[chatId]);
	});

	test('one changed character breaks the group', () => {
		const { chatId, ids } = seedBranchedChat('Edited soon');
		const copyId = serverDb.duplicateChat({ chatId, title: 'Edited soon (copy)', includeMemory: false });
		expect(serverDb.getChatContentGroups()[copyId]).toBe(serverDb.getChatContentGroups()[chatId]);

		serverDb.updateMessageContent(ids.reply, 'The door opened!');
		const groups = serverDb.getChatContentGroups();
		expect(groups[chatId]).toBeUndefined();
		expect(groups[copyId]).toBeUndefined();
	});
});

describe('searchChatMessages', () => {
	test('folds the dotted/dotless i so those words match either way', () => {
		const chatId = makeChat({ title: 'Dotted i' });
		const root = addMessage(chatId, null, 'assistant', 'KAPI gıcırdayarak açıldı.', 0);
		serverDb.updateChat({ id: chatId, rootMessageId: root, activeLeafId: root });

		expect(serverDb.searchChatMessages('kapı')[chatId]?.hits).toBe(1);
		expect(serverDb.searchChatMessages('KAPI')[chatId]?.hits).toBe(1);
		expect(serverDb.searchChatMessages('kapi')[chatId]?.hits).toBe(1);
	});

	test('folds the other non-ASCII letters past SQLite ASCII-only LOWER()', () => {
		const chatId = makeChat({ title: 'Sentence case' });
		const root = addMessage(chatId, null, 'assistant', 'Şey, Çok Güzel bir gündü.', 0);
		serverDb.updateChat({ id: chatId, rootMessageId: root, activeLeafId: root });

		expect(serverDb.searchChatMessages('şey')[chatId]?.hits).toBe(1);
		expect(serverDb.searchChatMessages('çok güzel')[chatId]?.hits).toBe(1);
	});

	test('every term must be present, in any order', () => {
		const chatId = makeChat({ title: 'Terms' });
		const root = addMessage(chatId, null, 'assistant', 'a dragon guards the bridge', 0);
		serverDb.updateChat({ id: chatId, rootMessageId: root, activeLeafId: root });

		expect(serverDb.searchChatMessages('bridge dragon')[chatId]?.hits).toBe(1);
		expect(serverDb.searchChatMessages('dragon castle')[chatId]).toBeUndefined();
	});

	test('off-path branches are not searched', () => {
		const { chatId } = seedBranchedChat('Off path');
		// "Nothing happens at all" lives on the unplayed swipe.
		expect(serverDb.searchChatMessages('nothing happens')[chatId]).toBeUndefined();
		expect(serverDb.searchChatMessages('door opened')[chatId]?.hits).toBe(1);
	});

	test('the snippet is cut from the original text around the hit', () => {
		const chatId = makeChat({ title: 'Snippet' });
		const root = addMessage(chatId, null, 'assistant', `${'x'.repeat(300)} TREASURE ${'y'.repeat(300)}`, 0);
		serverDb.updateChat({ id: chatId, rootMessageId: root, activeLeafId: root });

		const snippet = serverDb.searchChatMessages('treasure')[chatId].snippet;
		expect(snippet).toContain('TREASURE');
		expect(snippet.startsWith('…')).toBe(true);
		expect(snippet.endsWith('…')).toBe(true);
	});
});

describe('duplicateChat', () => {
	test('branch selection refuses deleted messages and messages belonging to another chat', () => {
		const chatId = makeChat({ title: 'Navigation' });
		const otherChat = makeChat({ title: 'Other story' });
		const id = crypto.randomUUID();
		serverDb.insertMessage({ id, chatId: otherChat, parentId: null, role: 'assistant', content: 'Other story', createdAt: Date.now() });
		expect(() => serverDb.updateChatActiveLeaf(chatId, 'deleted')).toThrow();
		expect(() => serverDb.updateChatActiveLeaf(chatId, id)).toThrow();
		expect(serverDb.getChat(chatId).activeLeafId).toBeNull();
	});
	test('legacy branch labels and canon pointers survive loading and duplication after map retirement', () => {
		const chatId = makeChat({ title: 'Legacy story' });
		const id = crypto.randomUUID();
		const label = { name: 'Old fork', color: 'amber' };
		serverDb.insertMessage({ id, chatId, parentId: null, role: 'assistant', content: 'An older beginning.',
			createdAt: Date.now(), siblingIndex: 0, branchLabel: label });
		serverDb.updateChat({ id: chatId, rootMessageId: id, activeLeafId: id, canonLeafId: id });
		expect(serverDb.getMessage(id).branchLabel).toEqual(label);
		const copyId = serverDb.duplicateChat({ chatId, title: 'Legacy copy', includeMemory: false });
		const copied = serverDb.getMessagesByChat(copyId);
		expect(copied).toHaveLength(1);
		expect(copied[0].branchLabel).toEqual(label);
		expect(serverDb.getChat(copyId).canonLeafId).toBe(copied[0].id);
		expect(serverDb.getChat(chatId).canonLeafId).toBe(id);
	});

	test('copies the whole forest with fresh ids and remapped pointers', () => {
		const { chatId, ids } = seedBranchedChat('Source');
		const featureState = JSON.stringify({ authorsNote: { text: 'Keep the mystery.', enabled: false }, steeringHistory: ['Earlier guidance'] });
		serverDb.updateChat({ id: chatId, canonLeafId: ids.reply, featureState });
		serverDb.updateChatFavorite(chatId, true);

		const copyId = serverDb.duplicateChat({ chatId, title: 'Source (copy)', includeMemory: false });
		const copy = serverDb.getChat(copyId) as any;
		const original = serverDb.getMessagesByChat(chatId) as any[];
		const copied = serverDb.getMessagesByChat(copyId) as any[];

		expect(copied.length).toBe(original.length);
		// Not one id survives the copy, and no pointer still aims at the original.
		const originalIds = new Set(original.map((m) => m.id));
		expect(copied.some((m) => originalIds.has(m.id))).toBe(false);
		expect(originalIds.has(copy.rootMessageId)).toBe(false);
		expect(originalIds.has(copy.activeLeafId)).toBe(false);
		expect(originalIds.has(copy.canonLeafId)).toBe(false);

		// Same shape: the leaf still sits three deep on a five-row tree.
		const stats = serverDb.getChatListStats()[copyId];
		expect(stats.total).toBe(5);
		expect(stats.path).toBe(3);

		// Story state rides along; the star and the title do not.
		expect(copy.featureState).toBe(featureState);
		expect(copy.isFavorite).toBe(false);
		expect(copy.title).toBe('Source (copy)');
	});

	test("carries the chat's own steering notes under fresh ids, and nobody else's", () => {
		const { chatId } = seedBranchedChat('Steered');
		const other = makeChat({ title: 'Another story' });
		const note = (over: Record<string, unknown>) => ({
			id: crypto.randomUUID(),
			title: '',
			text: 'guidance',
			enabled: true,
			mode: 'pinned',
			depth: null,
			role: null,
			createdAt: clock,
			updatedAt: clock,
			...over
		});
		serverDb.insertSteeringNote(note({ scope: 'chat', scopeId: chatId, text: 'Mine.' }));
		serverDb.insertSteeringNote(note({ scope: 'chat', scopeId: other, text: "Someone else's." }));
		// Broader scopes already reach the copy through their own binding; copying them
		// would double-inject.
		serverDb.insertSteeringNote(note({ scope: 'global', scopeId: null, text: 'House style.' }));

		const copyId = serverDb.duplicateChat({ chatId, title: 'Steered (copy)', includeMemory: false });
		const notes = serverDb.getAllSteeringNotes() as any[];
		const copied = notes.filter((n) => n.scope === 'chat' && n.scopeId === copyId);

		expect(copied.length).toBe(1);
		expect(copied[0].text).toBe('Mine.');
		expect(notes.filter((n) => n.text === 'Mine.').length).toBe(2);
		expect(notes.filter((n) => n.scope === 'global').length).toBe(1);
		// The source keeps its own note, and the copy's is a different row.
		expect(copied[0].id).not.toBe(notes.find((n) => n.scopeId === chatId)!.id);
	});

	test('deleting a chat reaps its steering notes, since scope_id cannot cascade', () => {
		const chatId = makeChat({ title: 'Doomed' });
		const keep = makeChat({ title: 'Survivor' });
		const mk = (scope: string, scopeId: string | null, text: string) =>
			serverDb.insertSteeringNote({
				id: crypto.randomUUID(),
				title: '',
				text,
				scope,
				scopeId,
				enabled: true,
				mode: 'pinned',
				depth: null,
				role: null,
				createdAt: clock,
				updatedAt: clock
			});
		mk('chat', chatId, 'dies with it');
		mk('chat', keep, 'survives');
		mk('global', null, 'untouched');

		serverDb.deleteChat(chatId);
		const texts = (serverDb.getAllSteeringNotes() as any[]).map((n) => n.text);
		expect(texts).not.toContain('dies with it');
		expect(texts).toContain('survives');
		expect(texts).toContain('untouched');
	});

	test('leaves the source untouched', () => {
		const { chatId } = seedBranchedChat('Untouched');
		const before = serverDb.getMessagesByChat(chatId) as any[];
		serverDb.duplicateChat({ chatId, title: 'copy', includeMemory: false });
		const after = serverDb.getMessagesByChat(chatId) as any[];

		expect(after.length).toBe(before.length);
		expect(after.map((m) => m.id).sort()).toEqual(before.map((m) => m.id).sort());
	});

	test('skips memory unless asked', () => {
		const { chatId, ids } = seedBranchedChat('No memory wanted');
		serverDb.memSetState(chatId, { enabled: true });
		serverDb.memApplyBatch(chatId, {
			supersedeEpisodeIds: [],
			episode: { content: 'They knocked.', sourceMessageIds: [ids.user, ids.reply], anchorMessageId: ids.reply }
		});

		const copyId = serverDb.duplicateChat({ chatId, title: 'copy', includeMemory: false });
		expect(serverDb.memGetState(copyId)).toBeNull();
		expect((serverDb.memListEpisodes(copyId) as any[]).length).toBe(0);
	});

	test('carries memory over with every message reference remapped', () => {
		const { chatId, ids } = seedBranchedChat('With memory');
		serverDb.memSetState(chatId, { enabled: true });
		serverDb.memApplyBatch(chatId, {
			supersedeEpisodeIds: [],
			episode: {
				content: 'They knocked and the door opened.',
				sourceMessageIds: [ids.user, ids.reply],
				anchorMessageId: ids.reply
			}
		});

		const copyId = serverDb.duplicateChat({ chatId, title: 'copy', includeMemory: true });
		const copiedIds = new Set((serverDb.getMessagesByChat(copyId) as any[]).map((m) => m.id));
		const sourceIds = new Set(Object.values(ids));

		const state = serverDb.memGetState(copyId) as any;
		expect(state.enabled).toBe(true);
		// No cursor to remap any more: the archive boundary is derived from the copied
		// episodes' own coverage, so remapping their message ids is the whole job.
		expect(state.cursorMessageId).toBeUndefined();

		const episodes = serverDb.memListEpisodes(copyId) as any[];
		expect(episodes.length).toBe(1);
		expect(episodes[0].sourceMessageIds.length).toBe(2);
		expect(episodes[0].sourceMessageIds.every((id: string) => copiedIds.has(id))).toBe(true);
		expect(episodes[0].sourceMessageIds.every((id: string) => !sourceIds.has(id))).toBe(true);
		expect(copiedIds.has(episodes[0].anchorMessageId)).toBe(true);

		// The source keeps its own memory, pointing at its own rows.
		expect((serverDb.memListEpisodes(chatId) as any[]).length).toBe(1);
	});

	test('carries a merged ladder over, not only layer-0 summaries', () => {
		// A merged episode used to record the ids of the episodes it replaced, which the same
		// transaction deletes, so they were dangling on arrival and nothing ever read them. The
		// copy put them through the fail-loud message remap anyway, so any chat long enough to
		// have promoted once could not be duplicated at all: the throw rolled the whole copy
		// back, story included, behind a toast advising a repair that could never happen.
		const { chatId, ids } = seedBranchedChat('Promoted');
		serverDb.memSetState(chatId, { enabled: true });
		serverDb.memApplyBatch(chatId, {
			supersedeEpisodeIds: [],
			episode: { content: 'They knocked.', sourceMessageIds: [ids.user], anchorMessageId: ids.user }
		});
		serverDb.memApplyBatch(chatId, {
			supersedeEpisodeIds: [],
			episode: { content: 'The door opened.', sourceMessageIds: [ids.reply], anchorMessageId: ids.reply }
		});
		const merged = (serverDb.memListEpisodes(chatId) as any[]).map((e) => e.id);
		serverDb.memApplyPromotion(chatId, {
			insert: {
				layer: 1,
				content: 'They knocked and it opened.',
				sourceMessageIds: [ids.user, ids.reply],
				anchorMessageId: ids.reply
			},
			deleteEpisodeIds: merged
		});

		const copyId = serverDb.duplicateChat({ chatId, title: 'Promoted (copy)', includeMemory: true });
		const copiedIds = new Set((serverDb.getMessagesByChat(copyId) as any[]).map((m) => m.id));
		const episodes = serverDb.memListEpisodes(copyId) as any[];

		expect(episodes.length).toBe(1);
		expect(episodes[0].layer).toBe(1);
		expect(episodes[0].sourceMessageIds.every((id: string) => copiedIds.has(id))).toBe(true);
		expect(copiedIds.has(episodes[0].anchorMessageId)).toBe(true);
	});

	test('refuses an unknown chat instead of creating an empty one', () => {
		expect(() => serverDb.duplicateChat({ chatId: 'nope', title: 'x', includeMemory: false })).toThrow();
	});

	test('carries stale legacy memory as a reviewable scene without losing its text', () => {
		const { chatId, ids } = seedBranchedChat('Stale memory');
		serverDb.memSetState(chatId, { enabled: true });
		serverDb.memApplyBatch(chatId, { supersedeEpisodeIds: [], episode: {
			content: 'They knocked.', sourceMessageIds: [ids.reply], anchorMessageId: ids.reply
		} });
		serverDb.deleteMessageAndDescendants(ids.reply);
		const copyId = serverDb.duplicateChat({ chatId, title: 'Stale copy', includeMemory: true });
		const scenes = serverDb.getMemoryScenes(copyId);
		expect(scenes).toHaveLength(1);
		expect(scenes[0].content).toBe('They knocked.');
		expect(scenes[0].reviewReason).toBeTruthy();
		expect((serverDb.getMessagesByChat(copyId) as any[]).length).toBe(4);
		const storyOnly = serverDb.duplicateChat({ chatId, title: 'Story only', includeMemory: false });
		expect(serverDb.getMemoryScenes(storyOnly)).toEqual([]);
	});
});

describe('deleting messages never leaves a chat pointing at a dead row', () => {
	// The transcript is drawn by walking root→active_leaf_id, and that walk stops at a missing
	// id: a chat whose leaf names a deleted turn renders EMPTY with every one of its messages
	// still in the table. The repair lives in the db so that no caller can be the one that
	// forgets it. The transcript re-homes the view its own way afterwards; this is the floor.
	test('splicing the leaf away lands the view on its parent', () => {
		const { chatId, ids } = seedBranchedChat('Splice the leaf');
		serverDb.deleteMessageOnly(ids.reply);
		expect(serverDb.getChat(chatId).activeLeafId).toBe(ids.user);
	});

	test('a splice that leaves the leaf alone leaves the view alone', () => {
		const { chatId, ids } = seedBranchedChat('Splice mid-path');
		serverDb.deleteMessageOnly(ids.swipe);
		expect(serverDb.getChat(chatId).activeLeafId).toBe(ids.reply);
	});

	test('a subtree delete takes the leaf inside it back to the fork above', () => {
		const { chatId, ids } = seedBranchedChat('Subtree over the leaf');
		serverDb.deleteMessageAndDescendants(ids.user);
		expect(serverDb.getChat(chatId).activeLeafId).toBe(ids.greeting);
	});

	test('deleting the root re-roots the chat and rehouses the view on a surviving root', () => {
		const { chatId, ids } = seedBranchedChat('Root goes');
		serverDb.deleteMessageAndDescendants(ids.greeting);
		const chat = serverDb.getChat(chatId);
		// Nothing is left above the deleted branch, so the alternate greeting is both the new
		// root and the only thing the reader can be shown.
		expect(chat.rootMessageId).toBe(ids.altGreeting);
		expect(chat.activeLeafId).toBe(ids.altGreeting);
	});

	test('a canon marker inside the deleted subtree retreats instead of dangling', () => {
		const { chatId, ids } = seedBranchedChat('Canon goes');
		serverDb.updateChat({ id: chatId, canonLeafId: ids.reply });
		serverDb.deleteMessageAndDescendants(ids.reply);
		expect(serverDb.getChat(chatId).canonLeafId).toBe(ids.user);
	});

	test('clearing the replies below a turn lands the view on that turn', () => {
		const { chatId, ids } = seedBranchedChat('Descendants go');
		serverDb.deleteDescendants(ids.user);
		const chat = serverDb.getChat(chatId);
		expect(chat.activeLeafId).toBe(ids.user);
		expect((serverDb.getMessagesByChat(chatId) as any[]).length).toBe(3);
	});

	test('emptying a chat leaves no pointer naming a row', () => {
		const { chatId, ids } = seedBranchedChat('Everything goes');
		serverDb.deleteMessageAndDescendants(ids.greeting);
		serverDb.deleteMessageAndDescendants(ids.altGreeting);
		const chat = serverDb.getChat(chatId);
		expect(chat.rootMessageId).toBeNull();
		expect(chat.activeLeafId).toBeNull();
	});
});

describe('getChatMemoryFootprint', () => {
	test('reports what a duplicate would carry', () => {
		const { chatId, ids } = seedBranchedChat('Footprint');
		expect(serverDb.getChatMemoryFootprint(chatId)).toEqual({ enabled: false, episodes: 0 });

		serverDb.memSetState(chatId, { enabled: true });
		serverDb.memApplyBatch(chatId, {
			supersedeEpisodeIds: [],
			episode: { content: 'They knocked.', sourceMessageIds: [ids.user, ids.reply], anchorMessageId: ids.reply }
		});

		expect(serverDb.getChatMemoryFootprint(chatId)).toEqual({ enabled: true, episodes: 1 });
	});
});

describe('the RPC bridge', () => {
	// The three-place rule (architecture/server-core.md): a method missing from the allowlist
	// works in every test that calls it directly and dies as "Unknown db method" the
	// first time the client asks for it. Go through the dispatcher instead.
	test('reaches every method the chats panel calls', async () => {
		const { callDbMethod } = await import('./db');
		const { chatId } = seedBranchedChat('Bridge');

		expect(callDbMethod('getChatListStats', [])).toBeDefined();
		expect(callDbMethod('getChatContentGroups', [])).toBeDefined();
		expect(callDbMethod('searchChatMessages', ['door'])).toBeDefined();
		expect(callDbMethod('getChatMemoryFootprint', [chatId])).toBeDefined();
		expect(() => callDbMethod('updateChatFavorite', [chatId, true])).not.toThrow();
		expect(callDbMethod('duplicateChat', [{ chatId, title: 'Bridge (copy)', includeMemory: false }])).toBeString();
	});
});

describe('updateChatFavorite', () => {
	test('round-trips without disturbing activity order', () => {
		const chatId = makeChat({ title: 'Star me' });
		const before = (serverDb.getChat(chatId) as any).updatedAt;

		serverDb.updateChatFavorite(chatId, true);
		expect((serverDb.getChat(chatId) as any).isFavorite).toBe(true);
		expect((serverDb.getChat(chatId) as any).updatedAt).toBe(before);

		serverDb.updateChatFavorite(chatId, false);
		expect((serverDb.getChat(chatId) as any).isFavorite).toBe(false);
	});
});

describe('createdSince', () => {
	test('counts chats and their messages made after a moment', () => {
		// What the restore confirmation states in real numbers. Messages are counted beside
		// chats because they are the actual work: losing "one chat" can be losing every hour
		// of writing inside it.
		// Measured as a delta rather than against a total: this suite shares a clock, and
		// duplicated chats are stamped with the real one, so the table already holds rows
		// on both sides of any boundary picked here.
		const boundary = clock;
		const before = serverDb.createdSince(boundary);
		clock += 1000;
		seedBranchedChat('After the line');
		const after = serverDb.createdSince(boundary);

		expect(after.chats).toBe(before.chats + 1);
		expect(after.messages).toBeGreaterThan(before.messages);
		expect(serverDb.createdSince(Date.now() + 86_400_000)).toEqual({
			chats: 0,
			messages: 0,
			characters: 0
		});
	});
});
