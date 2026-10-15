import { describe, expect, test } from 'bun:test';
import { parseLorebook, toCharacterBook, toNativeWorldInfo } from './sillytavern';
import { resolveLorebooks } from './engine';
import { readCardDecorators } from './card-v3';
import { expandMacros, expandSelfRefs, displaySelfRefs, withLorebookFields } from '$lib/macros';
import { cardChoices, cardScanText, resolveCardCbs } from '$lib/card-cbs';
import { assemblePrompt, type AssembleInput } from '$lib/utils/prompt-assembly';
import type { Lorebook } from './types';

function book(entries: Record<string, unknown>[], extra = {}): Lorebook {
	return parseLorebook({ spec: 'lorebook_v3', data: { ...extra, entries: entries.map((entry) => ({
		keys: ['rabbit'], content: 'Lore', enabled: true, use_regex: false, insertion_order: 0, ...entry
	})) } }, 'V3');
}
const scan = (b: Lorebook, messages: string[] = ['rabbit']) => resolveLorebooks({ books: [b], messages });

describe('V3 lorebook semantics', () => {
	test('literal slash keys remain literal; regex supports bare patterns and rejects any invalid pattern', () => {
		expect(scan(book([{ keys: ['/rabbit/i'] }])).text).toBe('');
		expect(scan(book([{ keys: ['/rabbit/i'] }]), ['/rabbit/i']).text).toBe('Lore');
		expect(scan(book([{ keys: ['rabb.t'], use_regex: true }])).text).toBe('Lore');
		expect(scan(book([{ keys: ['rabbit', '['], use_regex: true }])).text).toBe('');
	});
	test('regex ignores constant and secondary keys; selective=false ignores secondary keys', () => {
		expect(scan(book([{ keys: ['wolf'], use_regex: true, constant: true }])).text).toBe('');
		expect(scan(book([{ use_regex: true, selective: true, secondary_keys: ['wolf'] }])).text).toBe('Lore');
		expect(scan(book([{ selective: false, secondary_keys: ['wolf'] }])).text).toBe('Lore');
		expect(scan(book([{ selective: true, secondary_keys: ['wolf'] }])).text).toBe('');
	});
	test('fallback chains ignore instruct-only decorators and choose the first valid supported value', () => {
		const parsed = readCardDecorators('@@unknown 1\n@@@invalid 1\n@@@instruct_depth 5\n@@@depth nope\n@@@depth 2\n@@@depth 3\n@@depth 4\nText', { messageCount: 10 });
		expect(parsed.text).toBe('Text'); expect(parsed.values.get('depth')).toEqual(['2']);
		const result = resolveLorebooks({ books: [book([{ content: '@@instruct_depth 8\n@@@depth 2\n@@role assistant\nText' }])], messages: ['rabbit'], placeAtDepth: true });
		expect(result.text).toBe(''); expect(result.placed).toEqual([{ depth: 2, role: 'assistant', text: 'Text' }]);
	});
	test('enable=false dominates force, and recursive scanning cannot bypass a failed decorator', () => {
		const b = book([{ content: '@@activate\nDisabled', enabled: false }, { content: '@@dont_activate\nBlocked' },
			{ content: 'rabbit', constant: true }, { keys: [], content: '@@dont_activate\n@@activate\nForced' }], { recursive_scanning: true });
		expect(scan(b, []).text).toBe('rabbit\n\nForced');
	});
	test('additional and excluded keys filter constants; duplicate additional groups all apply', () => {
		const b = book([{ constant: true, content: '@@additional_keys "red","blue"\n@@additional_keys green\n@@exclude_keys wolf\nText' }]);
		expect(scan(b, ['red green']).text).toBe('Text');
		expect(scan(b, ['red']).text).toBe(''); expect(scan(b, ['red green wolf']).text).toBe('');
		expect(scan(book([{ use_regex: true, content: '@@additional_keys rabbit,[\nText' }])).text).toBe('');
	});
	test('assistant counts, selected greeting, user icon and scan depth constrain activation', () => {
		const b = book([{ content: '@@activate_only_after 2\n@@activate_only_every 2\n@@is_greeting 1\n@@is_user_icon Alice\nText' }]);
		const resolve = (assistantCount: number, greetingIndex: number, userIconName: string) => resolveLorebooks({ books: [b], messages: ['rabbit'], cardContext: { assistantCount, greetingIndex, userIconName } }).text;
		expect(resolve(2, 1, 'Alice')).toBe('Text'); expect(resolve(1, 1, 'Alice')).toBe('');
		expect(resolve(3, 1, 'Alice')).toBe(''); expect(resolve(2, 0, 'Alice')).toBe(''); expect(resolve(2, 1, 'Bob')).toBe('');
		expect(scan(book([{ content: '@@scan_depth 1\nText' }]), ['rabbit', 'nothing']).text).toBe('');
	});
	test('keep/dont_activate_after_match read history on the current branch', () => {
		for (const [decorator, expected] of [['keep_activate_after_match', 'Text'], ['dont_activate_after_match', '']] as const) {
			const b = book([{ content: `@@${decorator}\nText` }]);
			expect(resolveLorebooks({ books: [b], messages: ['nothing'], history: [{ fired: new Set([b.entries[0].id]) }] }).text).toBe(expected);
		}
	});
	test('hidden keys feed only recursion and comments never activate lore', () => {
		const b = book([{ keys: [], constant: true, content: '{{hidden_key:rabbit}}{{comment:wolf}}{{// fox}}Seed' },
			{ content: 'Rabbit' }, { keys: ['wolf', 'fox'], content: 'Wrong' }], { recursive_scanning: true });
		expect(scan(b, []).text).toBe('Seed\n\nRabbit');
		expect(scan(book([{ keys: ['rabbit', 'wolf', 'fox'] }]), ['{{hidden_key:rabbit}} {{comment:wolf}} {{// fox}}']).text).toBe('');
	});
	test('field positions reach individual macros and the character blob', () => {
		const b = book([{ content: '@@position before_desc\nBefore' }, { content: '@@position after_desc\nAfter' }, { content: '@@position personality\nExtra personality' }]);
		const resolved = scan(b); const ctx = withLorebookFields({ resolvedCharacters: [{ name: 'Alice', traits: { description: 'Description', personality: 'Curious' } }] }, resolved.fields);
		expect(expandMacros('{{description}}', ctx)).toBe('Before\n\nDescription\n\nAfter');
		expect(expandMacros('{{character}}', ctx)).toContain('Curious\n\nExtra personality');
		expect(resolved.text).toBe('');
	});
	test('per-book budgets admit higher priority while retaining insertion order', () => {
		const b = book([{ constant: true, content: 'Low', priority: 1 }, { constant: true, content: 'High', priority: 10 }], { token_budget: 5 });
		const out = resolveLorebooks({ books: [b], messages: [], budget: { maxTokens: 100, count: (text) => text.trim().length } });
		expect(out.text).toBe('High'); expect(out.trace.records.some((entry) => entry.status === 'trimmed')).toBe(true);
	});
	test('native and V3 exports retain regex semantics and future entry fields', () => {
		const b = book([{ use_regex: true, future: 'retained', priority: 9 }]);
		for (const document of [toNativeWorldInfo(b), { spec: 'lorebook_v3', data: toCharacterBook(b) }]) {
			const again = parseLorebook(document, 'x'); expect(again.entries[0].cardV3?.useRegex).toBe(true);
			expect((toCharacterBook(again).entries as Record<string, unknown>[])[0].future).toBe('retained');
		}
	});
	test('native constant entries with no keys remain constant after V3 export', () => {
		const native = parseLorebook({ entries: { '0': { key: [], constant: true, content: 'Always', disable: false } } }, 'Native');
		expect(scan(parseLorebook({ spec: 'lorebook_v3', data: toCharacterBook(native) }, 'V3'), []).text).toBe('Always');
	});
	test('malformed native V3 extension metadata fails during import', () => {
		expect(() => parseLorebook({ entries: { '0': { chungus_card_v3: { useRegex: true, selective: false, original: null } } } }, 'Bad')).toThrow(/V3/);
	});
	test('force activation bypasses optional filters while greeting and enable constraints remain', () => {
		const b = book([{ content: '@@activate\n@@activate_only_after 100\n@@additional_keys missing\n@@is_greeting 1\nText', keys: [] }]);
		expect(resolveLorebooks({ books: [b], messages: [], cardContext: { assistantCount: 0, greetingIndex: 1 } }).text).toBe('Text');
		expect(resolveLorebooks({ books: [b], messages: [], cardContext: { assistantCount: 0, greetingIndex: 0 } }).text).toBe('');
	});
	test('optional lore yields before history when the assembled prompt exceeds context', () => {
		const b = book([{ content: '@@ignore_on_max_context\n' + 'Optional '.repeat(100), constant: true }]);
		const input = { preset: { id: 'p', name: 'p', controls: [], items: [
			{ id: 'l', role: 'system', enabled: true, content: '{{lorebook}}' }, { id: 'h', role: 'user', enabled: true, content: '{{chatHistory}}' }
		] }, resolvedCharacters: [], resolvedPersona: null, lorebooks: [b], controls: [], customFields: {},
		chatMessages: [{ id: 'm', role: 'user', content: 'Hello' }], recall: { text: null, archivedIds: new Set() }, contextBudget: 30 } as unknown as AssembleInput;
		const out = assemblePrompt(input);
		expect(out.messages.map((message) => message.content)).toEqual(['Hello']);
		expect(out.trimmedMessages).toBe(0); expect(out.lorebook.records[0].status).toBe('trimmed');
	});
});

