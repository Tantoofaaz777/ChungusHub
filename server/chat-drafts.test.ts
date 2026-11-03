import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDatabaseFixture } from './test-fixtures';

let db: typeof import('./db').serverDb;
let dir: string;
const previous = process.env.CHUNGUS_DATA_DIR;
beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'chungus-draft-cas-'));
	process.env.CHUNGUS_DATA_DIR = dir;
	({ serverDb: db } = await import('./db')); db.closeForTests();
});
afterAll(() => {
	db.closeForTests();
	if (previous === undefined) delete process.env.CHUNGUS_DATA_DIR; else process.env.CHUNGUS_DATA_DIR = previous;
	removeDatabaseFixture(dir, 'chungus-draft-cas-');
});
function chat() {
	const id = crypto.randomUUID();
	db.insertChat({ id, title: 'Draft', createdAt: 1, updatedAt: 1, rootMessageId: null, activeLeafId: null, conversationVersion: 2 });
	return id;
}

test('a stale send cleanup preserves a newer remote draft and returns its current snapshot', () => {
	const id = chat(), submitted = db.upsertChatDraft(id, 'Submitted by A'), remote = db.upsertChatDraft(id, 'New draft from B');
	expect(db.deleteChatDraft(id, submitted.revision)).toEqual(remote);
	expect(db.getChatDraft(id)).toEqual(remote);
	expect(db.deleteChatDraft(id, remote.revision)).toBeNull();
	expect(db.getChatDraft(id)).toBeNull();
});

test('equal text and equal timestamps still receive distinct revisions, including after recreation', () => {
	const id = chat(), now = Date.now;
	try {
		Date.now = () => 123456;
		const first = db.upsertChatDraft(id, 'Same'), second = db.upsertChatDraft(id, 'Same');
		expect(first.updatedAt).toBe(second.updatedAt); expect(first.revision).not.toBe(second.revision);
		expect(db.deleteChatDraft(id, first.revision)).toEqual(second);
		db.deleteChatDraft(id, second.revision);
		const recreated = db.upsertChatDraft(id, 'Same');
		expect(recreated.revision).not.toBe(second.revision);
		expect(db.deleteChatDraft(id, second.revision)).toEqual(recreated);
	} finally { Date.now = now; }
});

test('unknown revisions and old clients cannot delete a stored draft', () => {
	const id = chat(), saved = db.upsertChatDraft(id, 'Keep');
	expect(db.deleteChatDraft(id, null)).toEqual(saved);
	expect(() => (db.deleteChatDraft as any)(id)).toThrow('Reload');
	expect(() => db.deleteChatDraft(id, '')).toThrow('Reload');
	expect(db.getChatDraft(id)).toEqual(saved);
	expect(db.deleteChatDraft(chat(), null)).toBeNull();
});

test('a revision from another chat cannot remove that chat’s draft', () => {
	const firstId = chat(), secondId = chat();
	const first = db.upsertChatDraft(firstId, 'First'), second = db.upsertChatDraft(secondId, 'Second');
	expect(db.deleteChatDraft(secondId, first.revision)).toEqual(second);
	expect(db.getChatDraft(firstId)).toEqual(first);
});
