import { describe, expect, test } from 'bun:test';
import { DEFAULT_GENERATION_SETTINGS, type GenerationSettings, type ResolvedParamPolicy } from '#lib/types/llm.ts';
import { buildGenerationParams, declaredSamplingParams, resolveParamPolicy } from './sampling';

describe('optional temperature', () => {
	test('temperature pills preserve the old send preference and control request omission', () => {
		const settings = { ...DEFAULT_GENERATION_SETTINGS, temperature: 0.7, sendTemperature: false };
		const off = declaredSamplingParams(['temperature', 'top_p'], settings);
		expect(off).toEqual(['top_p']);
		expect(buildGenerationParams(settings, undefined, resolveParamPolicy('declared', off), 'test-model', false))
			.not.toHaveProperty('temperature');
		const enabled = { ...settings, sendTemperature: true };
		const on = declaredSamplingParams([], enabled);
		expect(on).toEqual(['temperature']);
		expect(buildGenerationParams(enabled, undefined, resolveParamPolicy('declared', on), 'test-model', false).temperature).toBe(0.7);
	});
	for (const policy of ['base-only', 'reported', ['top_p', 'max_tokens']] as ResolvedParamPolicy[]) {
		test(`omits disabled temperature under ${JSON.stringify(policy)}`, () => {
			const settings = { ...DEFAULT_GENERATION_SETTINGS, temperature: 0.7, sendTemperature: false, topP: 0.9 };
			const params = buildGenerationParams(settings, undefined, policy, 'test-model', false);
			expect(params).not.toHaveProperty('temperature');
			expect(params.max_tokens).toBe(settings.maxTokens);
			if (policy !== 'base-only') expect(params.top_p).toBe(0.9);
			expect(settings.temperature).toBe(0.7);
			expect(buildGenerationParams({ ...settings, sendTemperature: true }, undefined, policy, 'test-model', false).temperature)
				.toBe(0.7);
		});
	}

	test('older settings and explicitly configured zero still send temperature', () => {
		const { sendTemperature: _toggle, ...legacy } = DEFAULT_GENERATION_SETTINGS;
		expect(buildGenerationParams(legacy as GenerationSettings, undefined, 'base-only', 'test-model', false).temperature)
			.toBe(DEFAULT_GENERATION_SETTINGS.temperature);
		expect(buildGenerationParams({ ...DEFAULT_GENERATION_SETTINGS, temperature: 0 }, undefined, 'reported', 'test-model', false).temperature)
			.toBe(0);
	});

	test('enabling temperature still respects reported model capabilities', () => {
		const model = { supportedParameters: ['max_tokens'] } as Parameters<typeof buildGenerationParams>[1];
		expect(buildGenerationParams(DEFAULT_GENERATION_SETTINGS, model, 'reported', 'test-model', false))
			.not.toHaveProperty('temperature');
	});
});
