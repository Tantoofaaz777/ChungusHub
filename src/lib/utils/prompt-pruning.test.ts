import { beforeAll } from 'bun:test';
import { prepareTokenizer } from '#lib/tokenizer/encodings.ts';
beforeAll(async () => { await Promise.all([prepareTokenizer(), prepareTokenizer('gpt-4')]); });

/**
 * Tests for tag-block pruning: preserve text and remove empty macro blocks. Run with `bun test`.
 *
 * The unit half locks the pruning rules on `pruneEmptyTagBlocks` directly; the integration
 * half proves the behavior through `resolveItem`/`assemblePrompt`, i.e. what generation,
 * the token meters, and the Prompt Builder preview actually see, including the invariant
 * that the token buckets still sum to what is really sent after pruning.
 */

import { describe, expect, test } from 'bun:test';

import { pruneEmptyTagBlocks } from '#lib/macros.ts';
import { assemblePrompt, resolveItem, buildMacroContext, type AssembleInput } from './prompt-assembly';
import { countTokens } from '#lib/tokenizer/count.ts';

const MODEL = 'gpt-4o';

/* eslint-disable @typescript-eslint/no-explicit-any */
function item(content: string, opts: { id?: string; role?: string; enabled?: boolean } = {}): any {
	return { id: opts.id ?? content, role: opts.role ?? 'system', content, enabled: opts.enabled ?? true };
}

// Pruning is a per-preset opt-in; these tests exercise it, so the helper opts in.
function preset(items: any[], extra: Record<string, unknown> = {}): any {
	return { id: 'p', name: 'p', items, controls: [], pruneEmptyBlocks: true, ...extra };
}

function msg(id: string, role: string, content: string): any {
	return { id, role, content, parentId: null };
}

function input(p: any, over: Partial<AssembleInput> = {}): AssembleInput {
	return {
		preset: p,
		resolvedCharacters: [],
		resolvedPersona: null,
		lorebooks: [],
		controls: [],
		customFields: {},
		chatMessages: [],
		recall: { text: null, archivedIds: new Set<string>() },
		model: MODEL,
		...over
	} as AssembleInput;
}

// ===== Unit: pruneEmptyTagBlocks =====

describe('pruneEmptyTagBlocks: core rules', () => {
	test('block wrapping only an empty macro is pruned', () => {
		expect(pruneEmptyTagBlocks('<memory>\n{{memory}}\n</memory>', { memory: '' })).toBe('');
	});

	test('block wrapping a non-empty macro is kept, template untouched', () => {
		const text = '<memory>\n{{memory}}\n</memory>';
		expect(pruneEmptyTagBlocks(text, { memory: 'Alice owes Bob.' })).toBe(text);
	});

	test('whitespace-only value counts as empty', () => {
		expect(pruneEmptyTagBlocks('<x>{{a}}</x>', { a: '  \n ' })).toBe('');
	});

	test('static text inside the block survives an empty macro', () => {
		const text = '<memory>\nTreat this as canon:\n{{memory}}\n</memory>';
		expect(pruneEmptyTagBlocks(text, { memory: '' })).toBe(text);
	});

	test('static text survives when all surrounding macros are empty', () => {
		const text = '<rules>{{a}}\nKeep this rule.\n{{b}}</rules>';
		expect(pruneEmptyTagBlocks(text, { a: '', b: ' \n ' })).toBe(text);
	});

	test('a block containing only empty macros is pruned', () => {
		expect(pruneEmptyTagBlocks('<rules>{{a}}\n{{b}}</rules>', { a: '', b: ' \n ' })).toBe('');
	});

	test('framing survives when any of the block\'s own macros is non-empty', () => {
		const text = '<pair>{{a}} and {{b}}</pair>';
		expect(pruneEmptyTagBlocks(text, { a: '', b: 'kept' })).toBe(text);
	});

	test('static-only blocks are never pruned, even empty ones', () => {
		expect(pruneEmptyTagBlocks('<sep></sep>', {})).toBe('<sep></sep>');
		expect(pruneEmptyTagBlocks('<note>fixed text</note>', {})).toBe('<note>fixed text</note>');
	});

	test('unknown macro name keeps its block alive so the typo stays visible', () => {
		const text = '<memory>{{memroy}}</memory>';
		expect(pruneEmptyTagBlocks(text, { memory: '' })).toBe(text);
	});

	test('a known-empty macro beside an unknown one does not kill the block', () => {
		const text = '<x>{{a}} {{unknown_name}}</x>';
		expect(pruneEmptyTagBlocks(text, { a: '' })).toBe(text);
	});
});

