import { beforeAll, describe, expect, test } from 'bun:test';
import { prepareTokenizer } from '$lib/tokenizer/encodings';
import { expandMacros, isBuiltinMacro, referencedLorebookOutlets } from '$lib/macros';
import { assemblePrompt, buildMacroContext, type AssembleInput } from '$lib/utils/prompt-assembly';
import { resolveLorebooks } from './engine';
import { bookFingerprint } from './identity';
import { parseLorebook, toCharacterBook, toNativeWorldInfo } from './sillytavern';
import {
	createEmptyLorebook, createEmptyLorebookEntry,
	LOREBOOK_POSITION_OUTLET, lorebookOutletName, lorebookWasInjected, type LorebookEntry
} from './types';

beforeAll(async () => { await prepareTokenizer('gpt-4o'); });

function book(entries: Partial<LorebookEntry>[]) {
	return { ...createEmptyLorebook('Outlets'), entries: entries.map((entry) => ({
		...createEmptyLorebookEntry(), constant: true, ...entry
	})) };
}
const outlet = (content: string, outletName = 'places', extra: Partial<LorebookEntry> = {}): Partial<LorebookEntry> =>
	({ content, outletName, position: LOREBOOK_POSITION_OUTLET, ...extra });
const names = (...names: string[]) => new Set(names);
function prompt(templates: { content: string; enabled?: boolean }[], entries: Partial<LorebookEntry>[]): AssembleInput {
	return {
		preset: { id: 'p', name: 'Outlets', items: templates.map((item, i) => ({ id: String(i), role: 'user',
			enabled: true, ...item })), controls: [] },
		resolvedCharacters: [], resolvedPersona: null, lorebooks: [book(entries)], controls: [], customFields: {},
		chatMessages: [], recall: { text: null, archivedIds: new Set<string>() }, model: 'gpt-4o',
		postProcessing: { mode: 'none' }
	} as AssembleInput;
}

describe('exclusive lorebook outlets', () => {
	test('macro names normalize, missing outlets are empty, and prototype properties never leak', () => {
		const context = { lorebookOutlets: { places: 'Castle' } };
		expect(expandMacros('{{ OUTLET:: Places }} / {{outlet::missing}} / {{outlet::}}', context)).toBe('Castle /  / ');
		expect(expandMacros('{{outlet::toString}} / {{outlet::constructor}}', context)).toBe(' / ');
		expect(expandMacros('{{outlet:places}}', context)).toBe('{{outlet:places}}');
		expect(isBuiltinMacro('OUTLET::places')).toBe(true);
		expect(referencedLorebookOutlets(['{{outlet::Places}} {{outlet:: places }} {{outlet::}} {{other}}'])).toEqual(names('places'));
	});

	test('same outlet merges across books, in insertion order, with exactly two newlines', () => {
		const result = resolveLorebooks({ books: [book([outlet('  Third  ', ' Places ', { order: 300 }),
			outlet('First', 'PLACES', { order: 100 }), { content: 'Regular lore', order: 50 }]),
			book([outlet('Second', 'places', { order: 200 })])], messages: [], outletNames: names('places'), placeAtDepth: true });
		expect(result.outlets).toEqual({ places: 'First\n\nSecond\n\nThird' });
		expect(result.text).toBe('Regular lore');
		expect(result.placed).toEqual([]);
		expect(result.trace.records.filter((record) => record.outlet === 'places')).toHaveLength(3);
	});

	test('activation rules still apply, and an outlet name on a regular entry does not duplicate it', () => {
		const result = resolveLorebooks({ books: [book([
			outlet('Matched', 'places', { constant: false, key: ['castle'] }),
			outlet('Unmatched', 'places', { constant: false, key: ['dragon'] }),
			outlet('Disabled', 'places', { disable: true }),
			outlet('Only swipe', 'places', { triggers: ['swipe'] }),
			{ content: 'Regular', outletName: 'places' }
		])], messages: ['castle'], outletNames: names('places') });
		expect(result.outlets.places).toBe('Matched');
		expect(result.text).toBe('Regular');
	});

	test('missing names and unreferenced outlets have no fallback and spend no lore budget', () => {
		const result = resolveLorebooks({ books: [book([
			outlet('Unreferenced, far too long', 'unused', { order: 1 }),
			outlet('Unnamed, far too long', '  ', { order: 2 }),
			{ content: 'Lore', order: 3 }, outlet('A', 'places', { order: 4 })
		])], messages: [], outletNames: names('places'), budget: { maxTokens: 5, count: (text) => text.length } });
		expect(result.text).toBe('Lore');
		expect(result.outlets).toEqual({ places: 'A' });
		const unused = result.trace.records.filter((record) => record.status === 'outletUnused');
		expect(unused).toHaveLength(2);
		expect(unused.every((record) => !lorebookWasInjected(record.status))).toBe(true);
	});

	test('outlets share the budget with normal lore, counting separators only inside each destination', () => {
		const result = resolveLorebooks({ books: [book([
			outlet('aa', 'places', { order: 1 }), outlet('bb', 'places', { order: 2 }),
			outlet('c', 'people', { order: 3 }), { content: 'd', order: 4 }
		])], messages: [], outletNames: names('places', 'people'), budget: { maxTokens: 5, count: (text) => text.length } });
		expect(result.outlets).toEqual({ places: 'aa', people: 'c' });
		expect(result.text).toBe('d');
		expect(result.trace.records.find((record) => record.status === 'trimmed')?.outlet).toBeUndefined();
		expect(result.trace.records.filter((record) => record.status === 'trimmed')).toHaveLength(1);
	});

	test('prototype-like names are valid own destinations', () => {
		const result = resolveLorebooks({ books: [book([outlet('Safe', '__proto__')])], messages: [], outletNames: names('__proto__') });
		expect(expandMacros('{{outlet::__proto__}}', { lorebookOutlets: result.outlets })).toBe('Safe');
		expect(Object.getPrototypeOf(result.outlets)).toBe(Object.prototype);
	});

	test('old persisted names in rest work, but explicitly clearing the name stays empty', () => {
		const entry = { ...createEmptyLorebookEntry(), rest: { outletName: ' Old ' } };
		expect(lorebookOutletName(entry)).toBe('old');
		expect(lorebookOutletName({ ...entry, outletName: '' })).toBe('');
	});

	test('different outlet destinations cannot be deduplicated as the same imported book', () => {
		expect(bookFingerprint(book([outlet('Same', 'places')]))).not.toBe(bookFingerprint(book([outlet('Same', 'people')])));
		expect(bookFingerprint(book([outlet('Same')]))).not.toBe(bookFingerprint(book([{ content: 'Same' }])));
	});
});

