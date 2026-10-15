import { describe, expect, test } from 'bun:test';
import { customBodyError, mergeCustomBody, parseCustomBody } from './custom-body';

describe('custom request body', () => {
	test('accepts nested JSON and treats an empty object or blank text as disabled', () => {
		expect(parseCustomBody('{"enabled":true,"options":{"list":[1,null,"x"]}}')).toEqual({
			ok: true, value: { enabled: true, options: { list: [1, null, 'x'] } }
		});
		for (const text of ['', '  ', '{}']) expect(parseCustomBody(text)).toEqual({ ok: true, value: undefined });
	});
	test('rejects syntax errors, non-object roots and fields managed by the app', () => {
		for (const text of ['{"x":}', '[]', 'null', '3', '"text"', '{"model":"other"}', '{"messages":[]}', '{"stream":false}']) {
			expect(parseCustomBody(text).ok).toBe(false);
		}
		expect(customBodyError({ nested: { value: Infinity } })).not.toBeNull();
		expect(customBodyError({ nested: undefined })).not.toBeNull();
	});
	test('overrides scalars and arrays, extends nested objects, and preserves the original settings', () => {
		const base = { temperature: 1, reasoning: { effort: 'high', exclude: true }, stop: ['old'], metadata: { old: true } };
		const extra = { temperature: 0.4, reasoning: { effort: 'low' }, stop: ['new'], metadata: null };
		expect(mergeCustomBody(base, extra)).toEqual({ temperature: 0.4, reasoning: { effort: 'low', exclude: true }, stop: ['new'], metadata: null });
		expect(base.reasoning.effort).toBe('high');
		expect(base.stop).toEqual(['old']);
		expect(extra.reasoning).toEqual({ effort: 'low' });
		expect(mergeCustomBody(base)).toBe(base);
	});
	test('keeps prototype-like JSON keys as data without polluting objects', () => {
		const custom = JSON.parse('{"__proto__":{"polluted":true},"nested":{"constructor":{"prototype":{"polluted":true}}}}');
		const result = mergeCustomBody({ nested: {} }, custom);
		expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
		expect(Object.hasOwn(result, '__proto__')).toBe(true);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(JSON.parse(JSON.stringify(result))).toEqual(custom);
	});
	test('also validates direct requests that bypass the editor', () => {
		expect(() => mergeCustomBody({}, { stream: false })).toThrow('"stream" is managed');
	});
});
