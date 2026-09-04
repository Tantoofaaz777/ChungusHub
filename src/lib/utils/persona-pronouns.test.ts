import { describe, expect, test } from 'bun:test';
import { expandMacros } from '$lib/macros';

import {
	DEFAULT_PERSONA_PRONOUNS,
	PERSONA_PRONOUN_PRESETS,
	personaPronouns,
	personaPronounPreset,
	personaPronounPresetId
} from './persona-pronouns';

describe('persona pronoun presets', () => {
	test('ships the three complete sets in editor order', () => {
		expect(PERSONA_PRONOUN_PRESETS.map((preset) => preset.label)).toEqual([
			'She / her',
			'He / him',
			'They / them'
		]);
		expect(personaPronounPreset('she-her')).toEqual({
			subjective: 'she',
			objective: 'her',
			possessive: 'her',
			reflexive: 'herself',
			possessivePronoun: 'hers'
		});
		expect(personaPronounPreset('he-him')).toEqual({
			subjective: 'he',
			objective: 'him',
			possessive: 'his',
			reflexive: 'himself',
			possessivePronoun: 'his'
		});
		expect(personaPronounPreset('they-them')).toEqual(DEFAULT_PERSONA_PRONOUNS);
	});

	test('an existing persona with no data reads as singular they', () => {
		expect(personaPronouns()).toEqual({
			subjective: 'they',
			objective: 'them',
			possessive: 'their',
			reflexive: 'themself',
			possessivePronoun: 'theirs'
		});
		expect(personaPronounPresetId()).toBe('they-them');
	});

	test('missing malformed fields fall back while an explicit blank stays blank', () => {
		expect(
			personaPronouns({ subjective: 'xe', objective: 7 as unknown as string, reflexive: '' })
		).toEqual({
			subjective: 'xe',
			objective: 'them',
			possessive: 'their',
			reflexive: '',
			possessivePronoun: 'theirs'
		});
	});

	test('the menu derives a preset until any real value becomes custom', () => {
		expect(personaPronounPresetId(personaPronounPreset('she-her'))).toBe('she-her');
		expect(personaPronounPresetId({ ...DEFAULT_PERSONA_PRONOUNS, subjective: 'xe' })).toBe(
			'custom'
		);
		expect(personaPronounPresetId({ ...DEFAULT_PERSONA_PRONOUNS, subjective: ' they ' })).toBe(
			'they-them'
		);
	});

	test('an unknown preset changes nothing', () => {
		expect(personaPronounPreset('custom')).toBeNull();
		expect(personaPronounPreset('unknown')).toBeNull();
	});
});

describe('persona pronoun macros', () => {
	test('resolves every JanitorAI-compatible form from the active persona', () => {
		const resolvedPersona = {
			name: 'Avery',
			traits: {},
			pronouns: {
				subjective: 'xe',
				objective: 'xem',
				possessive: 'xyr',
				reflexive: 'xemself',
				possessivePronoun: 'xyrs'
			}
		};
		expect(
			expandMacros('{{sub}} / {{obj}} / {{poss}} / {{ref}} / {{poss_p}}', {
				resolvedPersona
			})
		).toBe('xe / xem / xyr / xemself / xyrs');
	});

	test('an existing persona with no pronoun data uses the neutral set', () => {
		expect(
			expandMacros('{{sub}} / {{obj}} / {{poss}} / {{ref}} / {{poss_p}}', {
				resolvedPersona: { name: 'Avery', traits: {} }
			})
		).toBe('they / them / their / themself / theirs');
	});

	test('pronouns resolve inside persona and character fields instead of staying nested', () => {
		const resolvedPersona = {
			name: 'Mara',
			traits: { description: '{{sub}} trusts {{ref}}.' },
			pronouns: {
				subjective: 'she',
				objective: 'her',
				possessive: 'her',
				reflexive: 'herself',
				possessivePronoun: 'hers'
			}
		};
		const resolvedCharacters = [
			{ name: 'Lila', traits: { description: '{{poss}} compass belongs to {{obj}}.' } }
		];
		expect(expandMacros('{{persona}}', { resolvedPersona })).toBe('she trusts herself.');
		expect(expandMacros('{{character}}', { resolvedPersona, resolvedCharacters })).toContain(
			'**Description:** her compass belongs to her.'
		);
	});

	test('without a persona the engine-owned forms resolve empty', () => {
		expect(expandMacros('A{{sub}}B{{obj}}C{{poss}}D{{ref}}E{{poss_p}}F', {})).toBe('ABCDEF');
	});
});
