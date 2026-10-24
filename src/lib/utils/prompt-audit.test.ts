import { beforeAll, expect, test } from 'bun:test';
import { prepareTokenizer } from '$lib/tokenizer/encodings';
import { countTokens } from '$lib/tokenizer/count';
import { expandMacros, pruneEmptyTagBlocks, substitute } from '$lib/macros';
import { createEmptyLorebook, createEmptyLorebookEntry, LOREBOOK_POSITION_AT_DEPTH } from '$lib/lorebook/types';
import { applyPostProcessing, assemblePrompt, type AssembleInput } from './prompt-assembly';

beforeAll(() => Promise.all([prepareTokenizer('gpt-4o'), prepareTokenizer('gpt-4')]));
const turn = (id: string, content: string) => ({ id, role: 'user' as const, content, parentId: null });
const history = [turn('old', 'An older event in the castle.'), turn('new', 'The current event.')];
function fixture(templates: string[], extra: Partial<AssembleInput> = {}): AssembleInput {
	return { preset: { id: 'audit', name: 'Audit', controls: [], items: templates.map((content, i) => ({ id: `${i}`, content, role: 'system', enabled: true })) } as any,
		resolvedCharacters: [], resolvedPersona: null, lorebooks: [], controls: [], customFields: {}, chatMessages: history as any,
		recall: { text: null, archivedIds: new Set() }, model: 'gpt-4o', postProcessing: { mode: 'none' }, ...extra };
}

for (const macro of ['{{ CHATHISTORY }}', '{{chatHistory }}', '{{ chathistory}}', '{{\nchatHistory\n}}']) {
	test(`structural history accepts the same spelling variations as inline macros: ${JSON.stringify(macro)}`, () => {
		const book = createEmptyLorebook('Depth');
		book.entries = [{ ...createEmptyLorebookEntry(), constant: true, position: LOREBOOK_POSITION_AT_DEPTH, depth: 1, content: 'World detail' }];
		const expected = assemblePrompt(fixture(['{{chatHistory}}'], { lorebooks: [book] }));
		const actual = assemblePrompt(fixture([macro], { lorebooks: [book] }));
		expect(actual.messages).toEqual(expected.messages);
		expect(actual.lorebook).toEqual(expected.lorebook);
	});
}

test('memory macro spelling does not change archived history or token attribution', () => {
	const recall = { text: 'Previously summarized.', archivedIds: new Set(['old']) };
	const expected = assemblePrompt(fixture(['{{memory}}', '{{chatHistory}}'], { recall }));
	const actual = assemblePrompt(fixture(['{{ memory }}', '{{chatHistory}}'], { recall }));
		expect(actual.messages).toEqual(expected.messages);
		expect(actual.breakdown.memory).toBe(expected.breakdown.memory);
});

test('example dialogue with a case/space variant is trimmed before history', () => {
	const options = fixture(['Rules.', '{{ MESEXAMPLES }}', '{{chatHistory}}'], {
		resolvedCharacters: [{ name: 'Aria', traits: { exampleDialogue: '<START>\n' + 'Old sample '.repeat(40) + '\n<START>\n' + 'New sample '.repeat(40) } }]
	});
	const withoutExamples = assemblePrompt({ ...options, resolvedCharacters: [] });
	const result = assemblePrompt({ ...options, contextBudget: withoutExamples.breakdown.total });
		expect(result.trimmedExampleBlocks).toBe(2); expect(result.trimmedMessages).toBe(0);
		expect(result.messages).toEqual(withoutExamples.messages); expect(result.overBudget).toBe(false);
});

for (const name of ['Alexandra '.repeat(30).trim(), 'A']) {
	test(`context trimming prices expanded identities (${name.length} characters)`, () => {
		const chatMessages = [turn('old', '{{user}} '.repeat(30)), turn('new', '{{user}} waits.')];
		const options = fixture(['Rules.', '{{chatHistory}}'], { chatMessages: chatMessages as any, resolvedPersona: { name, traits: {} } });
		const newestOnly = assemblePrompt({ ...options, chatMessages: chatMessages.slice(1) as any });
		const result = assemblePrompt({ ...options, contextBudget: newestOnly.breakdown.total });
		expect(result.messages).toEqual(newestOnly.messages); expect(result.trimmedMessages).toBe(1);
		expect(result.overBudget).toBe(false);
	});
}

