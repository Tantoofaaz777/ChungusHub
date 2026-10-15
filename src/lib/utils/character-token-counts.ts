import { PERMANENT_TRAITS, type CharacterTraits, type TraitKey } from '$lib/types/library';
import { countTokens } from '$lib/tokenizer/count';

export interface CharacterTokenRow {
	key: string;
	label: string;
	tokens: number;
}

export interface CharacterTokenCounts {
	groups: { label: string; rows: CharacterTokenRow[] }[];
	total: number;
}

const detailKeys = new Set<TraitKey>(['characterVersion', 'creator', 'creatorNotes']);

/** A click-time snapshot of the card's prompts and greetings, independent of collapsed sections.
 * Count each field separately, just like the field buttons; this is not an assembled prompt. */
export function countCharacterTokens(
	traits: CharacterTraits,
	alternateGreetings: readonly string[] = [],
	model?: string
): CharacterTokenCounts {
	const prompts: CharacterTokenRow[] = [];
	const greetings: CharacterTokenRow[] = [];
	for (const def of PERMANENT_TRAITS.character) {
		if (detailKeys.has(def.key)) continue;
		const row = { key: def.key, label: def.label, tokens: countTokens(traits[def.key] ?? '', model) };
		if (def.seedsChat) greetings.push(row);
		else prompts.push(row);
	}

	alternateGreetings.forEach((text, index) => greetings.push({
		key: `alternate-${index}`,
		label: `Alternate greeting ${index + 1}`,
		tokens: countTokens(text, model)
	}));

	const groups = [
		{ label: 'Base prompts', rows: prompts },
		{ label: 'Greetings', rows: greetings }
	];
	return { groups, total: groups.reduce((sum, group) => sum + group.rows.reduce((n, row) => n + row.tokens, 0), 0) };
}
