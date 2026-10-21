import { expect, test } from 'bun:test';
import { DoubleTapGesture } from './double-tap';

const point = (time: number, x = 100, y = 100, id = 1) => ({ time, x, y, id });
function tap(gesture: DoubleTapGesture, time: number, x = 100, y = 100, id = 1) {
	gesture.start(point(time, x, y, id));
	return gesture.end(point(time + 40, x, y, id));
}

test('two short nearby touch presses open once, even when pointer ids change', () => {
	const gesture = new DoubleTapGesture();
	expect(tap(gesture, 0)).toBe(false);
	expect(tap(gesture, 140, 104, 102, 2)).toBe(true);
	expect(gesture.active).toBe(false);
	expect(tap(gesture, 260)).toBe(false);
});

test('dragging during either press cancels the entire sequence, even after returning to its start', () => {
	for (const second of [false, true]) {
		const gesture = new DoubleTapGesture();
		if (second) tap(gesture, 0);
		gesture.start(point(100));
		gesture.move(point(120, 100, 120));
		gesture.move(point(140));
		expect(gesture.end(point(150))).toBe(false);
		expect(tap(gesture, 200)).toBe(false);
	}
});

test('small finger jitter is allowed without treating a steady tap as a drag', () => {
	const gesture = new DoubleTapGesture();
	gesture.start(point(0)); gesture.move(point(10, 102, 103));
	expect(gesture.end(point(40, 102, 103))).toBe(false);
	expect(tap(gesture, 140)).toBe(true);
});

test('a long press used for text selection never arms or completes an edit', () => {
	for (const second of [false, true]) {
		const gesture = new DoubleTapGesture();
		if (second) tap(gesture, 0);
		gesture.start(point(100));
		expect(gesture.end(point(500))).toBe(false);
		expect(tap(gesture, 600)).toBe(false);
	}
});

test('scroll, pointer cancellation or disabling the action requires a fresh pair', () => {
	const gesture = new DoubleTapGesture();
	tap(gesture, 0); gesture.cancel();
	expect(tap(gesture, 150)).toBe(false);
	expect(tap(gesture, 250)).toBe(true);
});

test('slow taps and taps at different reading positions do not combine', () => {
	for (const next of [point(500), point(140, 160, 100)]) {
		const gesture = new DoubleTapGesture(); tap(gesture, 0);
		gesture.start(next);
		expect(gesture.end({ ...next, time: next.time + 40 })).toBe(false);
	}
});

test('a second finger invalidates the gesture rather than completing it', () => {
	const gesture = new DoubleTapGesture(); tap(gesture, 0);
	gesture.start(point(100)); gesture.start(point(110, 100, 100, 2));
	expect(gesture.end(point(130, 100, 100, 2))).toBe(false);
	expect(gesture.end(point(140))).toBe(false);
	expect(tap(gesture, 200)).toBe(false);
});