test('a repeated history macro is priced for each insertion when choosing retained turns', () => {
	const options = fixture(['Rules.', '{{chatHistory}}', '{{chatHistory}}']);
	const newestOnly = assemblePrompt({ ...options, chatMessages: history.slice(1) as any });
	const result = assemblePrompt({ ...options, contextBudget: newestOnly.breakdown.total });
		expect(result.messages).toEqual(newestOnly.messages); expect(result.trimmedMessages).toBe(1);
		expect(result.overBudget).toBe(false);
});

test('repeated history also prices every copy of its depth steering', () => {
	const result = assemblePrompt(fixture(['{{chatHistory}}', '{{chatHistory}}'], {
		steering: { notes: [{ text: 'Direction.', depth: 0, role: 'system' }], wrapper: '{{steering}}' }
	}));
	const copies = result.messages.filter(message => message.content === 'Direction.');
		expect(copies).toHaveLength(2);
		expect(result.breakdown.context).toBe(2 * countTokens('Direction.', 'gpt-4o'));
});

for (const preset of [null, { id: 'empty', items: [] } as any, { id: 'blank', items: [{ id: 'x', role: 'system', enabled: true, content: '{{persona}}' }] } as any]) {
	test(`fallback prompts still report an exceeded budget (${preset?.id ?? 'none'})`, () => {
		const result = assemblePrompt(fixture([], { preset, contextBudget: 1 }));
		expect(result.breakdown.total).toBeGreaterThan(1); expect(result.overBudget).toBe(true);
	});
}

test('strict role demotion preserves attached images', () => {
	const messages = [{ role: 'user' as const, content: 'Read this.' }, { role: 'system' as const, content: 'Attached.', images: ['images/chat/a.png'] }];
	for (const mode of ['semi-strict', 'strict'] as const) {
		const result = applyPostProcessing(messages, mode);
		expect(result.flatMap(message => message.images ?? [])).toEqual(['images/chat/a.png']);
	}
});

test('unknown macros named like Object properties stay literal', () => {
	for (const name of ['constructor', 'toString', '__proto__', 'valueOf']) {
		const template = `{{${name}}}`;
		expect(substitute(template, {})).toBe(template);
		expect(expandMacros(template, {})).toBe(template);
		expect(expandMacros(template, { resolvedCharacters: [{ name: 'Aria', traits: {} }] })).toBe(template);
		expect(pruneEmptyTagBlocks(`<context>${template}</context>`, {})).toBe(`<context>${template}</context>`);
	}
});

test('history removed before an empty-prompt fallback is still reported as trimmed', () => {
	const result = assemblePrompt(fixture(['{{chatHistory}}'], { contextBudget: 1 }));
		expect(result.trimmedMessages).toBe(history.length); expect(result.overBudget).toBe(true);
});

test('fallback counts use the connection model encoding', () => {
	const result = assemblePrompt(fixture([], { preset: null, model: 'gpt-4' }));
	const sent = result.messages.reduce((sum, message) => sum + countTokens(message.content, 'gpt-4'), 0);
	const resultWithBudget = assemblePrompt(fixture([], { preset: null, model: 'gpt-4', contextBudget: sent }));
		expect(result.breakdown.total).toBe(sent); expect(resultWithBudget.overBudget).toBe(false);
});

test('every occurrence of at-depth lore is counted when history repeats', () => {
	const book = createEmptyLorebook('Depth');
	book.entries = [{ ...createEmptyLorebookEntry(), constant: true, position: LOREBOOK_POSITION_AT_DEPTH, content: 'World detail' }];
	const result = assemblePrompt(fixture(['{{chatHistory}}', '{{chatHistory}}'], { lorebooks: [book] }));
		expect(result.messages.filter(message => message.content === 'World detail')).toHaveLength(2);
		expect(result.breakdown.context).toBe(2 * countTokens('World detail', 'gpt-4o'));
});
