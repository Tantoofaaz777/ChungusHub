import { describe, expect, test } from 'bun:test';
import { getControlDefaultValue, getControlValue, formatControlForPrompt } from './prompt-controls';
import type { PromptControl } from '#lib/types/database.ts';

const control = (over: Partial<PromptControl> & Pick<PromptControl, 'type'>): PromptControl => ({
	id: 'c',
	macro: 'm',
	label: 'L',
	...over
});

describe('control defaults', () => {
	test('each type falls back to something its widget can render', () => {
		expect(getControlDefaultValue(control({ type: 'text' }))).toBe('');
		expect(getControlDefaultValue(control({ type: 'toggle' }))).toBe(false);
		expect(getControlDefaultValue(control({ type: 'slider', min: 100 }))).toBe(100);
		expect(getControlDefaultValue(control({ type: 'tags' }))).toEqual([]);
	});

	test('a select with no declared default starts on its first option', () => {
		const c = control({
			type: 'select',
			options: [
				{ id: 'a', label: 'A', injectedText: 'A!' },
				{ id: 'b', label: 'B', injectedText: 'B!' }
			]
		});
		expect(getControlDefaultValue(c)).toBe('a');
	});

	test('a range with no declared default spans the whole track', () => {
		expect(getControlDefaultValue(control({ type: 'range', min: 200, max: 900 }))).toEqual([200, 900]);
	});
});

describe('stored values', () => {
	test('a value of the wrong type degrades to the default rather than reaching the prompt', () => {
		const slider = control({ type: 'slider', min: 0, max: 10, defaultNumber: 4 });
		expect(getControlValue(slider, 'not a number')).toBe(4);
		expect(getControlValue(control({ type: 'tags' }), 'not an array')).toEqual([]);
	});

	test('a range is ordered low-first and clamped into its track', () => {
		const c = control({ type: 'range', min: 100, max: 800 });
		expect(getControlValue(c, [600, 400])).toEqual([400, 600]);
		expect(getControlValue(c, [-50, 5000])).toEqual([100, 800]);
	});

	test('a malformed range falls back instead of injecting half a span', () => {
		const c = control({ type: 'range', min: 0, max: 10, defaultRange: [2, 8] });
		expect(getControlValue(c, [3])).toEqual([2, 8]);
		expect(getControlValue(c, ['a', 'b'])).toEqual([2, 8]);
	});
});

describe('prompt injection', () => {
	test('a text template frames the value, and blank text injects nothing at all', () => {
		const c = control({ type: 'text', textTemplate: 'Extra rules: {{value}}' });
		expect(formatControlForPrompt(c, 'no purple prose')).toBe('Extra rules: no purple prose');
		expect(formatControlForPrompt(c, '   ')).toBe('');
	});

	test('a toggle injects the side it is on', () => {
		const c = control({ type: 'toggle', onText: 'ON!', offText: 'OFF!' });
		expect(formatControlForPrompt(c, true)).toBe('ON!');
		expect(formatControlForPrompt(c, false)).toBe('OFF!');
	});

	test('a slider without a template injects the bare number', () => {
		const c = control({ type: 'slider', min: 0, max: 10 });
		expect(formatControlForPrompt(c, 7)).toBe('7');
	});

	test('a range fills both ends of its template', () => {
		const c = control({
			type: 'range',
			min: 100,
			max: 900,
			rangeTemplate: 'Write between {{min}} and {{max}} words.'
		});
		expect(formatControlForPrompt(c, [400, 600])).toBe('Write between 400 and 600 words.');
		expect(formatControlForPrompt(control({ type: 'range', min: 1, max: 9 }), [2, 5])).toBe('2–5');
	});

	test('tags join their options with the separator and skip the empty ones', () => {
		const c = control({
			type: 'tags',
			tagSeparator: ' ',
			options: [
				{ id: 'a', label: 'A', injectedText: 'Alpha.' },
				{ id: 'b', label: 'B', injectedText: '' },
				{ id: 'c', label: 'C', injectedText: 'Gamma.' }
			]
		});
		expect(formatControlForPrompt(c, ['a', 'b', 'c'])).toBe('Alpha. Gamma.');
	});

	test("a reader's own tag injects verbatim, but only where the author allowed one", () => {
		const options = [{ id: 'a', label: 'A', injectedText: 'Alpha.' }];
		const open = control({ type: 'tags', allowCustom: true, options });
		const closed = control({ type: 'tags', options });
		expect(formatControlForPrompt(open, ['a', 'ministrations'])).toBe('Alpha., ministrations');
		// Without free entry the same entry is a stale option id, and a stale id is silence.
		expect(formatControlForPrompt(closed, ['a', 'ministrations'])).toBe('Alpha.');
	});

	test('a select whose stored option was deleted injects nothing', () => {
		const c = control({ type: 'select', options: [{ id: 'a', label: 'A', injectedText: 'Alpha.' }] });
		expect(formatControlForPrompt(c, 'deleted-option')).toBe('');
	});
});
