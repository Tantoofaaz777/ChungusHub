import { describe, expect, test } from 'bun:test';
import { AnthropicNativeProvider } from './anthropic-native';
import { anthropic } from './providers/anthropic';

describe('Anthropic stop-reason normalization', () => {
	const provider = new AnthropicNativeProvider(anthropic) as unknown as {
		mapStopReason(reason: string | null): 'stop' | 'length' | 'error';
	};

	test('normal completion reasons remain stops', () => {
		expect(provider.mapStopReason('end_turn')).toBe('stop');
		expect(provider.mapStopReason('stop_sequence')).toBe('stop');
	});

	test('token and context limits remain length finishes', () => {
		expect(provider.mapStopReason('max_tokens')).toBe('length');
		expect(provider.mapStopReason('model_context_window_exceeded')).toBe('length');
	});
});
