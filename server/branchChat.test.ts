import { beforeAll, afterAll, describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { Database } from 'bun:sqlite';
import { captureScene, resolveScenes, scenePath, type SceneMessage } from '../shared/memory-scenes';

let dir: string;
let db: typeof import('./db').serverDb;
let callDbMethod: typeof import('./db').callDbMethod;
const previousDataDir = process.env.CHUNGUS_DATA_DIR;
beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'chungus-branch-chat-'));
	process.env.CHUNGUS_DATA_DIR = dir;
	({ serverDb: db, callDbMethod } = await import('./db'));
	db.closeForTests();
});
afterAll(() => {
	db?.closeForTests();
	if (previousDataDir === undefined) delete process.env.CHUNGUS_DATA_DIR;
	else process.env.CHUNGUS_DATA_DIR = previousDataDir;
	const absolute = resolve(dir);
	if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('chungus-branch-chat-')) throw new Error('Unsafe scratch path');
	rmSync(absolute, { recursive: true, force: true });
});

function fixture() {
	const chatId = crypto.randomUUID();
	db.insertChat({ id: chatId, title: 'Original', createdAt: 1, updatedAt: 2,
		rootMessageId: null, activeLeafId: null, settings: { temperature: 0.8 },
		featureState: JSON.stringify({ authorsNote: { text: 'A shared note', enabled: true }, connectionId: 'connection' }) });
	const messages: (SceneMessage & { chatId: string; createdAt: number })[] = [];
	for (let i = 0; i < 7; i++) {
		const message = { id: crypto.randomUUID(), chatId, parentId: messages.at(-1)?.id ?? null,
			role: i % 2 ? 'user' as const : 'assistant' as const, content: `Turn ${i}`, createdAt: i + 1 };
		db.insertMessage(message); messages.push(message);
	}
	db.insertMessage({ ...messages[2], id: crypto.randomUUID(), content: 'Unselected alternate', siblingIndex: 1 });
	db.updateChat({ id: chatId, rootMessageId: messages[0].id, activeLeafId: messages[6].id, canonLeafId: messages[6].id });
	db.updateChatFavorite(chatId, true);
	return { chatId, messages };
}
function fork(chatId: string, message: SceneMessage, content = message.content): string {
	return callDbMethod('branchChat', [{ chatId, messageId: message.id, title: 'Original (branch)', content }]) as string;
}
const rows = (chatId: string) => db.getMessagesByChat(chatId) as (SceneMessage & Record<string, unknown>)[];
const currentPath = (chatId: string) => scenePath(rows(chatId), (db.getChat(chatId) as { activeLeafId: string }).activeLeafId);

