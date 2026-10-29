import { beforeAll } from 'bun:test';
import { prepareTokenizer } from '#lib/tokenizer/encodings.ts';
beforeAll(async () => { await Promise.all([prepareTokenizer(), prepareTokenizer('gpt-4')]); });

import { describe, expect, test } from 'bun:test';
import { countTokens } from '#lib/tokenizer/count.ts';
import type { CharacterTraits } from '#lib/types/library.ts';
import { countCharacterTokens } from './character-token-counts';

const empty: CharacterTraits = { description: '', personality: '', background: '' };

describe('character token count snapshots', () => {
	test('counts the first message once and preserves individual alternate greetings', () => {
		const result = countCharacterTokens({ ...empty, firstMessage: 'Hello!' }, ['Hello!', 'Another opening.']);
		const rows = result.groups.flatMap((group) => group.rows);
		expect(rows.filter((row) => row.key === 'firstMessage')).toHaveLength(1);
		expect(result.groups.find((group) => group.label === 'Greetings')?.rows.map((row) => row.tokens))
			.toEqual([countTokens('Hello!'), countTokens('Hello!'), countTokens('Another opening.')]);
		expect(result.total).toBe(2 * countTokens('Hello!') + countTokens('Another opening.'));
	});

	test('includes collapsed prompts but excludes card details from both rows and total', () => {
		const result = countCharacterTokens({ ...empty, creatorNotes: 'Notes', creator: 'Author', characterVersion: '1.0', systemPrompt: 'Instructions' });
		const rows = result.groups.flatMap((group) => group.rows);
		expect(rows.map((row) => row.key).sort()).toEqual([
			'description', 'personality', 'scenario', 'exampleDialogue', 'firstMessage', 'systemPrompt', 'postHistoryInstructions'
		].sort());
		expect(rows.find((row) => row.key === 'postHistoryInstructions')?.tokens).toBe(0);
		expect(result.total).toBe(countTokens('Instructions'));
	});

	test('uses the requested encoding and produces a snapshot unaffected by later edits', () => {
		const traits = { ...empty, description: 'Olá, histórias! こんにちは世界' };
		const greetings = ['Uma nova história.'];
		const snapshot = countCharacterTokens(traits, greetings, 'gpt-4');
		const expected = countTokens(traits.description, 'gpt-4') + countTokens(greetings[0], 'gpt-4');
		expect(snapshot.total).toBe(expected);
		traits.description = '';
		greetings[0] = '';
		expect(snapshot.total).toBe(expected);
		expect(countCharacterTokens(traits, greetings, 'gpt-4').total).toBe(0);
	});
});
