import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDatabaseFixture } from './test-fixtures';
import type { Message, MessagesDelta } from '../src/lib/types/chat';

let dataDir: string;
let db: (typeof import('./db'))['serverDb'];
let call: (typeof import('./db'))['callDbMethod'];
const previousDataDir = process.env.CHUNGUS_DATA_DIR;
beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-message-bookmarks-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb: db, callDbMethod: call } = await import('./db'));
	db.closeForTests();
});
afterAll(() => {
	db?.closeForTests();
	if (previousDataDir === undefined) delete process.env.CHUNGUS_DATA_DIR;
	else process.env.CHUNGUS_DATA_DIR = previousDataDir;
	removeDatabaseFixture(dataDir, 'chungus-message-bookmarks-');
});
function fixture() {
	const chatId = crypto.randomUUID();
	db.insertChat({ id: chatId, title: 'A story', createdAt: 1, updatedAt: 2, rootMessageId: null, activeLeafId: null });
	const root = crypto.randomUUID(), leaf = crypto.randomUUID();
	db.insertMessage({ id: root, chatId, parentId: null, role: 'user', content: 'An important promise.', createdAt: 1, editedAt: 10, minorEditedAt: 12, excludedFromPrompt: true });
	db.insertMessage({ id: leaf, chatId, parentId: root, role: 'assistant', content: 'I will remember.', createdAt: 2 });
	db.updateChat({ id: chatId, rootMessageId: root, activeLeafId: leaf, canonLeafId: leaf });
	return { chatId, root, leaf };
}
const message = (id: string) => db.getMessage(id) as Message;
const messages = (chatId: string) => db.getMessagesByChat(chatId) as Message[];

test('bookmark RPC returns the canonical delta without changing text, memory edit stamps, prompt inclusion or chat activity', () => {
	const { chatId, root, leaf } = fixture(), original = message(root), chat = db.getChat(chatId);
	const baseline = db.getMessagesDelta(chatId, null) as MessagesDelta;
	const delta = call('setMessageBookmarked', [root, true, baseline.rev]) as MessagesDelta;
	expect(delta.upserts).toHaveLength(1);
	expect(delta.upserts[0]).toEqual({ ...original, isBookmarked: true });
	expect(message(leaf).isBookmarked).toBe(false);
	expect(db.getChat(chatId)).toEqual(chat);
	expect((db.getMessagesDelta(chatId, baseline.rev) as MessagesDelta).upserts).toEqual(delta.upserts);
	const repeated = db.setMessageBookmarked(root, true, delta.rev) as MessagesDelta;
	expect(repeated.rev).toBe(delta.rev);
	expect(repeated.upserts).toEqual([]);
});

test('bookmarks survive text edits, exclusion changes and database reopen, and unmarking keeps the message', () => {
	const { root, leaf } = fixture();
	db.setMessageBookmarked(root, true);
	db.updateMessageContent(root, 'An updated promise.', { minor: true });
	db.setMessageExcludedFromPrompt(root, false);
	db.closeForTests();
	expect(message(root)).toMatchObject({ isBookmarked: true, content: 'An updated promise.', excludedFromPrompt: false });
	db.setMessageBookmarked(root, false);
	expect(message(root)).toMatchObject({ isBookmarked: false, content: 'An updated promise.' });
	expect(message(leaf)).toBeTruthy();
});

test('duplicates and branches preserve bookmarks on their copied messages with independent ids', () => {
	const { chatId, root, leaf } = fixture();
	db.setMessageBookmarked(root, true); db.setMessageBookmarked(leaf, true);
	const copyId = db.duplicateChat({ chatId, title: 'Copy', includeMemory: false });
	const branchId = db.branchChat({ chatId, messageId: root, title: 'Branch', content: message(root).content });
	expect(messages(copyId).filter(turn => turn.isBookmarked)).toHaveLength(2);
	expect(messages(branchId).filter(turn => turn.isBookmarked)).toHaveLength(1);
	const copyRoot = messages(copyId).find(turn => turn.parentId === null)!;
	expect(copyRoot.id).not.toBe(root);
	db.setMessageBookmarked(copyRoot.id, false);
	expect(message(root).isBookmarked).toBe(true);
});

test('deleted bookmarks disappear with their messages and invalid writes leave the other bookmarks intact', () => {
	const { chatId, root, leaf } = fixture();
	db.setMessageBookmarked(root, true); db.setMessageBookmarked(leaf, true);
	db.deleteMessageAndDescendants(leaf);
	expect(messages(chatId).filter(turn => turn.isBookmarked).map(turn => turn.id)).toEqual([root]);
	expect(() => db.setMessageBookmarked(leaf, true)).toThrow('no longer exists');
	expect(() => call('setMessageBookmarked', [root, 'true'])).toThrow('boolean bookmark');
	expect(message(root).isBookmarked).toBe(true);
});
