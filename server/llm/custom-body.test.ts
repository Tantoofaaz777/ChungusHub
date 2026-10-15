import { afterAll, describe, expect, test } from 'bun:test';
import { OpenAICompatibleProvider } from './openai-compatible';
import { AnthropicNativeProvider } from './anthropic-native';
import { anthropic } from './providers/anthropic';

const requests: Record<string, unknown>[] = [];
const endpoint = Bun.serve({
	port: 0,
	async fetch(req) {
		if (req.method === 'GET') return Response.json({ data: [{ id: 'test-model' }], has_more: false });
		const body = await req.json() as Record<string, unknown>;
		requests.push(body);
		const native = new URL(req.url).pathname.endsWith('/messages');
		if (!body.stream) return Response.json(native
			? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }
			: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
		const events = native ? [
			{ type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
			{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } },
			{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
			{ type: 'message_stop' }
		] : [{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }];
		return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + (native ? '' : 'data: [DONE]\n\n'), {
			headers: { 'content-type': 'text/event-stream' }
		});
	}
});
afterAll(() => endpoint.stop(true));

describe('custom body on the actual provider request', () => {
	for (const native of [false, true]) {
		for (const streaming of [false, true]) {
			test(`${native ? 'Anthropic' : 'OpenAI compatible'}, ${streaming ? 'streamed' : 'non-streamed'}`, async () => {
				const provider = native ? new AnthropicNativeProvider(anthropic) : new OpenAICompatibleProvider({
					name: 'custom-body-test', displayName: 'Custom body test', defaultBaseUrl: '',
					requiresApiKey: false, baseUrlEditable: false,
					reasoning: { efforts: { high: 'high' }, effortField: 'reasoning-object', exclude: true }
				});
				provider.configure({ apiKey: 'local-test-only', baseUrl: `http://127.0.0.1:${endpoint.port}/v1` });
				let received = '';
				const result = await provider.complete({
					model: 'test-model', messages: [{ role: 'user', content: 'hello' }],
					params: { temperature: 0.8 },
					tuning: { reasoningEffort: 'high', showReasoning: false },
					customBody: { temperature: 0.3, reasoning: { budget: 2048 }, metadata: { enabled: true, tags: ['x', 'y'], empty: null } },
					onToken: streaming ? text => { received += text; } : undefined
				});
				const sent = requests.at(-1)!;
				expect(result.content).toBe('ok');
				if (streaming) expect(received).toBe('ok');
				expect(sent.temperature).toBe(0.3);
				expect(sent.reasoning).toEqual(native ? { budget: 2048 } : { effort: 'high', exclude: true, budget: 2048 });
				expect(sent.metadata).toEqual({ enabled: true, tags: ['x', 'y'], empty: null });
				expect(sent.model).toBe('test-model');
				expect(sent.messages).toEqual(native ? [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] : [{ role: 'user', content: 'hello' }]);
				expect(Boolean(sent.stream)).toBe(streaming);
			});
		}
	}
});