describe('Character Card V3 CBS', () => {
	test('nickname/self references, aliases and case-insensitive CBS reach prompts', () => {
		expect(expandSelfRefs('{{CHAR}} <char> <bot> {{USER}} {{REVERSE:🐇abc}}', 'Ali', 'Lili')).toBe('Ali Ali Ali Lili cba🐇');
		expect(expandMacros('{{Char}} {{USER}} {{reverse:abc}}', { resolvedCharacters: [{ name: 'Ali', traits: {} }], resolvedPersona: { name: 'Lili', traits: {} } })).toBe('Ali Lili cba');
	});
	test('escaped commas, deterministic picks and dice bounds', () => {
		expect(cardChoices('a\\,b,c')).toEqual(['a,b', 'c']);
		expect(resolveCardCbs('random:a\\,b,c', { rng: () => 0 })).toBe('a,b');
		expect(resolveCardCbs('pick:a,b,c', { seed: 'chat' })).toBe(resolveCardCbs('pick:a,b,c', { seed: 'chat' }));
		expect(resolveCardCbs('roll:D6', { rng: () => 0 })).toBe('1');
		expect(resolveCardCbs('roll:6', { rng: () => 0.999 })).toBe('6');
		expect(resolveCardCbs('roll:0')).toBeUndefined();
	});
	test('comments display inline but are absent from prompts and scans', () => {
		const text = '{{// invisible}}Hello{{comment: author note}}{{hidden_key:secret}}';
		expect(displaySelfRefs(text, 'A', 'U')).toBe('Hello(author note)');
		expect(expandSelfRefs(text, 'A', 'U')).toBe('Hello');
		expect(cardScanText(text)).toBe('Hello'); expect(cardScanText(text, true)).toBe('Hello secret ');
	});
});
