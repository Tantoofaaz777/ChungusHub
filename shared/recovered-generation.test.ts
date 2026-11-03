import { expect, test } from 'bun:test';
import { recoveredResponse, type RecoveredGeneration } from './recovered-generation';
const record = (payload: unknown): RecoveredGeneration => ({ id: 'saved', chatId: 'chat', createdAt: 1, reason: 'Changed context', payload });

test('recovery reads generated responses and continuation patches without inserting them', () => {
	expect(recoveredResponse(record({ content: 'Answer', thinking: 'Thought' }))).toEqual({ content: 'Answer', thinking: 'Thought', kind: 'Response' });
	expect(recoveredResponse(record({ content: 'Old', patch: { content: 'Full continued answer', thinking: null } })))
		.toEqual({ content: 'Full continued answer', thinking: '', kind: 'Continuation' });
});
test('old or malformed saved payloads never become accidental text', () => {
	for (const payload of [null, 'text', [], { content: 123, thinking: {} }, { patch: { content: {}, thinking: false } }]) {
		expect(recoveredResponse(record(payload))).toMatchObject({ content: '', thinking: '' });
	}
});
