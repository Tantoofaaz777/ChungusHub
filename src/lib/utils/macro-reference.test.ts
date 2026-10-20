import { describe, expect, test } from 'bun:test';
import { MACROS, cappedHistoryTurns } from '$lib/macros';
import { resolveCardCbs } from '$lib/card-cbs';
import { macroToken, matchesMacro, TEMPLATE_MACROS } from './macro-reference';

describe('macro reference', () => {
	test('combines words across name and description, ignoring case and accents', () => {
		const macro = { name: 'user', description: 'Persona / protagonist name.' };
		expect(matchesMacro(macro, ' USER protagonist ')).toBe(true);
		expect(matchesMacro(macro, 'prótágonist')).toBe(true);
		expect(matchesMacro(macro, '{{user}}')).toBe(true);
		expect(matchesMacro(macro, 'user missing')).toBe(false);
		expect(matchesMacro(macro, '  ')).toBe(true);
	});

	test('finds both parameter shapes and the exact token being copied', () => {
		const macro = MACROS.find((macro) => macro.name === 'chatHistoryLastN')!;
		expect(matchesMacro(macro, 'chatHistoryLastN')).toBe(true);
		expect(matchesMacro(macro, '{{chatHistoryLast20}} transcript')).toBe(true);
		expect(macroToken(macro)).toBe('{{chatHistoryLast20}}');
		expect(macroToken({ name: 'char', description: '' })).toBe('{{char}}');
	});

	test('every copied parameterized spelling is accepted by its real parser', () => {
		for (const macro of MACROS.filter((macro) => macro.parameterized)) {
			const name = macro.example ?? macro.name;
			if (macro.name === 'chatHistoryLastN') {
				expect(cappedHistoryTurns(name)).toBe(20);
			} else {
				expect(resolveCardCbs(name, { rng: () => 0 })).toBeDefined();
			}
		}
	});

	test('template-only keys are searchable without reserving global macro names', () => {
		expect(TEMPLATE_MACROS.filter((macro) => matchesMacro(macro, 'steering wrapper')).map((macro) => macro.name))
			.toEqual(['steering']);
		for (const macro of TEMPLATE_MACROS) expect(MACROS.some((global) => global.name === macro.name)).toBe(false);
	});
});
