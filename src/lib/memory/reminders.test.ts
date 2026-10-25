import { describe, expect, test } from 'bun:test';
import { captureScene, resolveScenes, type MemoryScene, type SceneMessage } from '$shared/memory-scenes';
import { normalizeChatFeatureState } from '$lib/types/chat';
import { MemoryReminderCounter, nextMemoryReminder, normalizeReminderInterval, normalizeReminderProgress,
	reminderBoundary, type MemoryReminderProgress } from './reminders';

const message = (id: string, tokens: number, parentId: string | null = null): SceneMessage =>
	({ id, parentId, role: 'assistant', content: 'x'.repeat(tokens) });
const memory = (source: SceneMessage[], extra: Partial<MemoryScene> = {}): MemoryScene => ({
	id: 'chapter', chatId: 'chat', title: 'Chapter', content: 'Summary', source: captureScene(source),
	createdAt: 1, updatedAt: 1, revision: 1, reviewReason: null, ...extra
});
async function evaluate(path: SceneMessage[], previous?: MemoryReminderProgress, scenes: MemoryScene[] = [], interval = 10) {
	const boundary = reminderBoundary(path, resolveScenes(scenes, path));
	const count = (await new MemoryReminderCounter().count('chat', 'encoding', path, boundary, text => text.length))!;
	return { count, due: nextMemoryReminder('chat', path, count, interval, previous) };
}

describe('memory reminder thresholds and branches', () => {
	test('defaults to 20,000 and normalizes invalid intervals', () => {
		for (const input of [undefined, null, '20000', NaN, Infinity]) expect(normalizeReminderInterval(input)).toBe(20_000);
		expect(normalizeReminderInterval(0)).toBe(1);
		expect(normalizeReminderInterval(12_345.9)).toBe(12_345);
		expect(normalizeReminderInterval(4_000_000)).toBe(2_000_000);
	});
	test('one notice at the threshold, then only at the next multiple', async () => {
		const a = message('a', 9), b = message('b', 1, 'a');
		expect((await evaluate([a])).due).toBeNull();
		const first = (await evaluate([a, b])).due!;
		expect(first.threshold).toBe(10);
		const saved = normalizeChatFeatureState(JSON.stringify({ memoryReminder: first.progress })).memoryReminder;
		expect((await evaluate([a, b], saved)).due).toBeNull();
		expect((await evaluate([a, b, message('c', 9, 'b')], saved)).due).toBeNull();
		expect((await evaluate([a, b, message('c', 10, 'b')], saved)).due?.threshold).toBe(20);
	});
	test('enabling on an existing long chat gives one notice and acknowledges earlier crossings', async () => {
		const path = [message('a', 12), message('b', 13, 'a'), message('c', 10, 'b')];
		const first = (await evaluate(path)).due!;
		expect(first.threshold).toBe(30);
		expect((await evaluate(path.slice(0, 1), first.progress)).due).toBeNull();
		expect((await evaluate(path.slice(0, 2), first.progress)).due).toBeNull();
	});
	test('shared history stays acknowledged while divergent swipes keep separate thresholds', async () => {
		const common = message('common', 10), a = message('a', 12, 'common'), b = message('b', 11, 'common');
		const first = (await evaluate([common, a])).due!;
		const second = (await evaluate([common, b], first.progress)).due!;
		expect(second.threshold).toBe(20);
		expect((await evaluate([common], second.progress)).due).toBeNull();
		expect((await evaluate([common, a], second.progress)).due).toBeNull();
		expect((await evaluate([common, b], second.progress)).due).toBeNull();
	});
	test('a forked chat with copied state starts an independent reminder history', async () => {
		const path = [message('a', 20)], first = (await evaluate(path)).due!;
		const count = (await evaluate(path)).count;
		expect(nextMemoryReminder('fork', path, count, 10, first.progress)?.threshold).toBe(20);
	});
	test('saving memory resets to the end of the source range, not the current leaf', async () => {
		const a = message('a', 20), b = message('b', 6, 'a'), c = message('c', 4, 'b');
		const path = [a, b, c], first = (await evaluate(path)).due!;
		const after = await evaluate(path, first.progress, [memory([a])]);
		expect(after.count).toMatchObject({ total: 10, boundaryId: 'a' });
		expect(after.due?.threshold).toBe(10);
		expect((await evaluate(path, after.due!.progress, [memory([a, b, c])])).due).toBeNull();
	});
	test('invalid, overlapping and other-branch memories do not advance the baseline', async () => {
		const a = message('a', 12), b = message('b', 12, 'a'), other = message('other', 12, 'a');
		const valid = memory([a]);
		expect((await evaluate([a, b], undefined, [valid])).count.total).toBe(12);
		expect((await evaluate([a, b], undefined, [memory([a], { reviewReason: 'Changed' })])).count.total).toBe(24);
		const branch = resolveScenes([memory([other])], [a, b], [a, b, other]);
		expect(reminderBoundary([a, b], branch)).toBe(-1);
		const overlap = resolveScenes([memory([a, b]), memory([b], { id: 'overlap' })], [a, b]);
		expect(reminderBoundary([a, b], overlap)).toBe(-1);
		const changed = [{ ...a, content: 'Edited' }, b];
		expect(reminderBoundary(changed, resolveScenes([valid], changed))).toBe(-1);
	});
	test('arcs and volumes retain the last source boundary', () => {
		const path = [message('a', 10), message('b', 10, 'a')];
		const scene = memory(path);
		for (const level of ['chapter', 'arc', 'volume'] as const) {
			expect(reminderBoundary(path, [{ scene: { ...scene, level }, start: 0, end: 1, status: 'active', reason: '' }])).toBe(1);
		}
	});
	test('changing the interval begins tracking its own multiples', async () => {
		const path = [message('a', 25)], first = (await evaluate(path)).due!;
		expect((await evaluate(path, first.progress, [], 20)).due?.threshold).toBe(20);
	});
	test('metadata/hidden text are excluded; editing downward and back does not repeat an old notice', async () => {
		const a = message('a', 10), hidden = { ...message('hidden', 100, 'a'), excludedFromPrompt: true };
		const first = await evaluate([a, hidden]);
		expect(first.count.total).toBe(10);
		expect((await evaluate([{ ...a, content: 'short' }, hidden], first.due!.progress)).due).toBeNull();
		expect((await evaluate([a, hidden], first.due!.progress)).due).toBeNull();
	});
	test('malformed stored state is discarded without affecting other chat settings', () => {
		for (const raw of [null, [], 'bad', { chatId: 12, checkpoints: [] }, { chatId: 'chat' }]) {
			expect(normalizeReminderProgress(raw)).toBeUndefined();
		}
		const valid = { anchorId: 'a', boundaryId: null, interval: 10, threshold: 20 };
		const raw = { chatId: 'chat', checkpoints: [null, {}, valid, { ...valid, threshold: Infinity },
			{ ...valid, interval: 0 }, { ...valid, threshold: 21 }, { ...valid, anchorId: '' }] };
		expect(normalizeReminderProgress(raw)).toEqual({ chatId: 'chat', checkpoints: [valid] });
		const state = normalizeChatFeatureState({ memoryReminder: raw, persona: 'persona' });
		expect(state.persona).toBe('persona');
		expect(state.memoryReminder?.checkpoints).toEqual([valid]);
	});
});

