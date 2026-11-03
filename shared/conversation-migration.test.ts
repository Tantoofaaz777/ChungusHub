import { describe, expect, test } from 'bun:test';
import {
	planConversationMigration,
	type ConversationMigrationPlan,
	type LegacyConversationMessage,
	type LegacyConversationSnapshot
} from './conversation-migration';

const message = (
	id: string,
	parentId: string | null,
	role: LegacyConversationMessage['role'] = 'assistant',
	siblingIndex = 0
): LegacyConversationMessage => ({ id, chatId: 'chat', parentId, role, siblingIndex, createdAt: 1 });

function snapshot(messages: LegacyConversationMessage[], activeLeafId: string | null): LegacyConversationSnapshot {
	return { chatId: 'chat', activeLeafId, rootMessageId: messages.find(m => m.parentId === null)?.id ?? null,
		canonLeafId: null, messages };
}

const selected = (plan: ConversationMigrationPlan) => [plan.primary, ...plan.branches]
	.map(conversation => conversation.turns.map(turn => turn.selectedMessageId));
const represented = (plan: ConversationMigrationPlan) => [...new Set([plan.primary, ...plan.branches]
	.flatMap(conversation => conversation.turns.flatMap(turn => turn.variantMessageIds)))].sort();

describe('legacy conversation migration plan', () => {
	test('keeps an empty chat and a linear conversation without creating branches', () => {
		expect(planConversationMigration(snapshot([], null))).toEqual({ chatId: 'chat',
			primary: { sourceLeafId: null, turns: [] }, branches: [], unclassifiedAlternatives: [],
			legacyPointers: { rootMessageId: null, canonLeafId: null } });
		const plan = planConversationMigration(snapshot([message('root', null), message('user', 'root', 'user'),
			message('reply', 'user')], 'reply'));
		expect(selected(plan)).toEqual([['root', 'user', 'reply']]);
		expect(plan.primary.turns.every(turn => turn.variantMessageIds.length === 1)).toBe(true);
	});

	test('does not infer swipe origin from identical parent, role or text', () => {
		const messages = [message('user', null, 'user'),
			{ ...message('original', 'user'), content: 'Same text' },
			{ ...message('alternate', 'user', 'assistant', 1), content: 'Same text' }];
		const plan = planConversationMigration(snapshot(messages, 'alternate'));
		expect(selected(plan)).toEqual([['user', 'alternate'], ['user', 'original']]);
		expect(plan.unclassifiedAlternatives).toEqual([{ parentId: 'user', messageIds: ['original', 'alternate'] }]);
		expect(represented(plan)).toEqual(['alternate', 'original', 'user']);
	});

	test('confirmed leaf swipes become versions with the currently selected version intact', () => {
		const messages = [message('user', null, 'user'), message('first', 'user'),
			message('second', 'user', 'assistant', 1), message('third', 'user', 'assistant', 2)];
		const plan = planConversationMigration(snapshot(messages, 'second'), [{ messageIds: ['third', 'second', 'first'] }]);
		expect(plan.branches).toEqual([]);
		expect(plan.primary.turns.at(-1)).toEqual({ selectedMessageId: 'second', variantMessageIds: ['first', 'second', 'third'] });
		expect(plan.unclassifiedAlternatives).toEqual([]);
		expect(represented(plan)).toEqual(messages.map(m => m.id).sort());
	});

	test('confirmed greetings follow the same version rule as response swipes', () => {
		const plan = planConversationMigration(snapshot([message('opening', null),
			message('alternate-opening', null, 'assistant', 1)], 'alternate-opening'),
			[{ messageIds: ['opening', 'alternate-opening'] }]);
		expect(plan.primary.turns).toEqual([{ selectedMessageId: 'alternate-opening', variantMessageIds: ['opening', 'alternate-opening'] }]);
		expect(plan.branches).toEqual([]);
	});

	test('an unplayed confirmed version does not create an extra chat beside a played version', () => {
		const messages = [message('user', null, 'user'), message('played', 'user'),
			message('unplayed', 'user', 'assistant', 1), message('next', 'played', 'user')];
		const plan = planConversationMigration(snapshot(messages, 'next'), [{ messageIds: ['played', 'unplayed'] }]);
		expect(selected(plan)).toEqual([['user', 'played', 'next']]);
		expect(plan.primary.turns[1].variantMessageIds).toEqual(['played', 'unplayed']);
	});

	test('selecting an unplayed version keeps the older continuation in an independent chat', () => {
		const messages = [message('user', null, 'user'), message('played', 'user'),
			message('unplayed', 'user', 'assistant', 1), message('next', 'played', 'user')];
		const plan = planConversationMigration(snapshot(messages, 'unplayed'), [{ messageIds: ['played', 'unplayed'] }]);
		expect(selected(plan)).toEqual([['user', 'unplayed'], ['user', 'played', 'next']]);
		expect(plan.primary.turns[1].selectedMessageId).toBe('unplayed');
		expect(plan.branches[0].turns[1].selectedMessageId).toBe('played');
	});

	test('confirmation never merges two versions that were continued into one history', () => {
		const messages = [message('user', null, 'user'), message('a', 'user'), message('b', 'user', 'assistant', 1),
			message('a-user', 'a', 'user'), message('a-reply', 'a-user'), message('b-user', 'b', 'user')];
		const plan = planConversationMigration(snapshot(messages, 'a-reply'), [{ messageIds: ['a', 'b'] }]);
		expect(selected(plan)).toEqual([['user', 'a', 'a-user', 'a-reply'], ['user', 'b', 'b-user']]);
		expect(plan.primary.turns[1].variantMessageIds).toEqual(['a', 'b']);
		expect(plan.branches[0].turns[1].variantMessageIds).toEqual(['a', 'b']);
	});

	test('nested forks and confirmed groups preserve every continuation and all source rows', () => {
		const messages = [message('root', null), message('u1', 'root', 'user'), message('u2', 'root', 'user', 1),
			message('a', 'u1'), message('b', 'u1', 'assistant', 1), message('a-user', 'a', 'user'),
			message('x', 'a-user'), message('y', 'a-user', 'assistant', 1), message('u2-reply', 'u2')];
		const plan = planConversationMigration(snapshot(messages, 'y'), [{ messageIds: ['a', 'b'] }, { messageIds: ['x', 'y'] }]);
		expect(selected(plan)).toEqual([['root', 'u1', 'a', 'a-user', 'y'], ['root', 'u2', 'u2-reply']]);
		expect(represented(plan)).toEqual(messages.map(m => m.id).sort());
	});

	test('partial confirmation leaves unknown alternatives classified conservatively', () => {
		const messages = [message('root', null), message('u', 'root', 'user'), message('a', 'u'),
			message('b', 'u', 'assistant', 1), message('unknown', 'u', 'assistant', 2)];
		const plan = planConversationMigration(snapshot(messages, 'a'), [{ messageIds: ['a', 'b'] }]);
		expect(selected(plan)).toEqual([['root', 'u', 'a'], ['root', 'u', 'unknown']]);
		expect(plan.unclassifiedAlternatives).toEqual([{ parentId: 'u', messageIds: ['a', 'b', 'unknown'] }]);
	});

	test('mixed roles and multiple roots stay separate conversations', () => {
		const messages = [message('root', null), message('alternate-root', null, 'user', 1),
			message('reply', 'root'), message('spliced-user', 'root', 'user', 1),
			message('system', 'root', 'system', 2)];
		const plan = planConversationMigration(snapshot(messages, 'reply'));
		expect(selected(plan)).toEqual([['root', 'reply'], ['alternate-root'], ['root', 'spliced-user'], ['root', 'system']]);
		expect(plan.unclassifiedAlternatives).toEqual([]);
		expect(represented(plan)).toEqual(messages.map(m => m.id).sort());
	});

	test('an interior or null active pointer keeps the exact prefix instead of selecting descendants', () => {
		const messages = [message('root', null), message('later', 'root', 'user')];
		expect(selected(planConversationMigration(snapshot(messages, 'root')))).toEqual([['root'], ['root', 'later']]);
		expect(selected(planConversationMigration(snapshot(messages, null)))).toEqual([[], ['root', 'later']]);
	});

	test('a confirmed group outside the active prefix still has a representative conversation', () => {
		const messages = [message('root', null), message('a', 'root'), message('b', 'root', 'assistant', 1)];
		const plan = planConversationMigration(snapshot(messages, 'root'), [{ messageIds: ['a', 'b'] }]);
		expect(selected(plan)).toEqual([['root'], ['root', 'a']]);
		expect(plan.branches[0].turns[1].variantMessageIds).toEqual(['a', 'b']);
	});

	test('canon and root markers are provenance and never override the active history', () => {
		const source = snapshot([message('root', null), message('a', 'root'), message('canon', 'root', 'assistant', 1)], 'a');
		source.canonLeafId = 'canon';
		const plan = planConversationMigration(source);
		expect(plan.primary.sourceLeafId).toBe('a');
		expect(plan.legacyPointers).toEqual({ rootMessageId: 'root', canonLeafId: 'canon' });
		expect(plan.branches[0].sourceLeafId).toBe('canon');
	});

	test('planning is deterministic and leaves source payloads and input arrays unchanged', () => {
		const messages = [message('root', null), { ...message('a', 'root'), content: 'Original', thinking: 'Reasoning',
			attachments: [{ path: 'images/chat/photo.png' }], branchLabel: { name: 'Legacy label' }, isBookmarked: true,
			excludedFromPrompt: true, lorebook: { fired: ['entry'] } }, message('b', 'root')];
		const source = snapshot(messages, 'a');
		const before = structuredClone(source);
		const confirmations = [{ messageIds: ['b', 'a'] }];
		const plan = planConversationMigration(source, confirmations);
		expect(planConversationMigration({ ...source, messages: [...messages].reverse() }, confirmations)).toEqual(plan);
		expect(source).toEqual(before);
		expect(confirmations).toEqual([{ messageIds: ['b', 'a'] }]);
		expect(represented(plan)).toEqual(messages.map(m => m.id).sort());
		plan.primary.turns[1].variantMessageIds.pop();
		expect(source).toEqual(before);
	});

	test.each([
		['duplicate IDs', [message('same', null), message('same', null)], 'unique'],
		['missing parent', [message('orphan', 'missing')], 'parent'],
		['foreign row', [{ ...message('foreign', null), chatId: 'another' }], 'another chat'],
		['self cycle', [message('cycle', 'cycle')], 'cycle'],
		['disconnected cycle', [message('root', null), message('a', 'b'), message('b', 'a')], 'cycle'],
		['invalid index', [{ ...message('root', null), siblingIndex: NaN }], 'ordering'],
		['invalid timestamp', [{ ...message('root', null), createdAt: Infinity }], 'ordering']
	] as const)('refuses %s without producing a partial plan', (_label, messages, error) => {
		expect(() => planConversationMigration(snapshot([...messages], null))).toThrow(error);
	});

	test.each(['activeLeafId', 'rootMessageId', 'canonLeafId'] as const)('refuses an unavailable %s', pointer => {
		const source = snapshot([message('root', null)], 'root');
		source[pointer] = 'gone';
		expect(() => planConversationMigration(source)).toThrow('pointer');
	});

	test('refuses a root marker pointing to a descendant', () => {
		const source = snapshot([message('root', null), message('child', 'root')], 'child');
		source.rootMessageId = 'child';
		expect(() => planConversationMigration(source)).toThrow('root pointer');
	});

	test.each([
		[['a']], [['a', 'a']], [['a', 'gone']], [['a', 'user']], [['a', 'other-parent']]
	])('refuses invalid swipe confirmation %j', messageIds => {
		const messages = [message('root', null), message('a', 'root'), message('user', 'root', 'user'),
			message('other-parent', 'user')];
		expect(() => planConversationMigration(snapshot(messages, 'a'), [{ messageIds }])).toThrow();
	});

	test('refuses overlapping confirmed groups', () => {
		const messages = [message('root', null), message('a', 'root'), message('b', 'root'), message('c', 'root')];
		expect(() => planConversationMigration(snapshot(messages, 'a'),
			[{ messageIds: ['a', 'b'] }, { messageIds: ['b', 'c'] }])).toThrow('overlap');
	});

	test('plans a long history without recursive traversal', () => {
		const messages = Array.from({ length: 25_000 }, (_, i) => message(`m${i}`, i ? `m${i - 1}` : null));
		const plan = planConversationMigration(snapshot(messages, 'm24999'));
		expect(plan.primary.turns).toHaveLength(messages.length);
		expect(plan.primary.turns[0].selectedMessageId).toBe('m0');
		expect(plan.primary.turns.at(-1)?.selectedMessageId).toBe('m24999');
		expect(plan.branches).toEqual([]);
	});
});