describe('pruneEmptyTagBlocks: nesting and cascade', () => {
	const BIBLE =
		'<story_bible>\n\n<character>\n{{character}}\n</character>\n\n<protagonist>\n{{persona}}\n</protagonist>\n\n</story_bible>';

	test('empty children prune individually while siblings survive', () => {
		const out = pruneEmptyTagBlocks(BIBLE, { character: 'Alice, a thief.', persona: '' });
		expect(out).toContain('<character>');
		expect(out).toContain('{{character}}');
		expect(out).not.toContain('<protagonist>');
		expect(out).toContain('</story_bible>');
	});

	test('outer wrapper cascades out after all children prune', () => {
		expect(pruneEmptyTagBlocks(BIBLE, { character: '', persona: '' })).toBe('');
	});

	test('parent static content survives an empty child block', () => {
		const text = '<direction>\n- Fixed rule one.\n<themes>\n{{themes}}\n</themes>\n- Fixed rule two.\n</direction>';
		const out = pruneEmptyTagBlocks(text, { themes: '' });
		expect(out).toContain('Fixed rule one.');
		expect(out).toContain('Fixed rule two.');
		expect(out).not.toContain('<themes>');
	});

	test('parent static content survives empty own macros and pruned children together', () => {
		const text = '<rules>{{a}}\nKeep this rule.\n<optional>{{b}}</optional>\n</rules>';
		expect(pruneEmptyTagBlocks(text, { a: '', b: '' })).toBe('<rules>{{a}}\nKeep this rule.\n\n</rules>');
	});

	test('a surviving child vetoes pruning even when the parent\'s own macros are empty', () => {
		const text = '<outer>{{a}}<inner>{{b}}</inner></outer>';
		const out = pruneEmptyTagBlocks(text, { a: '', b: 'kept' });
		expect(out).toContain('<inner>{{b}}</inner>');
		expect(out).toContain('<outer>');
	});

	test('same-name nested tags pair by depth', () => {
		const text = '<box>{{a}}<box>{{b}}</box></box>';
		const out = pruneEmptyTagBlocks(text, { a: 'x', b: '' });
		expect(out).toBe('<box>{{a}}</box>');
	});
});

describe('pruneEmptyTagBlocks: non-blocks are left alone', () => {
	test('unmatched open tag is plain text', () => {
		const text = 'Values below 5 <threshold> stay {{a}}';
		expect(pruneEmptyTagBlocks(text, { a: '' })).toBe(text);
	});

	test('stray close tag is plain text', () => {
		const text = 'closing </memory> alone {{a}}';
		expect(pruneEmptyTagBlocks(text, { a: '' })).toBe(text);
	});

	test('tags with attributes or self-closing tags do not form blocks', () => {
		const withAttr = '<tag attr="x">{{a}}</tag>';
		expect(pruneEmptyTagBlocks(withAttr, { a: '' })).toBe(withAttr);
		const selfClosing = 'line <br/> {{a}}';
		expect(pruneEmptyTagBlocks(selfClosing, { a: '' })).toBe(selfClosing);
	});

	test('text without any tags passes through untouched', () => {
		const text = 'no tags here, just {{a}}';
		expect(pruneEmptyTagBlocks(text, { a: '' })).toBe(text);
	});
});

describe('pruneEmptyTagBlocks: whitespace hygiene', () => {
	test('pruned blocks do not leave gaps behind', () => {
		const text = 'Before.\n\n<memory>\n{{memory}}\n</memory>\n\nAfter.';
		expect(pruneEmptyTagBlocks(text, { memory: '' })).toBe('Before.\n\nAfter.');
	});

	test('a pruned leading block leaves no leading whitespace', () => {
		const text = '<memory>\n{{memory}}\n</memory>\n\nRules follow.';
		expect(pruneEmptyTagBlocks(text, { memory: '' })).toBe('Rules follow.');
	});
});

