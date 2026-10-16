import { describe, expect, test } from 'bun:test';
import { captureScene, prepareCompaction, resolveScenes, sceneHistory, type MemoryScene, type SceneMessage, type CompactionLevel } from './memory-scenes';

function hierarchy() {
	const path: SceneMessage[] = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, parentId: i ? `m${i - 1}` : null, role: i % 2 ? 'user' : 'assistant', content: `Original ${i}` }));
	const chapters: MemoryScene[] = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, chatId: 'chat', title: `Chapter ${i + 1}`, content: `Chapter text ${i}`,
		source: captureScene(path.slice(i * 2, i * 2 + 2)), createdAt: 1, updatedAt: 1, revision: 1, reviewReason: null }));
	const aggregate = (id: string, level: CompactionLevel, children: MemoryScene[]): MemoryScene => ({
		...chapters[0], id, level, title: id, content: `${level} text ${id}`, children: children.map(c => ({ id: c.id, revision: c.revision })), source: children.flatMap(c => c.source)
	});
	const arcs = [aggregate('a0', 'arc', chapters.slice(0, 2)), aggregate('a1', 'arc', chapters.slice(2))];
	const volume = aggregate('v', 'volume', arcs);
	return { path, chapters, arcs, volume, scenes: [...chapters, ...arcs, volume], aggregate };
}

describe('chapter → arc → volume replacement', () => {
	test('only the highest valid summary enters the prompt, regardless of storage order', () => {
		const { path, scenes, volume } = hierarchy();
		for (const rows of [scenes, [...scenes].reverse()]) {
			const resolved = resolveScenes(rows, path);
			expect(resolved.filter(r => r.status === 'active').map(r => r.scene.id)).toEqual([volume.id]);
			expect(resolved.filter(r => r.status === 'covered')).toHaveLength(6);
			const history = sceneHistory(path, rows);
			expect(history).toHaveLength(1);
			expect(history[0].content).toBe('[Volume: v]\nvolume text v\n[End of volume]');
		}
		expect(path[0].content).toBe('Original 0');
	});

	test('removing a volume restores arcs, and removing an arc restores its chapters', () => {
		const { path, scenes } = hierarchy();
		expect(sceneHistory(path, scenes.filter(s => s.id !== 'v')).map(m => m.id)).toEqual(['scene:a0', 'scene:a1']);
		expect(sceneHistory(path, scenes.filter(s => s.id !== 'a0')).map(m => m.id)).toEqual(['scene:c0', 'scene:c1', 'scene:a1']);
	});

	test('a revised chapter invalidates both ancestors while leaving other arcs in use', () => {
		const { path, scenes } = hierarchy();
		const changed = scenes.map(s => s.id === 'c0' ? { ...s, content: 'Reviewed chapter', revision: 2 } : s);
		const states = resolveScenes(changed, path);
		expect(states.find(r => r.scene.id === 'a0')?.status).toBe('review');
		expect(states.find(r => r.scene.id === 'v')?.status).toBe('review');
		expect(sceneHistory(path, changed).map(m => m.id)).toEqual(['scene:c0', 'scene:c1', 'scene:a1']);
	});

	test.each(['edit', 'hide', 'delete'])('source message %s changes invalidate ancestors and preserve uncovered history', change => {
		const { path, scenes } = hierarchy();
		const changed = path.map(m => ({ ...m }));
		if (change === 'edit') changed[0].content = 'Changed';
		if (change === 'hide') changed[0].excludedFromPrompt = true;
		if (change === 'delete') changed.shift();
		const history = sceneHistory(changed, scenes);
		expect(history.some(m => m.id === 'scene:v' || m.id === 'scene:a0' || m.id === 'scene:c0')).toBe(false);
		expect(history.some(m => m.id === 'scene:a1')).toBe(true);
		expect(history.some(m => m.id === 'm1')).toBe(true);
	});

	test('parents cannot replace a range different from the exact ordered child ranges', () => {
		const { path, chapters, arcs } = hierarchy();
		for (const children of [[{ id: 'missing', revision: 1 }, { id: 'c1', revision: 1 }], [{ id: 'c1', revision: 1 }, { id: 'c0', revision: 1 }], [{ id: 'c0', revision: 9 }, { id: 'c1', revision: 1 }]]) {
			const invalid = { ...arcs[0], children };
			expect(resolveScenes([...chapters, invalid], path).at(-1)?.status).toBe('review');
		}
	});

	test('overlapping arcs never consume their chapters twice', () => {
		const { path, chapters, arcs, volume } = hierarchy();
		const duplicate = { ...arcs[0], id: 'another-arc' };
		const rows = [...chapters, ...arcs, duplicate, volume];
		expect(sceneHistory(path, rows).map(m => m.id)).toEqual(['scene:c0', 'scene:c1', 'scene:a1']);
		expect(resolveScenes(rows, path).filter(r => ['a0', 'another-arc', 'v'].includes(r.scene.id)).every(r => r.status === 'review')).toBe(true);
	});

	test('summary selection is chronological and refuses gaps, duplicates and already compacted sources', () => {
		const { path, chapters, arcs, scenes } = hierarchy();
		expect(prepareCompaction('arc', ['c1', 'c0'], chapters, path).children.map(c => c.id)).toEqual(['c0', 'c1']);
		expect(() => prepareCompaction('arc', ['c0', 'c2'], chapters, path)).toThrow('consecutive');
		expect(() => prepareCompaction('arc', ['c0', 'c0'], chapters, path)).toThrow('different');
		expect(() => prepareCompaction('arc', ['c0', 'c1'], scenes, path)).toThrow('already compacted');
		expect(() => prepareCompaction('volume', ['c0', 'c1'], chapters, path)).toThrow('arcs');
		expect(prepareCompaction('volume', ['a1', 'a0'], [...chapters, ...arcs], path).source).toEqual(captureScene(path));
	});

	test('review can reselect a parent’s own covered sources without using another parent’s sources', () => {
		const { path, scenes } = hierarchy();
		expect(prepareCompaction('arc', ['c0', 'c1'], scenes, path, path, 'a0').children).toHaveLength(2);
		expect(() => prepareCompaction('arc', ['c2', 'c3'], scenes, path, path, 'a0')).toThrow('already compacted');
	});

	test('another branch never inherits the volume’s coverage', () => {
		const { path, scenes } = hierarchy();
		const alternate = { ...path[0], id: 'alternate', content: 'Another beginning' };
		expect(sceneHistory([alternate], scenes)).toEqual([alternate]);
		expect(resolveScenes(scenes, [alternate], [...path, alternate]).every(r => r.status === 'other-branch')).toBe(true);
	});
});
