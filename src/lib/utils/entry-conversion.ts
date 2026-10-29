/**
 * Folding a character sheet into the one free-text field a persona has.
 *
 * A persona is a single description placed verbatim by {{persona}}, so a character's
 * ten fields have to become one piece of prose. Only the fields that describe the
 * person travel: the scene, the opening, the example dialogue and the card metadata
 * belong to a character being played by the AI, not to the protagonist being played
 * by the reader.
 */
import {
	PERMANENT_TRAITS,
	type CharacterTraits,
	type LibraryEntryType,
	type TraitKey
} from '#lib/types/library.ts';

/**
 * How the action reads in a menu, keyed by the kind being converted FROM. One place, so the
 * editor's overflow menu and every browse card's menu cannot word the same act differently.
 * The icon is the target kind's own: the Personas tab's, or the Characters tab's.
 */
export const CONVERT_ACTION: Record<LibraryEntryType, { label: string; icon: 'user' | 'users' }> = {
	character: { label: 'Save as persona…', icon: 'user' },
	persona: { label: 'Save as character…', icon: 'users' }
};

/** The character fields that describe a person, in the order they are folded. */
export const PERSONA_FOLD_KEYS: TraitKey[] = ['description', 'personality'];

function labelFor(key: TraitKey): string {
	const def = PERMANENT_TRAITS.character.find((candidate) => candidate.key === key);
	if (!def) throw new Error(`No permanent character trait named "${key}".`);
	return def.label;
}

/**
 * The persona description a character amounts to. Empty fields are skipped, so a card
 * that only carries a description folds to exactly that text: a lone heading above a
 * single block is noise the reader would have to delete.
 */
export function personaDescriptionFromCharacter(traits: CharacterTraits): string {
	const blocks = PERSONA_FOLD_KEYS.map((key) => ({ key, text: (traits[key] ?? '').trim() })).filter(
		(block) => block.text.length > 0
	);
	if (blocks.length === 0) return '';
	if (blocks.length === 1) return blocks[0].text;
	return blocks.map((block) => `${labelFor(block.key)}:\n${block.text}`).join('\n\n');
}
