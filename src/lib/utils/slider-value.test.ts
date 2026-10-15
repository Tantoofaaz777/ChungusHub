import { expect, test } from 'bun:test';
import { parseSliderValue } from './slider-value';

test('fractional values accept either decimal separator, including negative penalties and zero', () => {
	expect(parseSliderValue('0,75', 0, 2, 0.01)).toBe(0.75);
	expect(parseSliderValue('1.25', 0, 2, 0.01)).toBe(1.25);
	expect(parseSliderValue('-0,35', -2, 2, 0.01)).toBe(-0.35);
	expect(parseSliderValue('0', 0, 2, 0.01)).toBe(0);
});

test('token counts preserve exact off-ladder values and accept pasted thousands separators', () => {
	for (const text of ['126976', '126.976', '126,976', '126 976']) {
		expect(parseSliderValue(text, 1, 2000000, 1, true)).toBe(126976);
	}
	expect(parseSliderValue('12345', 1, 2000000, 1, true)).toBe(12345);
});

test('incomplete and invalid drafts are not converted into valid settings', () => {
	for (const text of ['', ' ', '-', '+', '.', ',', 'abc', '1,2,3', '12abc']) {
		expect(parseSliderValue(text, -2, 2, 0.01)).toBeNull();
	}
	expect(parseSliderValue('12.5', 1, 2000000, 1, true)).toBeNull();
});

test('valid values respect the control bounds and step without floating point residue', () => {
	expect(parseSliderValue('4', 0, 2, 0.01)).toBe(2);
	expect(parseSliderValue('-5', -2, 2, 0.01)).toBe(-2);
	expect(parseSliderValue('0.975', 0, 1, 0.01)).toBe(0.98);
	expect(parseSliderValue('1.005', 0, 2, 0.01)).toBe(1.01);
	expect(parseSliderValue('17.8', 0, 200, 1)).toBe(18);
	expect(parseSliderValue('0', 1, 2000000, 1, true)).toBe(1);
});