describe('branch into a new chat', () => {
	test('copies only the selected ancestry, including the endpoint, and never changes the source', () => {
		const { chatId, messages } = fixture();
		const original = db.getChat(chatId), originalRows = rows(chatId);
		const newId = fork(chatId, messages[3]);
		expect(newId).not.toBe(chatId);
		expect(currentPath(newId).map(m => m.content)).toEqual(messages.slice(0, 4).map(m => m.content));
		expect(rows(newId)).toHaveLength(4);
		expect(rows(newId).every(m => !originalRows.some(o => o.id === m.id))).toBe(true);
		expect(db.getChat(chatId)).toEqual(original);
		expect(rows(chatId)).toEqual(originalRows);
		const copy = db.getChat(newId) as Record<string, unknown>;
		expect(copy.settings).toEqual((original as Record<string, unknown>).settings);
		expect(copy.featureState).toEqual((original as Record<string, unknown>).featureState);
		expect(copy.isFavorite).toBe(false);
		expect(copy.activeLeafId).toBe(copy.canonLeafId);
		expect((db.getMessagesDelta(newId, null) as { rev: number }).rev).toBe(0);
	});

	test('supports assistant, user and alternate-root endpoints; an edited endpoint belongs only to the copy', () => {
		const { chatId, messages } = fixture();
		const assistantCopy = fork(chatId, messages[2], 'Rewritten ending');
		expect(currentPath(assistantCopy).map(m => m.content)).toEqual(['Turn 0', 'Turn 1', 'Rewritten ending']);
		expect(rows(chatId).find(m => m.id === messages[2].id)?.content).toBe('Turn 2');
		const alternate = { ...messages[0], id: crypto.randomUUID(), content: 'Alternate opening', siblingIndex: 1 };
		db.insertMessage(alternate);
		const rootCopy = fork(chatId, alternate);
		expect(currentPath(rootCopy).map(m => m.content)).toEqual(['Alternate opening']);
		expect((db.getChat(rootCopy) as Record<string, unknown>).rootMessageId).toBe(rows(rootCopy)[0].id);
	});

	test('copied metadata and attachments remain independent of source edits and deletion', () => {
		const { chatId, messages } = fixture();
		const tail = { ...messages[2], id: crypto.randomUUID(), personaId: 'persona', thinking: 'reasoning',
			attachments: [{ kind: 'image', path: 'images/chat/fixture.png' }], excludedFromPrompt: true,
			branchLabel: { name: 'A route', color: 'amber' }, tokensCompletion: 19 };
		db.insertMessage(tail);
		const copy = fork(chatId, tail), copiedTail = currentPath(copy).at(-1)!;
		expect(copiedTail.attachments).toEqual(tail.attachments);
		expect(copiedTail.personaId).toBe('persona');
		expect(copiedTail.thinking).toBe('reasoning');
		expect(copiedTail.excludedFromPrompt).toBe(true);
		expect(copiedTail.branchLabel).toEqual(tail.branchLabel);
		db.updateMessageContent(copiedTail.id, 'Changed in copy');
		expect(rows(chatId).find(m => m.id === tail.id)?.content).toBe(tail.content);
		db.deleteChat(chatId);
		expect(currentPath(copy).at(-1)?.content).toBe('Changed in copy');
	});

	test('keeps only complete memory coverage inside the prefix and remaps hierarchy references', () => {
		const { chatId, messages } = fixture();
		const chapter = (start: number, end: number) => db.saveMemoryScene({ chatId, title: `Chapter ${start}`, content: 'Summary', source: captureScene(messages.slice(start, end)) });
		const a = chapter(0, 1), b = chapter(1, 3);
		chapter(3, 5); chapter(5, 7);
		db.saveMemoryScene({ chatId, title: 'Arc', content: 'Earlier arc', level: 'arc', source: [...a.source, ...b.source], children: [a, b].map(c => ({ id: c.id, revision: c.revision })) });
		const original = db.getMemoryScenes(chatId);
		const copy = fork(chatId, messages[3]);
		const scenes = db.getMemoryScenes(copy), copiedRows = rows(copy);
		expect(scenes.map(s => s.title).sort()).toEqual(['Arc', 'Chapter 0', 'Chapter 1']);
		expect(scenes.every(s => s.source.every(ref => copiedRows.some(m => m.id === ref.id)))).toBe(true);
		expect(resolveScenes(scenes, currentPath(copy)).find(s => s.scene.level === 'arc')?.status).toBe('active');
		expect(db.getMemoryScenes(chatId)).toEqual(original);
		const editedCopy = fork(chatId, messages[2], 'A different story');
		expect(resolveScenes(db.getMemoryScenes(editedCopy), currentPath(editedCopy)).find(s => s.scene.title === 'Chapter 1')?.status).toBe('review');
	});

	test('copies only Threads whose entire source is included', () => {
		const { chatId, messages } = fixture();
		const feed = { title: 'Reactions', post: { username: 'reader', body: 'Post', score: 1 }, comments: [] };
		for (const [start, end] of [[0, 2], [2, 5]]) {
			db.saveThreadsRound({ id: crypto.randomUUID(), chatId, label: `Threads ${start}`, feed,
				messages: messages.slice(start, end).map((m, i) => ({ id: m.id, index: start + i, role: m.role, content: m.content, speaker: m.role })) });
		}
		const copy = fork(chatId, messages[3]);
		const inherited = db.getThreadsData(copy).rounds;
		expect(inherited).toHaveLength(1);
		expect(inherited[0].label).toBe('Threads 0');
		expect(inherited[0].messages.every(ref => rows(copy).some(m => m.id === ref.id))).toBe(true);
		const edited = fork(chatId, messages[1], 'Rewritten before branching');
		expect(db.getThreadsData(edited).rounds).toHaveLength(0);
	});

	test('invalid, foreign, deleted and empty endpoints create no partial chat', () => {
		const { chatId, messages } = fixture(), other = fixture();
		const count = db.getAllChats().length;
		for (const id of ['missing', other.messages[0].id]) {
			expect(() => fork(chatId, { ...messages[0], id })).toThrow('unavailable');
		}
		expect(() => fork(chatId, messages[0], '')).toThrow('empty');
		db.deleteMessageAndDescendants(messages[4].id);
		expect(() => fork(chatId, messages[4])).toThrow('unavailable');
		expect(db.getAllChats()).toHaveLength(count);
	});

	test('failure while copying memory rolls back the new chat and its messages', () => {
		const { chatId, messages } = fixture();
		db.saveMemoryScene({ chatId, title: 'Before cutoff', content: 'Summary', source: captureScene(messages.slice(0, 2)) });
		const original = rows(chatId), chatsBefore = db.getAllChats();
		const probe = new Database(join(dir, 'chungushub.db'));
		try {
			probe.exec(`CREATE TRIGGER reject_branch_memory BEFORE INSERT ON memory_scenes
				WHEN NEW.chat_id <> '${chatId}' BEGIN SELECT RAISE(ABORT, 'copy interrupted'); END`);
			expect(() => fork(chatId, messages[3])).toThrow('copy interrupted');
			expect(db.getAllChats()).toEqual(chatsBefore);
			expect(rows(chatId)).toEqual(original);
		} finally {
			probe.exec('DROP TRIGGER reject_branch_memory');
			probe.close();
		}
	});
});
