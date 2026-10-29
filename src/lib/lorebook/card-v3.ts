/** V3 decorators are interpreted for each scan, leaving the authored content intact on disk. */
import type { Lorebook, LorebookEntry, LorebookPastScan } from './types';
import { LOREBOOK_POSITION_AT_DEPTH, LOREBOOK_ROLES } from './types';
import { cardChoices } from '#lib/card-cbs.ts';

export interface CardLoreContext {
	positions?: readonly string[];
	assistantCount?: number;
	greetingIndex?: number;
	userIconName?: string;
	messageCount: number;
	history?: LorebookPastScan[];
}

export interface CardDecorators {
	text: string;
	values: Map<string, string[]>;
}

const FLAGS = new Set(['activate', 'dont_activate', 'keep_activate_after_match', 'dont_activate_after_match', 'ignore_on_max_context']);
const NUMBERS = new Set(['activate_only_after', 'activate_only_every', 'depth', 'scan_depth', 'is_greeting']);
const POSITIONS = new Set(['before_desc', 'after_desc', 'personality', 'scenario']);

function supported(name: string, value: string, context: CardLoreContext): boolean {
	if (FLAGS.has(name)) return value === '';
	if (NUMBERS.has(name)) {
		if (!value || !Number.isFinite(Number(value))) return false;
		if ((name === 'activate_only_after' || name === 'activate_only_every') && context.assistantCount === undefined) return false;
		if (name === 'is_greeting' && context.greetingIndex === undefined) return false;
		return name !== 'activate_only_every' || Number(value) > 0;
	}
	if (name === 'role') return ['system', 'user', 'assistant'].includes(value);
	if (name === 'position') return POSITIONS.has(value) && (context.positions === undefined || context.positions.includes(value));
	if (name === 'additional_keys' || name === 'exclude_keys') return cardChoices(value).some(Boolean);
	if (name === 'is_user_icon') return !!value && context.userIconName !== undefined;
	// Instruct-only positions do not apply to chat messages. This also lets a card's
	// adjacent fallback choose @@depth when @@instruct_depth is not applicable.
	return false;
}

export function readCardDecorators(content: string, context: CardLoreContext): CardDecorators {
	const output: string[] = [];
	const values = new Map<string, string[]>();
	let chosen = true;
	for (const line of content.split(/\r?\n/)) {
		const match = /^\s*(@{2,})([a-zA-Z_]+)(?:\s+(.*?))?\s*$/.exec(line);
		if (!match) { output.push(line); chosen = true; continue; }
		const name = match[2].toLowerCase();
		const raw = (match[3] ?? '').trim();
		const value = ['additional_keys', 'exclude_keys'].includes(name) ? raw : raw.replace(/^(['"])(.*)\1$/, '$2');
		if (match[1].length === 2) chosen = false;
		if (chosen || !supported(name, value, context)) continue;
		chosen = true;
		if (name === 'additional_keys' || name === 'exclude_keys') values.set(name, [...(values.get(name) ?? []), value]);
		else if (!values.has(name)) values.set(name, [value]);
	}
	return { text: output.join('\n').trim(), values };
}

export function prepareCardV3Book(book: Lorebook, context: CardLoreContext): Lorebook {
	if (!book.entries.some((entry) => entry.cardV3)) return book;
	return { ...book, entries: book.entries.map((original) => {
		if (!original.cardV3) return original;
		const parsed = readCardDecorators(original.content, context);
		const values = parsed.values;
		const number = (name: string) => values.has(name) ? Number(values.get(name)![0]) : undefined;
		const previous = (context.history ?? []).filter((scan) => scan.fired.has(original.id)).length;
		const force = values.has('activate') || (values.has('keep_activate_after_match') && previous > 0);
		const blocked = (!force && ((values.has('dont_activate') && !values.has('activate')) ||
			(values.has('dont_activate_after_match') && previous > 0) ||
			(number('activate_only_after') !== undefined && context.assistantCount! < number('activate_only_after')!) ||
			(number('activate_only_every') !== undefined && context.assistantCount! % number('activate_only_every')! !== 0))) ||
			(number('is_greeting') !== undefined && context.greetingIndex !== number('is_greeting')) ||
			(values.has('is_user_icon') && context.userIconName !== values.get('is_user_icon')![0]);
		const entry: LorebookEntry = {
			...original, content: parsed.text,
			constant: force || (!original.cardV3.useRegex && original.constant),
			keysecondary: original.cardV3.useRegex || !original.cardV3.selective ? [] : original.keysecondary,
			v3Runtime: {
				blocked, force,
				additionalKeys: values.get('additional_keys')?.map((value) => cardChoices(value).map((key) => key.replace(/^(['"])(.*)\1$/, '$2'))),
				excludeKeys: original.cardV3.useRegex ? [] : values.get('exclude_keys')?.flatMap((value) => cardChoices(value).map((key) => key.replace(/^(['"])(.*)\1$/, '$2'))),
				position: values.get('position')?.[0] as NonNullable<LorebookEntry['v3Runtime']>['position'],
				ignoreOnMaxContext: values.has('ignore_on_max_context'),
				bookId: book.id,
				bookTokenBudget: typeof book.extensions?.token_budget === 'number' ? Math.max(0, book.extensions.token_budget) : undefined,
				priority: typeof original.cardV3.original.priority === 'number' ? original.cardV3.original.priority : original.order
			}
		};
		if (number('scan_depth') !== undefined) entry.scanDepth = Math.max(0, Math.floor(number('scan_depth')!));
		const depth = number('depth') ?? (number('reverse_depth') !== undefined ? context.messageCount - number('reverse_depth')! : undefined);
		if (depth !== undefined && !entry.v3Runtime!.position) {
			entry.position = LOREBOOK_POSITION_AT_DEPTH;
			entry.depth = Math.max(0, Math.floor(depth));
		}
		if (values.has('role')) {
			entry.role = LOREBOOK_ROLES.find((role) => role.role === values.get('role')![0])!.id;
			if (!entry.v3Runtime!.position && depth === undefined) { entry.position = LOREBOOK_POSITION_AT_DEPTH; entry.depth = 0; }
		}
		return entry;
	}) };
}
