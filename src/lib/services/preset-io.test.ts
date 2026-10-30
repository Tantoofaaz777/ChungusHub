import { describe, expect, test } from 'bun:test';
import { parsePresetJson, serializePresetJson } from './preset-io';
import { DEFAULT_EXAMPLE_SEPARATOR } from '#lib/macros.ts';
import { DEFAULT_CONTINUE_PROMPT } from '#lib/utils/prompt-assembly.ts';

const bare = (over: Record<string, unknown> = {}) => ({
	id: 'p',
	name: 'P',
	items: [],
	controls: [],
	...over
});

describe('preset JSON interchange', () => {
	test('depth, roles and preset order survive JSON export and reimport', () => {
		const items = [
			{ id: 'a', name: 'A', role: 'system' as const, content: 'Rules.', enabled: true },
			{ id: 'b', name: 'B', role: 'user' as const, content: 'Hint.', enabled: true, depth: 0 },
			{ id: 'c', name: 'C', role: 'assistant' as const, content: '{{authorsNote}}', enabled: false, depth: 25 }
		];
		const exported = serializePresetJson({ name: 'Depth', items, controls: [] });
		const imported = parsePresetJson(exported);
		expect(imported.items.map(({ id, ...body }) => body)).toEqual(items.map(({ id, ...body }) => body));
		expect(imported.items.map(item => item.id)).not.toEqual(items.map(item => item.id));
		expect(JSON.parse(exported).items[0]).not.toHaveProperty('depth');
	});

	test('rejects invalid depths and depth on a structural history container', () => {
		for (const depth of [-1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) {
			expect(() => parsePresetJson(JSON.stringify(bare({ items: [{ content: 'Rules.', depth }] })))).toThrow('depth');
		}
		expect(() => parsePresetJson(JSON.stringify(bare({ items: [{ content: '<chat>{{ CHATHistory }}</chat>', depth: 0 }] })))).toThrow('preset order');
	});

	test('legacy item notes are accepted on import and omitted from exports', () => {
		const legacyItem = { id: 'old', name: 'System', role: 'system' as const, content: 'Write a story.', enabled: true, note: 'Old annotation' };
		const legacy = bare({ items: [legacyItem] });
		const imported = parsePresetJson(JSON.stringify(legacy));
		expect(imported.items[0].content).toBe(legacyItem.content);
		expect('note' in imported.items[0]).toBe(false);
		expect(JSON.parse(serializePresetJson(legacy)).items).toEqual([
			{ name: 'System', role: 'system', content: 'Write a story.', enabled: true }
		]);
		expect(legacyItem.note).toBe('Old annotation');
	});

	test('round-trips controls and preset-level behavior without runtime item ids', () => {
		const json = serializePresetJson({
			id: 'source',
			name: 'Focused prose',
			items: [{ id: 'runtime-only', name: 'System', role: 'system', content: '{{tone}}', enabled: true }],
			controls: [
				{
					id: 'tone-control',
					macro: 'tone',
					label: 'Tone',
					type: 'select',
					options: [{ id: 'warm', label: 'Warm', injectedText: 'Write warmly.' }],
					defaultOptionId: 'warm'
				}
			],
			pruneEmptyBlocks: true
		});

		expect(json).not.toContain('runtime-only');
		const imported = parsePresetJson(json);
		expect(imported.name).toBe('Focused prose');
		expect(imported.items[0]?.content).toBe('{{tone}}');
		expect(imported.controls[0]?.options?.[0]?.injectedText).toBe('Write warmly.');
		expect(imported.pruneEmptyBlocks).toBe(true);
	});

	test('an export names every per-preset field, defaults included', () => {
		// The bug this guards: a preset riding the shipped defaults exported JSON with no
		// continuePrompt / exampleSeparator key at all, so the fields read as ones the
		// preset does not own, and nobody could learn they exist from the JSON.
		const parsed = JSON.parse(serializePresetJson(bare()));
		expect(parsed.continuePrompt).toBe(DEFAULT_CONTINUE_PROMPT);
		expect(parsed.exampleSeparator).toBe(DEFAULT_EXAMPLE_SEPARATOR);
		expect(parsed.pruneEmptyBlocks).toBe(false);
	});

	test('overridden values export verbatim, empty string included', () => {
		const parsed = JSON.parse(serializePresetJson(bare({ continuePrompt: '', exampleSeparator: '' })));
		expect(parsed.continuePrompt).toBe('');
		expect(parsed.exampleSeparator).toBe('');
		// Empty is a real choice (no instruction / no header line), so it must survive import.
		const imported = parsePresetJson(JSON.stringify(parsed));
		expect(imported.continuePrompt).toBe('');
		expect(imported.exampleSeparator).toBe('');
	});

	test('importing a shipped default stores no override, so the preset keeps tracking it', () => {
		const imported = parsePresetJson(serializePresetJson(bare()));
		expect(imported.continuePrompt).toBeUndefined();
		expect(imported.exampleSeparator).toBeUndefined();
	});

	test('a real continue override survives the round trip', () => {
		const imported = parsePresetJson(serializePresetJson(bare({ continuePrompt: 'Keep going, {{char}}.' })));
		expect(imported.continuePrompt).toBe('Keep going, {{char}}.');
	});

	test('rejects unknown roles instead of silently changing prompt semantics', () => {
		expect(() =>
			parsePresetJson(JSON.stringify({ name: 'Bad', items: [{ role: 'developer', content: 'x' }] }))
		).toThrow('unknown role');
	});

	test('names a SillyTavern preset in the refusal rather than reporting a broken file', () => {
		// The one wrong file people bring here on purpose. A parse error about "items" sends
		// them looking for a fault in a file that has none.
		expect(() => parsePresetJson(JSON.stringify({ name: 'ST', prompts: [], prompt_order: [] }))).toThrow(
			'SillyTavern preset'
		);
		expect(() => parsePresetJson(JSON.stringify({ name: 'Junk' }))).toThrow('not a ChungusHub preset');
	});
});
