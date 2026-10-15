/** A card's embedded lorebook remains importable without a profile-folder importer. */
import { describe, expect, test } from 'bun:test';
import { importSillyTavernCard } from './sillyTavernImport';

const BOOK = { name: 'Kingdom', entries: [{ keys: ['dragon'], content: 'A great red wyrm.', enabled: true }] };
const card = (body: Record<string, unknown>) => new File([JSON.stringify(body)], 'card.json', { type: 'application/json' });

describe('character cards without profile migration', () => {
	test.each([
		['V1', { name: 'Alice', extensions: { world: 'Kingdom' }, character_book: BOOK }],
		['V2', { spec: 'chara_card_v2', data: { name: 'Alice', extensions: { world: 'Kingdom' }, character_book: BOOK } }]
	] as const)('imports an embedded lorebook despite an external world name (%s)', async (_format, body) => {
		const result = await importSillyTavernCard(card(body));
		expect(result.character.name).toBe('Alice');
		expect(result.lorebook?.entries.map((entry) => entry.content)).toEqual(['A great red wyrm.']);
	});

	test('an external world name alone creates no empty lorebook', async () => {
		const result = await importSillyTavernCard(card({ name: 'Alice', extensions: { world: 'Kingdom' } }));
		expect(result.lorebook).toBeNull();
	});
});
