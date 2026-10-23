import { describe, expect, test } from 'bun:test';
import { trackReasoning, reasoningDuration, reasoningLabel } from './reasoning-time';

describe('reasoning phase clock', () => {
	test('starts at the first thinking token, excludes the initial wait, and stops at the last thinking token', () => {
		expect(trackReasoning(null, 'content', 500)).toBeNull();
		let clock = trackReasoning(null, 'thinking', 5000)!;
		expect(reasoningDuration(clock, 8000)).toBe(3000);
		clock = trackReasoning(clock, 'thinking', 22000)!;
		clock = trackReasoning(clock, 'content', 23000)!;
		expect(reasoningDuration(clock, 60000)).toBe(17000);
		expect(reasoningLabel(clock.active, reasoningDuration(clock, 60000))).toBe('Thought for 17s');
	});

	test('retains the first timestamp if thinking resumes between answer chunks', () => {
		const first = trackReasoning(null, 'thinking', 1000)!;
		const paused = trackReasoning(first, 'content', 3000)!;
		const resumed = trackReasoning(paused, 'thinking', 6000)!;
		expect(first.active).toBe(true);
		expect(paused.active).toBe(false);
		expect(resumed).toEqual({ startedAt: 1000, lastTokenAt: 6000, active: true });
		expect(reasoningDuration(resumed, 7000)).toBe(6000);
	});

	test('shows whole seconds and handles historical messages with no timing', () => {
		expect(reasoningLabel(true, 17800)).toBe('Thinking • 17s');
		expect(reasoningLabel(false, 17000)).toBe('Thought for 17s');
		expect(reasoningLabel(false, 0)).toBe('Thought for 0s');
		expect(reasoningLabel(false, null)).toBe('Thought');
		expect(reasoningLabel(true, null)).toBe('Thinking');
	});

	test('does not display negative time after a wall-clock adjustment', () => {
		const clock = trackReasoning(null, 'thinking', 9000)!;
		expect(reasoningDuration(clock, 8000)).toBe(0);
		expect(reasoningLabel(true, -1000)).toBe('Thinking • 0s');
	});
});