// ===== Integration: resolveItem / assemblePrompt =====

describe('pruning is a per-preset opt-in', () => {
	test('without the flag, templates expand exactly as written, empty tags and all', () => {
		const p = preset([item('<memory>\n{{memory}}\n</memory>')], { pruneEmptyBlocks: false });
		const a = assemblePrompt(input(p));
		expect(a.messages).toHaveLength(1);
		expect(a.messages[0].content).toBe('<memory>\n\n</memory>');
	});

	test('an absent flag behaves like off', () => {
		const p = preset([item('<memory>\n{{memory}}\n</memory>')]);
		delete p.pruneEmptyBlocks;
		const a = assemblePrompt(input(p));
		expect(a.messages).toHaveLength(1);
		expect(a.messages[0].content).toContain('<memory>');
	});
});

describe('pruning through resolveItem', () => {
	test('a tag-wrapped memory item vanishes without recall and wraps with it', () => {
		const memoryItem = item('<memory>\n{{memory}}\n</memory>');

		const empty = resolveItem(memoryItem, buildMacroContext(input(preset([memoryItem]))), MODEL);
		expect(empty.messages).toHaveLength(0);
		expect(empty.preset).toBe(0);

		const withRecall = input(preset([memoryItem]), {
			recall: { text: 'Alice owes Bob a favor.', archivedIds: new Set<string>() }
		});
		const full = resolveItem(memoryItem, buildMacroContext(withRecall), MODEL);
		expect(full.messages).toHaveLength(1);
		expect(full.messages[0].content).toContain('<memory>');
		expect(full.messages[0].content).toContain('Alice owes Bob a favor.');
		expect(full.memory).toBeGreaterThan(0);
	});

	test('buckets still sum to the tokens actually sent after a partial prune', () => {
		const bible = item(
			'<story_bible>\n\n<character>\n{{character}}\n</character>\n\n<world_info>\n{{lorebook}}\n</world_info>\n\n</story_bible>'
		);
		const withChar = input(preset([bible]), {
			resolvedCharacters: [{ name: 'Alice', traits: { description: 'A wary thief with quick hands.' } } as any]
		});
		const r = resolveItem(bible, buildMacroContext(withChar), MODEL);
		expect(r.messages).toHaveLength(1);
		expect(r.messages[0].content).toContain('<character>');
		expect(r.messages[0].content).not.toContain('<world_info>');
		expect(r.preset + r.context + r.memory + r.chat).toBe(countTokens(r.messages[0].content, MODEL));
	});

	test('memory bucket isolates the recall text; the wrapper stays in preset', () => {
		const memoryItem = item('<memory>\n{{memory}}\n</memory>');
		const recallText = 'Alice owes Bob a favor after the heist.';
		const withRecall = input(preset([memoryItem]), {
			recall: { text: recallText, archivedIds: new Set<string>() }
		});
		const r = resolveItem(memoryItem, buildMacroContext(withRecall), MODEL);
		expect(r.preset).toBeGreaterThan(0); // the <memory> wrapper itself
		expect(r.memory).toBeGreaterThan(0);
		expect(r.context).toBe(0); // the only dynamic content here is the recall
		// Tokenization isn't additive, so the buckets are an estimate, but they must
		// never undercount what is sent (the budget trim relies on that direction).
		expect(r.preset + r.context + r.memory + r.chat).toBeGreaterThanOrEqual(
			countTokens(r.messages[0].content, MODEL)
		);
	});

	test('tags arriving inside macro values never form prunable blocks', () => {
		const wrapped = item('<block>{{a}}</block>');
		const ctx = buildMacroContext(
			input(preset([wrapped], { controls: [{ id: 'c1', macro: 'a', label: 'A', type: 'text', defaultText: '' }] }), {
				controls: [{ id: 'c1', macro: 'a', label: 'A', type: 'text', defaultText: '' } as any],
				customFields: { a: 'value with <empty></empty> tags inside' }
			})
		);
		const r = resolveItem(wrapped, ctx, MODEL);
		expect(r.messages[0].content).toContain('<empty></empty>');
	});
});

