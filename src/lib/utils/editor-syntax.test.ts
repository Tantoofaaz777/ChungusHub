import { describe, expect, test } from 'bun:test';
import { tokenizeEditorSyntax, type EditorSyntaxKind } from './editor-syntax';

function compact(text: string): [EditorSyntaxKind, string][] {
	return tokenizeEditorSyntax(text).map((segment) => [segment.kind, segment.text]);
}

describe('tokenizeEditorSyntax', () => {
	test('colors opening, closing, and self-closing tags with attributes', () => {
		expect(compact('<scene mood="quiet">Text</scene> <pause />')).toEqual([
			['tag', '<scene mood="quiet">'],
			['plain', 'Text'],
			['tag', '</scene>'],
			['plain', ' '],
			['tag', '<pause />']
		]);
	});

	test('a greater-than sign inside a quoted attribute does not end the tag', () => {
		expect(compact('<rule test="score > 4">Keep going</rule>')).toEqual([
			['tag', '<rule test="score > 4">'],
			['plain', 'Keep going'],
			['tag', '</rule>']
		]);
	});

	test('colors engine and custom-control-shaped macros', () => {
		expect(compact('Write as {{char}} for {{user}} using {{style.form}} and {{no_echo}}.')).toEqual([
			['plain', 'Write as '],
			['macro', '{{char}}'],
			['plain', ' for '],
			['macro', '{{user}}'],
			['plain', ' using '],
			['macro', '{{style.form}}'],
			['plain', ' and '],
			['macro', '{{no_echo}}'],
			['plain', '.']
		]);
	});

	test('closed backticks own tag and macro syntax inside them', () => {
		expect(compact('Use `{{char}} <tag>` then {{user}}.')).toEqual([
			['plain', 'Use '],
			['code', '`{{char}} <tag>`'],
			['plain', ' then '],
			['macro', '{{user}}'],
			['plain', '.']
		]);
	});

	test('matching backtick fences may span lines', () => {
		expect(compact('Before\n```\n<tag>{{user}}</tag>\n```\nAfter')).toEqual([
			['plain', 'Before\n'],
			['code', '```\n<tag>{{user}}</tag>\n```'],
			['plain', '\nAfter']
		]);
	});

	test('adjacent syntax runs need no plain separator', () => {
		expect(compact('<a>{{user}}</a>`code`')).toEqual([
			['tag', '<a>'],
			['macro', '{{user}}'],
			['tag', '</a>'],
			['code', '`code`']
		]);
	});

	test('unclosed syntax stays ordinary text', () => {
		const text = 'Keep <open and {{user and `code';
		expect(compact(text)).toEqual([['plain', text]]);
	});

	test('comparison signs and macro-like prose stay ordinary text', () => {
		const text = 'Keep x < 10, {user}, {{ user }}, and <tag!> unchanged.';
		expect(compact(text)).toEqual([['plain', text]]);
	});

	test('joining every segment reproduces multiline whitespace exactly', () => {
		const text = '\t<persona>\r\n  {{user}} says `hello  world`  \r\n</persona>\n';
		expect(tokenizeEditorSyntax(text).map((segment) => segment.text).join('')).toBe(text);
	});

	test('empty text produces no paint runs', () => {
		expect(tokenizeEditorSyntax('')).toEqual([]);
	});
});
