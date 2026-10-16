import { expect, test } from 'bun:test';
import { markSceneBoundary } from './scene-selection';
const path = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

test('start and end can be marked directly in either order, including a single message', () => {
	const start = markSceneBoundary(path, null, 'start', 'b');
	expect(markSceneBoundary(path, start, 'end', 'd')).toEqual({ startId: 'b', endId: 'd' });
	const end = markSceneBoundary(path, null, 'end', 'd');
	expect(markSceneBoundary(path, end, 'start', 'b')).toEqual({ startId: 'b', endId: 'd' });
	expect(markSceneBoundary(path, start, 'end', 'b')).toEqual({ startId: 'b', endId: 'b' });
});

test('adjusting an endpoint preserves the other until the boundaries cross', () => {
	const selection = { startId: 'b', endId: 'c' };
	expect(markSceneBoundary(path, selection, 'start', 'a')).toEqual({ startId: 'a', endId: 'c' });
	expect(markSceneBoundary(path, selection, 'end', 'd')).toEqual({ startId: 'b', endId: 'd' });
	expect(markSceneBoundary(path, selection, 'start', 'd')).toEqual({ startId: 'd', endId: null });
	expect(markSceneBoundary(path, selection, 'end', 'a')).toEqual({ startId: null, endId: 'a' });
	expect(selection).toEqual({ startId: 'b', endId: 'c' });
});

test('a changed swipe drops unavailable boundaries and rejects off-path targets', () => {
	const selection = { startId: 'b', endId: 'old-swipe' };
	expect(markSceneBoundary(path, selection, 'start', 'b')).toEqual({ startId: 'b', endId: null });
	expect(markSceneBoundary(path, selection, 'end', 'old-swipe')).toBeNull();
});