describe('incremental reminder counting', () => {
	test('new/edited/previously hidden text is counted once, with separate encoding/chat caches', async () => {
		const counter = new MemoryReminderCounter(), calls: string[] = [];
		const tokenize = (text: string) => { calls.push(text); return text.length; };
		const a = message('a', 4), b = message('b', 7, 'a');
		await counter.count('chat', 'one', [a], -1, tokenize);
		await counter.count('chat', 'one', [a, b], -1, tokenize);
		await counter.count('chat', 'one', [a, b], -1, tokenize);
		expect(calls).toEqual([a.content, b.content]);
		await counter.count('chat', 'one', [{ ...a, content: 'edited' }, b], -1, tokenize);
		expect(calls.at(-1)).toBe('edited');
		const c = { ...message('c', 8, 'b'), excludedFromPrompt: true };
		await counter.count('chat', 'one', [c], -1, tokenize);
		expect(calls).toHaveLength(3);
		await counter.count('chat', 'one', [{ ...c, excludedFromPrompt: false }], -1, tokenize);
		expect(calls.at(-1)).toBe(c.content);
		await counter.count('chat', 'two', [b], -1, tokenize);
		await counter.count('other', 'two', [b], -1, tokenize);
		expect(calls).toHaveLength(6);
	});
	test('cancelled counting never produces a partial reminder', async () => {
		const path = [message('a', 10), message('b', 10, 'a')];
		let calls = 0;
		const count = await new MemoryReminderCounter().count('chat', 'encoding', path, -1,
			text => { calls++; return text.length; }, () => calls > 0);
		expect(count).toBeNull();
		expect(calls).toBe(1);
	});
});
