/**
 * Prompt-log accounting.
 *
 * The debug panel's whole claim is that it states the complete request, so these guard
 * estimation, provider-reported usage, image collection, and request-field rendering.
 */
import { describe, test, expect } from 'bun:test';

import { entryImages, promptSize, requestChips } from './format';
import type { PromptLogEntry } from './types';

function entry(id: string, over: Partial<PromptLogEntry> = {}): PromptLogEntry {
	return {
		id,
		source: 'chat',
		kind: 'completion',
		provider: 'openrouter',
		model: 'test/model',
		messages: [{ role: 'system', content: 'Write the next reply.' }],
		stream: true,
		startedAt: 1000,
		status: 'done',
		...over
	};
}

describe('prompt sizing', () => {
	test('provider-reported prompt tokens win, and are labelled as reported', () => {
		const size = promptSize(entry('c', { usage: { promptTokens: 12081, completionTokens: 40, totalTokens: 12121 } }));
		expect(size).toEqual({ tokens: 12081, reported: true });
	});

	test('a zero prompt count is not a report: it falls to the estimate, under the estimate label', () => {
		const size = promptSize(entry('d', { usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }));
		expect(size.reported).toBe(false);
		expect(size.tokens).toBeGreaterThan(0);
	});

	test('image attachments are collected across every message that carried one', () => {
		const e = entry('e', {
			messages: [
				{ role: 'system', content: 'rules' },
				{ role: 'user', content: 'look', images: ['images/chat/a.png', 'images/chat/b.png'] },
				{ role: 'user', content: 'and this', images: ['images/characters/c.png'] }
			]
		});
		expect(entryImages(e)).toEqual(['images/chat/a.png', 'images/chat/b.png', 'images/characters/c.png']);
	});
});

describe('request fields', () => {
	test('tuning and routing reach the panel field by field', () => {
		const chips = requestChips(
			entry('f', {
				params: { temperature: 1.1, max_tokens: 800 },
				tuning: { reasoningEffort: 'high', promptCaching: true, parseInlineReasoning: false },
				routing: { sort: 'throughput', order: ['deepinfra', 'together'] }
			})
		);
		expect(chips).toContain('temperature 1.1');
		expect(chips).toContain('max_tokens 800');
		expect(chips).toContain('reasoningEffort high');
		expect(chips).toContain('promptCaching on');
		expect(chips).toContain('parseInlineReasoning off');
		expect(chips).toContain('route.sort throughput');
		expect(chips).toContain('route.order deepinfra, together');
	});

	test('a value carried in both params and a top-level field is stated once', () => {
		const chips = requestChips(entry('g', { params: { temperature: 0.7, max_tokens: 600 }, temperature: 0.7, maxTokens: 600 }));
		expect(chips.filter((c) => c.startsWith('temperature')).length).toBe(1);
		expect(chips.filter((c) => c.startsWith('max_tokens')).length).toBe(1);
	});

	test('the stream mode is always stated', () => {
		expect(requestChips(entry('h', { stream: false }))).toContain('no-stream');
		expect(requestChips(entry('i', { stream: true }))).toContain('stream');
	});
});
