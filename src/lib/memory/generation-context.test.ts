import { describe, expect, test } from 'bun:test';
import { captureScene, type CompactionLevel, type MemoryScene, type SceneMessage } from '#shared/memory-scenes.ts';
import { generationSourcePrompt, normalizePreviousSummaries, previousGenerationSummaries } from './generation-context';

function fixture() {
	const path: SceneMessage[] = Array.from({ length: 16 }, (_, i) => ({
		id: `m${i}`, parentId: i ? `m${i - 1}` : null, role: 'assistant', content: `Source ${i}`
	}));
	const chapters: MemoryScene[] = path.map((message, i) => ({
		id: `c${i}`, chatId: 'chat', title: `Chapter ${99 - i}`, content: `Summary ${i}`,
		source: captureScene([message]), createdAt: 100 - i, updatedAt: 100 - i, revision: 1, reviewReason: null
	}));
	const aggregate = (id: string, level: CompactionLevel, children: MemoryScene[]): MemoryScene => ({
		...chapters[0], id, title: id, content: `Summary ${id}`, level,
		source: children.flatMap(child => child.source), children: children.map(child => ({ id: child.id, revision: child.revision }))
	});
	const select = (scenes: MemoryScene[], start = 10, count = 6) => previousGenerationSummaries(scenes, path, path, 'chat', captureScene(path.slice(start, start + 2)), count).map(scene => scene.id);
	return { path, chapters, aggregate, select };
}

describe('previous summary generation context', () => {
	test('defaults to six, accepts zero and custom integers, and normalizes invalid settings', () => {
		for (const value of [undefined, null, '8', NaN, Infinity, {}, true]) expect(normalizePreviousSummaries(value)).toBe(6);
		expect(normalizePreviousSummaries(0)).toBe(0);
		expect(normalizePreviousSummaries(12)).toBe(12);
		expect(normalizePreviousSummaries(3.8)).toBe(3);
		expect(normalizePreviousSummaries(-1)).toBe(0);
		expect(normalizePreviousSummaries(Number.MAX_VALUE)).toBe(Number.MAX_SAFE_INTEGER);
	});
	test('takes the newest N preceding summaries, then orders by transcript rather than titles, storage or timestamps', () => {
		const { chapters, select } = fixture();
		expect(select([...chapters].reverse())).toEqual(['c4', 'c5', 'c6', 'c7', 'c8', 'c9']);
		expect(select(chapters, 10, 2)).toEqual(['c8', 'c9']);
		expect(select(chapters, 10, 0)).toEqual([]);
		expect(select(chapters, 2, 100)).toEqual(['c0', 'c1']);
	});
	test('mixes active chapters, arcs and volumes without duplicating their compacted descendants', () => {
		const { chapters, aggregate, select } = fixture();
		const a0 = aggregate('a0', 'arc', chapters.slice(0, 2)), a1 = aggregate('a1', 'arc', chapters.slice(2, 4));
		const a2 = aggregate('a2', 'arc', chapters.slice(4, 6)), volume = aggregate('v0', 'volume', [a0, a1]);
		expect(select([...chapters, a0, a1, a2, volume].reverse(), 7)).toEqual(['v0', 'a2', 'c6']);
	});
	test('excludes other chats/branches, stale summaries, overlaps with the range and later memories', () => {
		const { path, chapters, select } = fixture();
		const branch = { ...path[5], id: 'other-branch' };
		const scenes = [
			...chapters.filter((_, i) => i !== 7 && i !== 9),
			{ ...chapters[1], id: 'foreign', chatId: 'foreign-chat' },
			{ ...chapters[2], id: 'stale', reviewReason: 'Needs review' },
			{ ...chapters[5], id: 'branched', source: captureScene([branch]) },
			{ ...chapters[7], id: 'overlap', source: captureScene(path.slice(7, 12)) }
		];
		// A changed source invalidates its saved summary, independently of reviewReason.
		path[8].content = 'Changed';
		expect(previousGenerationSummaries(scenes, path, [...path, branch], 'chat', captureScene(path.slice(10, 12)), 100).map(s => s.id))
			.toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
		expect(select(chapters, 0)).toEqual([]);
	});
	test('a regenerated earlier memory never receives itself or later summaries', () => {
		const { chapters, select } = fixture();
		expect(select(chapters, 4, 100)).toEqual(['c0', 'c1', 'c2', 'c3']);
	});
	test('missing source boundaries produce no references', () => {
		const { path, chapters } = fixture();
		expect(previousGenerationSummaries(chapters, path, path, 'chat', [], 6)).toEqual([]);
		expect(previousGenerationSummaries(chapters, path, path, 'chat', [{ id: 'missing', signature: '' }], 6)).toEqual([]);
	});
	test('reference material precedes the separate source block for every generation level', () => {
		const { chapters } = fixture();
		for (const level of ['chapter', 'arc', 'volume'] as const) {
			const prompt = generationSourcePrompt(level, 'Selected source', chapters.slice(0, 2));
			expect(prompt).toContain(`Create a ${level}`);
			expect(prompt).toContain('Do not summarize them again');
			expect(prompt.indexOf(chapters[0].content)).toBeLessThan(prompt.indexOf(chapters[1].content));
			expect(prompt.indexOf(chapters[1].content)).toBeLessThan(prompt.indexOf('=== SOURCE TO SUMMARIZE ==='));
			expect(prompt).toEndWith('=== SOURCE TO SUMMARIZE ===\n\nSelected source\n\n=== END SOURCE ===');
			expect(generationSourcePrompt(level, 'Selected source', [])).not.toContain('PREVIOUS SCENE CONTEXT');
		}
	});
});
