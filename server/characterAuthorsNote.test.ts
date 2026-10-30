import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

let dataDir: string;
let serverDb: typeof import('./db').serverDb;
let previousDataDir: string | undefined;
beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-character-notes-'));
	previousDataDir = process.env.CHUNGUS_DATA_DIR;
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb } = await import('./db'));
	serverDb.closeForTests();
});
afterAll(() => {
	serverDb.closeForTests();
	if (previousDataDir === undefined) delete process.env.CHUNGUS_DATA_DIR;
	else process.env.CHUNGUS_DATA_DIR = previousDataDir;
	const target = resolve(dataDir);
	if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('chungus-character-notes-')) throw new Error('Invalid scratch directory');
	rmSync(target, { recursive: true, force: true });
});
function seed(type = 'character') {
	const entry = { id: crypto.randomUUID(), type, identity: { name: 'Character' },
		data: { traits: { description: 'Original card.' } }, isFavorite: false, createdAt: 1, updatedAt: 1 };
	serverDb.insertLibraryEntry(entry);
	return entry;
}
const note = { text: 'Private shared guidance.', enabled: true, position: 'after' as const };

test('a private note survives reopening the database and stays outside character/version data', () => {
	const entry = seed();
	const version = { id: crypto.randomUUID(), entryId: entry.id, name: 'Version', data: entry.data, createdAt: 1, updatedAt: 1 };
	serverDb.insertCharacterVersion(version);
	serverDb.updateLibraryEntry({ ...entry, activeVersionId: version.id });
	expect(serverDb.updateCharacterAuthorsNote(entry.id, note)).toEqual(note);
	serverDb.closeForTests();
	const read = serverDb.getLibraryEntry(entry.id) as typeof entry & { characterAuthorsNote: typeof note };
	expect(read.characterAuthorsNote).toEqual(note);
	expect(read.data).toEqual(entry.data);
	expect(serverDb.getAllCharacterVersions().find((row: any) => row.id === version.id)).toMatchObject({ data: entry.data });
});

test('two chats of one character share the private note while keeping their own chat notes and version pins', () => {
	const entry = seed();
	const chats = ['First story.', 'Second story.'].map((text, index) => {
		const version = { id: crypto.randomUUID(), entryId: entry.id, name: `Version ${index}`,
			data: entry.data, createdAt: index + 1, updatedAt: index + 1 };
		serverDb.insertCharacterVersion(version);
		const chat = { id: crypto.randomUUID(), title: text, createdAt: 1, updatedAt: 1,
			rootMessageId: null, activeLeafId: null, settings: null,
			characterId: entry.id, characterVersionId: version.id,
			featureState: JSON.stringify({ authorsNote: { text } }) };
		serverDb.insertChat(chat);
		return chat;
	});
	serverDb.updateCharacterAuthorsNote(entry.id, note);
	for (const chat of chats) {
		const saved = serverDb.getChat(chat.id) as Record<string, any>;
		expect(saved.featureState).toBe(chat.featureState);
		expect(saved.characterVersionId).toBe(chat.characterVersionId);
		expect(serverDb.getLibraryEntry(saved.characterId)).toMatchObject({ characterAuthorsNote: note });
	}
	serverDb.updateCharacterAuthorsNote(entry.id, { ...note, text: 'Updated in either chat.' });
	for (const chat of chats) expect(serverDb.getLibraryEntry(chat.characterId))
		.toMatchObject({ characterAuthorsNote: { ...note, text: 'Updated in either chat.' } });
});

test('a stale full card save cannot overwrite or erase a newer private note', () => {
	const entry = seed();
	const stale = serverDb.getLibraryEntry(entry.id) as Record<string, unknown>;
	serverDb.updateCharacterAuthorsNote(entry.id, note);
	serverDb.updateLibraryEntry({ ...stale, data: { traits: { description: 'Edited card.' } } });
	const read = serverDb.getLibraryEntry(entry.id) as Record<string, any>;
	expect(read.characterAuthorsNote).toEqual(note);
	expect(read.data.traits.description).toBe('Edited card.');
	serverDb.updateCharacterAuthorsNote(entry.id, { ...note, text: 'Newest.' });
	serverDb.updateLibraryEntry({ ...read, characterAuthorsNote: { ...note, text: 'Stale.' } });
	expect(serverDb.getLibraryEntry(entry.id)).toMatchObject({ characterAuthorsNote: { ...note, text: 'Newest.' } });
});

test('editing a private note preserves the latest card data and other characters remain independent', () => {
	const entry = seed(), other = seed();
	serverDb.updateLibraryEntry({ ...entry, identity: { name: 'New name' }, data: { traits: { description: 'New content.' } } });
	serverDb.updateCharacterAuthorsNote(entry.id, note);
	expect(serverDb.getLibraryEntry(entry.id)).toMatchObject({ identity: { name: 'New name' }, data: { traits: { description: 'New content.' } }, characterAuthorsNote: note });
	expect(serverDb.getLibraryEntry(other.id)).not.toHaveProperty('characterAuthorsNote');
});

test('private-note mutations refuse deleted characters and personas', () => {
	expect(() => serverDb.updateCharacterAuthorsNote('missing', note)).toThrow('character');
	expect(() => serverDb.updateCharacterAuthorsNote(seed('persona').id, note)).toThrow('character');
});