describe('outlets in the real prompt assembly', () => {
	test('only enabled, explicit references insert lore, at the chosen role and location', () => {
		const input = prompt([{ content: 'Before {{outlet::Places}} after.' }, { content: '{{lorebook}}' },
			{ content: '{{outlet::unused}}', enabled: false }], [outlet('Castle'), outlet('Do not insert', 'unused'), { content: 'Normal' }]);
		const result = assemblePrompt(input);
		expect(result.messages).toEqual([{ role: 'user', content: 'Before Castle after.' }, { role: 'user', content: 'Normal' }]);
		expect(result.lorebook.records.find((record) => record.status === 'outletUnused')).toBeDefined();
		expect(result.breakdown.total).toBe(result.breakdown.preset + result.breakdown.context + result.breakdown.memory + result.breakdown.chat);
	});

	test('unreferenced and unnamed outlets change neither the prompt nor its token counts', () => {
		const input = prompt([{ content: 'Rules. {{lorebook}}' }], [outlet('Secret'), outlet('Unnamed', ''), { content: 'Normal' }]);
		const actual = assemblePrompt(input);
		const expected = assemblePrompt({ ...input, lorebooks: [book([{ content: 'Normal' }])] });
		expect(actual.messages).toEqual(expected.messages);
		expect(actual.breakdown).toEqual(expected.breakdown);
	});

	test('unknown and inactive outlets resolve empty and participate in empty-block pruning', () => {
		const input = prompt([{ content: 'Rules. <places>{{outlet::places}}</places>' }], [outlet('Hidden', 'places', { disable: true })]);
		input.preset!.pruneEmptyBlocks = true;
		expect(assemblePrompt(input).messages).toEqual([{ role: 'user', content: 'Rules.' }]);
	});

	test('normal engine macros expand in entries, but an outlet does not recursively inject other outlets', () => {
		const input = prompt([{ content: '{{outlet::places}}' }], [outlet('A {{char}} {{outlet::people}}'), outlet('NPC', 'people')]);
		input.resolvedCharacters = [{ name: 'Hermione', traits: {} }];
		expect(assemblePrompt(input).messages).toEqual([{ role: 'user', content: 'A Hermione' }]);
	});

	test('context trimming reuses the resolved outlets, without changing their activation or losing attribution', () => {
		const input = prompt([{ content: '{{outlet::places}}' }, { content: '{{chatHistory}}' }], [outlet('Castle')]);
		input.chatMessages = [{ id: 'old', role: 'user', content: 'Long old context. '.repeat(100) },
			{ id: 'new', role: 'user', content: 'Latest turn' }] as AssembleInput['chatMessages'];
		input.contextBudget = 24;
		const result = assemblePrompt(input);
		expect(result.trimmedMessages).toBeGreaterThan(0);
		expect(result.messages.some((message) => message.content === 'Castle')).toBe(true);
		expect(result.breakdown.total).toBe(result.breakdown.preset + result.breakdown.context + result.breakdown.memory + result.breakdown.chat);
	});

	test('optional card lore shedding retains required outlets without rescanning', () => {
		const input = prompt([{ content: '{{outlet::places}}' }], [outlet('Required'),
			outlet('Optional', 'places', { v3Runtime: { ignoreOnMaxContext: true } })]);
		const context = buildMacroContext(input);
		expect(context.lorebookOutlets?.places).toBe('Required\n\nOptional');
		expect(context.withoutOptionalLore?.().lorebookOutlets?.places).toBe('Required');
	});
});

describe('outlet interchange', () => {
	test('native and embedded card exports retain the destination and the editable name', () => {
		const original = book([outlet('Castle', ' Places ')]);
		for (const serialized of [toNativeWorldInfo(original), toCharacterBook(original)]) {
			const imported = parseLorebook(JSON.parse(JSON.stringify(serialized)), 'Imported');
			expect(imported.entries[0].position).toBe(LOREBOOK_POSITION_OUTLET);
			expect(imported.entries[0].outletName).toBe(' Places ');
			expect(imported.entries[0].rest.outletName).toBeUndefined();
			expect(lorebookOutletName(imported.entries[0])).toBe('places');
		}
	});

	test('legacy names in rest export correctly, and clearing them overrides the preserved original', () => {
		const original = book([outlet('Castle')]);
		original.entries[0].outletName = undefined;
		original.entries[0].rest.outletName = 'old';
		expect(parseLorebook(toCharacterBook(original), 'Imported').entries[0].outletName).toBe('old');
		original.entries[0].outletName = '';
		for (const serialized of [toNativeWorldInfo(original), toCharacterBook(original)]) {
			expect(parseLorebook(serialized, 'Imported').entries[0].outletName).toBe('');
		}
	});
});