describe('pruning with preset controls', () => {
	for (const erotism of [false, true]) {
		for (const steering of [false, true]) {
			test(`roleplay and post-history rules survive optional toggles (erotism=${erotism}, steering=${steering})`, () => {
				const controls: any[] = [
					{ id: 'e', macro: 'erotism', label: 'Optional rules', type: 'toggle', onText: 'Additional rules.' },
					{ id: 's', macro: 'steering', label: 'Steering', type: 'toggle', onText: 'Advance the plot.' }
				];
				const items = [
					item('Introduction.\n\n<roleplay_rules>\nKeep the fixed roleplay rules.\n{{erotism}}\n</roleplay_rules>'),
					item('<final_rules>\nKeep the fixed final rules.\n{{steering}}\n</final_rules>')
				];
				const options = input(preset(items, { controls }), {
					controls, customFields: { erotism, steering }, postProcessing: { mode: 'none' }
				});
				const result = assemblePrompt(options);
				expect(result.messages.map((m) => m.content)).toEqual([
					`Introduction.\n\n<roleplay_rules>\nKeep the fixed roleplay rules.\n${erotism ? 'Additional rules.' : ''}\n</roleplay_rules>`,
					`<final_rules>\nKeep the fixed final rules.\n${steering ? 'Advance the plot.' : ''}\n</final_rules>`
				]);
				const ctx = buildMacroContext(options);
				for (const promptItem of items) {
					const resolved = resolveItem(promptItem, ctx, MODEL);
					expect(resolved.preset + resolved.context + resolved.memory + resolved.chat)
						.toBeGreaterThanOrEqual(countTokens(resolved.messages[0].content, MODEL));
				}
			});
		}
	}

	test('structural history preserves fixed rules beside an empty control', () => {
		const controls: any[] = [{ id: 'c', macro: 'optional', label: 'Optional', type: 'toggle' }];
		const p = preset([item('<rules>Keep this rule.\n{{optional}}</rules>\n{{chatHistory}}')], { controls });
		const result = assemblePrompt(input(p, {
			controls, chatMessages: [msg('m', 'user', 'Latest turn.')], postProcessing: { mode: 'none' }
		}));
		expect(result.messages.map((m) => m.content)).toEqual(['<rules>Keep this rule.\n</rules>', 'Latest turn.']);
	});

	const RULES_CONTROL = {
		id: 'ctrl_rules',
		macro: 'rules',
		label: 'House Rules',
		type: 'textarea',
		defaultText: '',
		textTemplate: 'Standing instructions:\n{{value}}'
	} as any;

	function rulesInput(value: string) {
		const p = preset([item('<style>\nAlways on.\n</style>\n\n<house_rules>\n{{rules}}\n</house_rules>')], {
			controls: [RULES_CONTROL]
		});
		return input(p, { controls: [RULES_CONTROL], customFields: { rules: value } });
	}

	test('an empty textarea control prunes its wrapper block', () => {
		const a = assemblePrompt(rulesInput(''));
		expect(a.messages).toHaveLength(1);
		expect(a.messages[0].content).toContain('<style>');
		expect(a.messages[0].content).not.toContain('house_rules');
	});

	test('a filled textarea control keeps its wrapper and template framing', () => {
		const a = assemblePrompt(rulesInput('No time skips.'));
		expect(a.messages[0].content).toContain('<house_rules>');
		expect(a.messages[0].content).toContain('Standing instructions:\nNo time skips.');
	});

	test('an empty tags control prunes its wrapper inside a surviving parent', () => {
		const themes = {
			id: 'ctrl_themes',
			macro: 'themes',
			label: 'Themes',
			type: 'tags',
			defaultOptionIds: [],
			options: [{ id: 't1', label: 'Romance', injectedText: 'Thread romance through.' }]
		} as any;
		const p = preset([item('<direction>\n- Rule.\n<themes>\n{{themes}}\n</themes>\n</direction>')], {
			controls: [themes]
		});

		const off = assemblePrompt(input(p, { controls: [themes], customFields: {} }));
		expect(off.messages[0].content).toContain('- Rule.');
		expect(off.messages[0].content).not.toContain('<themes>');

		const on = assemblePrompt(input(p, { controls: [themes], customFields: { themes: ['t1'] } }));
		expect(on.messages[0].content).toContain('<themes>\nThread romance through.\n</themes>');
	});
});

