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

test('user turns keep the version portrait and framing captured at send time', () => {
	const id = crypto.randomUUID();
	const base = { imageUrl: `images/personas/${id}-base.webp`, portraitFocus: { x: .3, y: .5, zoom: 1.2 } };
	const custom = { imageUrl: `images/personas/${id}-version.webp`, portraitFocus: { x: .7, y: .4, zoom: 1.5 } };
	const replacement = { imageUrl: `images/personas/${id}-new.webp` };
	const persona = { id, type: 'persona', isFavorite: false, createdAt: 1, updatedAt: 1,
		identity: { name: 'Morgan', ...base }, data: { traits: { description: 'Original description' } } };
	serverDb.insertLibraryEntry(persona);
	const [original, alternate] = serverDb.forkPersonaVersion(id, 'Alternate', null);
	const chatId = crypto.randomUUID();
	const pin = (version: string | null) => JSON.stringify({ persona: id, ...(version ? { personaVersion: version } : {}) });
	serverDb.insertChat({ id: chatId, title: 'Portrait history', createdAt: 1, updatedAt: 1,
		rootMessageId: null, activeLeafId: null, conversationVersion: 2, featureState: pin(null) });
	const append = (personaId: string | null) => {
		const context = serverDb.getConversationPlacement(chatId, 'append')!;
		const messageId = crypto.randomUUID();
		serverDb.appendConversationTurn({ id: messageId, chatId, parentId: context.expectedLeafId, role: 'user',
			content: 'Message', personaId, createdAt: Date.now() }, context);
		return messageId;
	};
	const first = append(id);
	expect(serverDb.getMessage(first)).toMatchObject({ personaPortrait: base });
	serverDb.setPersonaVersionPortrait(id, alternate.id, custom, null);
	expect(() => serverDb.setPersonaVersionPortrait(id, alternate.id, null, null)).toThrow('portrait changed');
	serverDb.updateLibraryEntry({ ...persona, activeVersionId: alternate.id, data: { traits: { description: 'Changed description' } } });
	expect(serverDb.getCharacterVersion(alternate.id)).toMatchObject({ data: { personaPortrait: custom, traits: { description: 'Changed description' } } });
	serverDb.updateChat({ id: chatId, featureState: pin(alternate.id) });
	const second = append(id);
	expect(serverDb.getMessage(second)).toMatchObject({ personaPortrait: custom });
	serverDb.setPersonaVersionPortrait(id, alternate.id, replacement, custom.imageUrl);
	expect(() => serverDb.setPersonaVersionPortrait(id, alternate.id, custom, custom.imageUrl)).toThrow('portrait changed');
	const third = append(id);
	expect(serverDb.getMessage(third)).toMatchObject({ personaPortrait: replacement });
	expect(serverDb.getMessage(append(null))).toMatchObject({ personaPortrait: null });
	const [newVersion] = serverDb.forkPersonaVersion(id, 'Inherits default', alternate.id);
	expect(newVersion.data).not.toHaveProperty('personaPortrait');
	serverDb.updateChat({ id: chatId, featureState: pin(original.id) });
	serverDb.deleteCharacterVersion(alternate.id);
	serverDb.setChatUserPersona(chatId, id);
	expect(serverDb.getMessage(second)).toMatchObject({ personaPortrait: custom });
	const copied = serverDb.duplicateChat({ chatId, title: 'Copy', includeMemory: false });
	const branch = serverDb.branchChat({ chatId, messageId: third, title: 'Branch', content: 'Branch text' });
	for (const destination of [copied, branch]) {
		const messages = serverDb.getMessagesByChat(destination);
		expect(messages[0]).toMatchObject({ personaPortrait: base });
		expect(messages[1]).toMatchObject({ personaPortrait: custom });
		expect(messages[2]).toMatchObject({ personaPortrait: replacement });
	}
	serverDb.deleteChat(chatId);
	serverDb.deleteChat(branch);
	expect(serverDb.deleteUnusedImage(custom.imageUrl)).toBe(false);
	serverDb.deleteChat(copied);
	expect(serverDb.deleteUnusedImage(custom.imageUrl)).toBe(true);
});
