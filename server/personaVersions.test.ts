import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDatabaseFixture } from './test-fixtures';

let serverDb: typeof import('./db').serverDb;
let dataDir: string;
let priorDataDir: string | undefined;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-persona-versions-'));
	priorDataDir = process.env.CHUNGUS_DATA_DIR;
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb } = await import('./db'));
	serverDb.closeForTests();
});

afterAll(() => {
	serverDb.closeForTests();
	if (priorDataDir === undefined) delete process.env.CHUNGUS_DATA_DIR;
	else process.env.CHUNGUS_DATA_DIR = priorDataDir;
	removeDatabaseFixture(dataDir, 'chungus-persona-versions-');
});

test('a persona fork persists description only and protects its Original and explicit chat pins', () => {
	const persona = { id: crypto.randomUUID(), type: 'persona', isFavorite: false, createdAt: 1, updatedAt: 1,
		identity: { name: 'Avery', pronouns: { subjective: 'she' }, imageUrl: 'images/personas/test.png' },
		data: { traits: { description: 'By the sea.' }, lorebookIds: ['shared-book'] } };
	serverDb.insertLibraryEntry(persona);
	const chat = { id: crypto.randomUUID(), title: 'Before versions', createdAt: 1, updatedAt: 1,
		rootMessageId: null, activeLeafId: null, settings: null, featureState: JSON.stringify({ persona: persona.id }) };
	serverDb.insertChat(chat);
	const [baseline, fork] = serverDb.forkPersonaVersion(persona.id, 'City', null);
	expect(serverDb.getLibraryEntry(persona.id)).toMatchObject({ activeVersionId: fork.id });
	expect(() => serverDb.forkPersonaVersion(persona.id, 'Stale', null)).toThrow('editing version changed');
	expect(() => serverDb.deleteCharacterVersion(baseline.id)).toThrow('before deleting');
	serverDb.updateLibraryEntry({ ...persona, activeVersionId: fork.id, identity: { ...persona.identity, pronouns: { subjective: 'they' } },
		data: { ...persona.data, traits: { description: 'In the city.' } } });
	expect(serverDb.getCharacterVersionsByEntry(persona.id).map(version => version.data)).toEqual([
		{ traits: { description: 'By the sea.', background: '', personality: '' } },
		{ traits: { description: 'In the city.', background: '', personality: '' } }
	]);
	expect(serverDb.getLibraryEntry(persona.id)).toMatchObject({ identity: { ...persona.identity, pronouns: { subjective: 'they' } },
		data: { lorebookIds: ['shared-book'] } });
	const claim = JSON.stringify({ persona: persona.id, personaVersion: fork.id });
	serverDb.updateChat({ id: chat.id, featureState: claim });
	expect(serverDb.getChat(chat.id)).toMatchObject({ featureState: claim });
	expect(() => serverDb.deleteCharacterVersion(fork.id)).toThrow('before deleting');
	expect(() => serverDb.updateChat({ id: chat.id, featureState: JSON.stringify({ persona: crypto.randomUUID(), personaVersion: fork.id }) }))
		.toThrow('belongs to this persona');
});