describe('pruning never touches structural items', () => {
	const CHAT = [
		msg('m1', 'user', 'First user message.'),
		msg('m2', 'assistant', 'First reply.'),
		msg('m3', 'user', 'Latest user turn.')
	];
	const HISTORY_ITEM = item('The story so far:\n<history>\n{{chatHistory}}\n</history>');

	test('empty history still drops the whole wrapper item (structural self-cleaning)', () => {
		const a = assemblePrompt(input(preset([HISTORY_ITEM]), { postProcessing: { mode: 'none' } }));
		// No chat at all → nothing injected → the item and its tags are gone entirely.
		expect(a.messages.some((m) => m.content.includes('<history>'))).toBe(false);
	});

	test('populated history keeps its tag wrapper and native turns', () => {
		const a = assemblePrompt(input(preset([HISTORY_ITEM]), { chatMessages: CHAT, postProcessing: { mode: 'none' } }));
		expect(a.messages.some((m) => m.content.includes('<history>'))).toBe(true);
		expect(a.messages.some((m) => m.content === 'First user message.')).toBe(true);
		expect(a.messages.some((m) => m.content.includes('</history>'))).toBe(true);
	});
});

// ===== End-to-end: the shipped Standard Chungus preset =====

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Standard Chungus end-to-end', () => {
	const stored = JSON.parse(
		readFileSync(join(import.meta.dir, '../../../defaults/presets/standard_chungus.json'), 'utf8')
	);
	// The flag rides in from the shipped file, proving the preset actually opts in.
	const CHUNGUS = {
		id: 'standard_chungus',
		name: stored.name,
		items: stored.items,
		controls: stored.controls,
		pruneEmptyBlocks: stored.pruneEmptyBlocks
	};

	function chungusInput(over: Partial<AssembleInput> = {}): AssembleInput {
		return input(CHUNGUS, { controls: CHUNGUS.controls, postProcessing: { mode: 'none' }, ...over });
	}

	function allText(messages: { content: string }[]): string {
		return messages.map((m) => m.content).join('\n');
	}

	test('the Memory item sits directly above Chat History', () => {
		const ids = stored.items.map((it: { id: string }) => it.id);
		expect(ids.indexOf('chat-history')).toBe(ids.indexOf('memory') + 1);
	});

	test('fresh empty chat: no dangling blocks, no unresolved macros, defaults injected', () => {
		const a = assemblePrompt(chungusInput());
		const text = allText(a.messages);

		// Macro-only blocks disappear, while authored text survives missing data.
		expect(text).toContain('<memory>');
		expect(text).toContain('Compacted memory');
		expect(text).not.toContain('<story_bible>');
		expect(text).not.toContain('<world_info>');
		expect(text).not.toContain('<house_rules>');
		expect(text).not.toContain('<history>');

		// No empty tag pair and no unresolved macro survives anywhere.
		expect(text).not.toMatch(/<([A-Za-z0-9_-]+)>\s*<\/\1>/);
		expect(text).not.toContain('{{');

		// Control defaults landed as prose.
		expect(text).toContain('third person limited');
		expect(text).toContain('past tense');
		expect(text).toContain('250 to 450 words');
		expect(text).toContain('Keep the pace steady');
		expect(text).toContain('Play outcomes straight');
		expect(text).toContain('general audience');

		// The blocks with static-or-filled content are still standing.
		expect(text).toContain('<direction>');
		expect(text).toContain('<style>');
		// The banned list ships with a selection, so its block arrives filled.
		expect(text).toContain('<banned_vocabulary>');
		expect(text).toContain('barely above a whisper');

		// Missing persona names must not erase the fixed rules around {{user}}.
		expect(text).toContain('<absolute_rules>');
		expect(text).toContain('NEVER parrot.');
	});

	test('emptying the banned list preserves its authored instructions and the style block', () => {
		const text = allText(assemblePrompt(chungusInput({ customFields: { bannedPhrases: [] } })).messages);

		expect(text).toContain('<banned_vocabulary>');
		expect(text).toContain('Never write these words or phrases');
		expect(text).not.toContain('barely above a whisper');
		expect(text).toContain('<style>');
		expect(text).toContain('250 to 450 words');
	});

	test('full chat: every conditional block materializes exactly once', () => {
		const chat = [
			msg('m1', 'user', 'I push open the tavern door.'),
			msg('m2', 'assistant', 'Smoke and lamplight spill out around you.'),
			msg('m3', 'user', 'I look for the fence named Corvo.')
		];
		const a = assemblePrompt(
			chungusInput({
				resolvedCharacters: [
					{
						name: 'Corvo',
						traits: {
							description: 'A fence with a ledger for a memory.',
							postHistoryInstructions: 'Corvo never repeats an offer.'
						}
					} as any
				],
				resolvedPersona: { name: 'Vesper', traits: { description: 'A burglar with debts.' } } as any,
				chatMessages: chat,
				recall: { text: 'Vesper owes the Guild three favors.', archivedIds: new Set<string>() },
				customFields: {
					rules: 'Never skip travel scenes.',
					bannedPhrases: ['bp_whisper', 'shivers down her spine']
				}
			})
		);
		const text = allText(a.messages);

		// Conditional blocks present, each exactly once.
		for (const block of ['<story_bible>', '<character>', '<protagonist>', '<memory>', '<house_rules>', '<history>', '<absolute_rules>']) {
			expect(text.split(block).length - 1).toBe(1);
		}
		// No lorebook linked → world_info still pruned even though its siblings live.
		expect(text).not.toContain('<world_info>');

		// The content each block frames actually arrived.
		expect(text).toContain('A fence with a ledger for a memory.');
		expect(text).toContain('A burglar with debts.');
		expect(text).toContain('Vesper owes the Guild three favors.');
		expect(text).toContain('Standing instructions from the user');
		expect(text).toContain('Never skip travel scenes.');
		// The banned list takes the reader's own entries beside the author's options, and
		// both kinds reach the prompt through the same join.
		expect(text).toContain('barely above a whisper');
		expect(text).toContain('shivers down her spine');
		// The absolute rules bind to the persona's actual name.
		expect(text).toContain('NEVER act for Vesper');
		// Deliberate: the default preset does NOT inject card post-history instructions.
		// The item was removed. A card's PHI stays out unless a preset opts back in.
		expect(text).not.toContain('Corvo never repeats an offer.');

		// History injected natively, the newest turn included: it closes the run, with the
		// history block's own closing tag right after it (separate messages in 'none' mode;
		// merge folds the text ones together in production).
		expect(a.messages.some((m) => m.role === 'user' && m.content === 'I push open the tavern door.')).toBe(true);
		const latestIdx = a.messages.findIndex(
			(m) => m.role === 'user' && m.content === 'I look for the fence named Corvo.'
		);
		expect(latestIdx).toBeGreaterThan(-1);
		expect(a.messages[latestIdx - 1]?.content).toBe('Smoke and lamplight spill out around you.');
		expect(a.messages[latestIdx + 1]?.content).toBe('</history>');

		// The memory block explains itself and lands right before the history block.
		expect(text).toContain('Compacted memory');
		expect(text.indexOf('<memory>')).toBeLessThan(text.indexOf('<history>'));

		// Still no empty shells or unresolved macros anywhere.
		expect(text).not.toMatch(/<([A-Za-z0-9_-]+)>\s*<\/\1>/);
		expect(text).not.toContain('{{');
	});

	test('legacy stored control ids still resolve (pov_third, rating_nsfw)', () => {
		const a = assemblePrompt(chungusInput({ customFields: { pov: 'pov_third', contentRating: 'rating_nsfw' } }));
		const text = allText(a.messages);
		expect(text).toContain('third person limited');
		expect(text).toContain('adult fiction with no content ceiling');
	});
});
