import { describe, expect, test } from 'bun:test';
import { findEditorMatches, markEditorMatches, replaceAllEditorMatches } from './editor-search';
import { tokenizeEditorSyntax } from './editor-syntax';

const options = { matchCase: false, wholeWord: false };

describe('expanded editor search', () => {
	test('uses literal chat matching, Unicode case folding and word boundaries', () => {
		expect(findEditorMatches('a.b axb A.B', 'a.b', options)).toEqual([
			{ start: 0, end: 3 }, { start: 8, end: 11 }
		]);
		expect(findEditorMatches('Kapı KAPI kapılar', 'kapı', { ...options, wholeWord: true })).toHaveLength(2);
		expect(findEditorMatches('Door door DOOR', 'door', { ...options, matchCase: true })).toEqual([
			{ start: 5, end: 9 }
		]);
	});

	test('keeps UTF-16 selection offsets after emoji and across newlines', () => {
		expect(findEditorMatches('😀 cat\ncat', 'cat', options)).toEqual([
			{ start: 3, end: 6 }, { start: 7, end: 10 }
		]);
		expect(findEditorMatches('a\nb', 'a\nb', options)).toEqual([{ start: 0, end: 3 }]);
	});

	test('empty queries and zero budgets find nothing; spaces remain searchable', () => {
		expect(findEditorMatches('text', '', options)).toEqual([]);
		expect(findEditorMatches('text', 't', options, 0)).toEqual([]);
		expect(findEditorMatches('a b c', ' ', options)).toHaveLength(2);
	});

	test('replacement dollar signs and macro syntax stay literal', () => {
		expect(replaceAllEditorMatches('cat CAT', 'cat', '$& {{char}} $1', options))
			.toBe('$& {{char}} $1 $& {{char}} $1');
	});

	test('Replace all supports deletion and never searches its own replacements', () => {
		expect(replaceAllEditorMatches('cat cat', 'cat', '', options)).toBe(' ');
		expect(replaceAllEditorMatches('cat cat', 'cat', 'catcat', options)).toBe('catcat catcat');
		expect(replaceAllEditorMatches('cat', '', 'dog', options)).toBe('cat');
	});

	test('Replace all is not truncated by the highlight budget', () => {
		const text = 'x '.repeat(2500);
		expect(findEditorMatches(text, 'x', options)).toHaveLength(2000);
		expect(replaceAllEditorMatches(text, 'x', 'y', options)).toBe('y '.repeat(2500));
	});

	test('matches crossing syntax boundaries retain their index and syntax colors', () => {
		const text = 'Hello {{char}} <tag>world</tag>!';
		const segments = markEditorMatches(tokenizeEditorSyntax(text), findEditorMatches(text, 'o {{char}} <tag>w', options));
		expect(segments.map((s) => s.text).join('')).toBe(text);
		expect(segments.filter((s) => s.match === 0).map((s) => [s.kind, s.text])).toEqual([
			['plain', 'o '], ['macro', '{{char}}'], ['plain', ' '], ['tag', '<tag>'], ['plain', 'w']
		]);
	});

	test('adjacent matches remain distinct without adding or dropping text', () => {
		const text = '{{char}}{{char}}';
		expect(markEditorMatches(tokenizeEditorSyntax(text), findEditorMatches(text, '{{char}}', options)))
			.toEqual([{ kind: 'macro', text: '{{char}}', match: 0 }, { kind: 'macro', text: '{{char}}', match: 1 }]);
		expect(markEditorMatches(tokenizeEditorSyntax(text), []).map((s) => s.text).join('')).toBe(text);
		expect(markEditorMatches([], [])).toEqual([]);
	});
});
