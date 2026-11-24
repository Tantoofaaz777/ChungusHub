import { describe, expect, test } from 'bun:test';
import { AnthropicNativeProvider } from './anthropic-native';
import { anthropic } from './providers/anthropic';
import type { LLMCompletionResult } from './types';

describe('Anthropic stop-reason normalization', () => {
	const provider = new AnthropicNativeProvider(anthropic) as unknown as {
		completionFinish(reason: string | null, explanation: string | null): Pick<LLMCompletionResult, 'finishReason' | 'error'>;
	};

	test('normal completion reasons remain stops', () => {
		expect(provider.completionFinish('end_turn', null)).toEqual({ finishReason: 'stop' });
		expect(provider.completionFinish('stop_sequence', null)).toEqual({ finishReason: 'stop' });
	});

	test('token and context limits remain length finishes', () => {
		expect(provider.completionFinish('max_tokens', null)).toEqual({ finishReason: 'length' });
		expect(provider.completionFinish('model_context_window_exceeded', null)).toEqual({ finishReason: 'length' });
	});

	test.each([
		['tool_use', 'requested a tool call'],
		['pause_turn', 'paused the turn'],
		['refusal', 'Provider explanation'],
		['future_reason', 'generation ended with']
	])('reports why the request ended with %s', (reason, description) => {
		const finish = provider.completionFinish(reason, 'Provider explanation');
		expect(finish.finishReason).toBe('error');
		expect(finish.error).toContain(`stop_reason: ${reason}`);
		expect(finish.error).toContain(description);
	});
});
