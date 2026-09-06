/**
 * Chat duplication preserves the source story's per-chat claims and pinned character
 * version. Runs against the real SQLite layer in an isolated data directory.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir: string;
let serverDb: any;
let clock = 1_800_000_000_000;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-per-chat-usage-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb } = await import('./db'));
	serverDb.closeForTests();
});

afterAll(() => {
	serverDb.closeForTests();
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {
		/* best effort */
	}
});

function characterAndVersion(): { characterId: string; versionId: string } {
	clock += 1000;
	const characterId = crypto.randomUUID();
	serverDb.insertLibraryEntry({
		id: characterId,
		type: 'character',
		identity: { name: 'Aria', tags: [] },
		data: { traits: {} },
		isFavorite: false,
		createdAt: clock,
		updatedAt: clock
	});
	const versionId = crypto.randomUUID();
	serverDb.insertCharacterVersion({
		id: versionId,
		entryId: characterId,
		name: 'Original',
		data: { traits: {} },
		createdAt: clock,
		updatedAt: clock
	});
	return { characterId, versionId };
}

function claimedChat(options: Record<string, unknown> = {}): string {
	clock += 1000;
	const id = crypto.randomUUID();
	serverDb.insertChat({
		id,
		title: 'A story',
		createdAt: clock,
		updatedAt: clock,
		rootMessageId: null,
		activeLeafId: null,
		settings: null,
		characterId: null,
		characterVersionId: null,
		...options
	});
	return id;
}

function chatRow(id: string): Record<string, any> {
	const chat = serverDb.getChat(id);
	if (!chat) throw new Error(`no chat ${id}`);
	return chat;
}

describe('duplicating a chat', () => {
	test('the copy is the same story: every claim and the version pin come along', () => {
		const { characterId, versionId } = characterAndVersion();
		const featureState = JSON.stringify({
			steeringHistory: ['Colder.'],
			impersonatePerspective: 'second',
			scene: null,
			connection: 'conn-own',
			persona: 'persona-own',
			preset: 'preset-own'
		});
		const source = claimedChat({ characterId, characterVersionId: versionId, featureState });

		const copyId = serverDb.duplicateChat({ chatId: source, title: 'A story (copy)', includeMemory: false });

		expect(chatRow(copyId).featureState).toBe(featureState);
		expect(chatRow(copyId).characterVersionId).toBe(versionId);
	});

	test('a chat that claimed nothing copies as a chat that claims nothing', () => {
		const source = claimedChat();
		const copyId = serverDb.duplicateChat({ chatId: source, title: 'A story (copy)', includeMemory: false });
		expect(chatRow(copyId).featureState).toBeNull();
	});
});
