import { describe, expect, test } from 'bun:test';
import { parseChapterResponse } from './chapter-response';

describe('chapter model responses', () => {
	test('reads the title and content without retaining JSON syntax', () => {
		expect(parseChapterResponse(JSON.stringify({ title: '  The library door  ', content: '  She said "come in".\n\nA visitor arrived.  ' })))
			.toEqual({ title: 'The library door', content: 'She said "come in".\n\nA visitor arrived.' });
	});

	test('accepts JSON fences and the shared extractor’s prose wrapper', () => {
		const json = '{"title":"A discovery","content":"They found a letter."}';
		for (const raw of [json, '```json\n' + json + '\n```', '```JSON\n' + json + '\n```', '```\n' + json + '\n```', 'Here is the chapter:\n' + json]) {
			expect(parseChapterResponse(raw)).toEqual({ title: 'A discovery', content: 'They found a letter.' });
		}
	});

	test('preserves plain text and leaves the existing draft title alone', () => {
		expect(parseChapterResponse('  They read the letter.\n\nIt changed their plans.  '))
			.toEqual({ content: 'They read the letter.\n\nIt changed their plans.' });
		expect(parseChapterResponse('They discussed {a possible plan}.')).toEqual({ content: 'They discussed {a possible plan}.' });
	});

	test('only consumes title and content from the model', () => {
		expect(parseChapterResponse('{"title":"A discovery","content":"A letter arrived.","source":[],"id":"model-id"}'))
			.toEqual({ title: 'A discovery', content: 'A letter arrived.' });
	});

	test.each([
		'{}', '[]', '{"title":"Missing content"}', '{"content":"Missing title"}',
		'{"title":null,"content":"Text"}', '{"title":12,"content":"Text"}',
		'{"title":"Title","content":["Text"]}', '{"title":"Title","content":null}',
		'{"title":"  ","content":"Text"}', '{"title":"Title","content":"\\n "}',
		'[{"title":"Title","content":"Text"}]', '{"title":"Cut off","content":"Unfinished',
		'```json\n{"title":"Cut off",\n```', '```json\nnot JSON\n```'
	])('rejects invalid structured output: %s', (raw) => {
		expect(() => parseChapterResponse(raw)).toThrow('invalid chapter JSON');
	});

	test('rejects an empty model response', () => {
		expect(() => parseChapterResponse(' \n ')).toThrow('returned no chapter');
	});
});
