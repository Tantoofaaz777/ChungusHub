import type { PersonaPronouns } from '$lib/types/library';

export type PersonaPronounPresetId = 'she-her' | 'he-him' | 'they-them';

export interface PersonaPronounPreset {
	id: PersonaPronounPresetId;
	label: string;
	values: PersonaPronouns;
}

/** Ordered like the editor's preset menu. The neutral set is also the no-data fallback. */
export const PERSONA_PRONOUN_PRESETS: readonly PersonaPronounPreset[] = [
	{
		id: 'she-her',
		label: 'She / her',
		values: {
			subjective: 'she',
			objective: 'her',
			possessive: 'her',
			reflexive: 'herself',
			possessivePronoun: 'hers'
		}
	},
	{
		id: 'he-him',
		label: 'He / him',
		values: {
			subjective: 'he',
			objective: 'him',
			possessive: 'his',
			reflexive: 'himself',
			possessivePronoun: 'his'
		}
	},
	{
		id: 'they-them',
		label: 'They / them',
		values: {
			subjective: 'they',
			objective: 'them',
			possessive: 'their',
			reflexive: 'themself',
			possessivePronoun: 'theirs'
		}
	}
] as const;

export const DEFAULT_PERSONA_PRONOUNS: PersonaPronouns = PERSONA_PRONOUN_PRESETS[2].values;

const FIELDS: readonly (keyof PersonaPronouns)[] = [
	'subjective',
	'objective',
	'possessive',
	'reflexive',
	'possessivePronoun'
];

/** Fill absent or malformed fields from the neutral set while preserving explicit blanks. */
export function personaPronouns(value?: Partial<PersonaPronouns> | null): PersonaPronouns {
	const out = { ...DEFAULT_PERSONA_PRONOUNS };
	if (!value) return out;
	for (const field of FIELDS) {
		if (typeof value[field] === 'string') out[field] = value[field];
	}
	return out;
}

/** Preset selection is derived rather than stored, so editing any form makes it Custom. */
export function personaPronounPresetId(
	value?: Partial<PersonaPronouns> | null
): PersonaPronounPresetId | 'custom' {
	const resolved = personaPronouns(value);
	const preset = PERSONA_PRONOUN_PRESETS.find((candidate) =>
		FIELDS.every((field) => resolved[field].trim() === candidate.values[field])
	);
	return preset?.id ?? 'custom';
}

export function personaPronounPreset(id: string): PersonaPronouns | null {
	const preset = PERSONA_PRONOUN_PRESETS.find((candidate) => candidate.id === id);
	return preset ? { ...preset.values } : null;
}
