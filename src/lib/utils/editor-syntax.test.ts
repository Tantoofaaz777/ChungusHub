import { describe, expect, test } from 'bun:test';
import { tokenizeEditorSyntax, type EditorSyntaxKind } from './editor-syntax';

function compact(text: string): [EditorSyntaxKind, string][] {
	return tokenizeEditorSyntax(text).map((segment) => [segment.kind, segment.text]);
}
function painted(text: string, kind: EditorSyntaxKind): string {
	return tokenizeEditorSyntax(text).filter(segment => segment.kind === kind).map(segment => segment.text).join('|');
}
function kindAt(text: string, needle: string): EditorSyntaxKind {
	const index = text.indexOf(needle);
	let offset = 0;
	for (const segment of tokenizeEditorSyntax(text)) {
		if (offset <= index && index < offset + segment.text.length) return segment.kind;
		offset += segment.text.length;
	}
	throw new Error(`Missing ${needle}`);
}

describe('expanded editor paint-only syntax', () => {
	test('tags include quoted attributes but leave their contents in editable plain text', () => {
		expect(compact('<scene mood="quiet" test="score > 4">Text</scene> <pause />')).toEqual([
			['tag', '<scene mood="quiet" test="score > 4">'], ['plain', 'Text'],
			['tag', '</scene>'], ['plain', ' '], ['tag', '<pause />']
		]);
	});

	test('macro braces, names, dotted controls and argument separators are distinct', () => {
		expect(compact('{{user}} {{ style.form }} {{random:one,two}}')).toEqual([
			['bracket', '{{'], ['macro', 'user'], ['bracket', '}}'], ['plain', ' '],
			['bracket', '{{'], ['plain', ' '], ['macro', 'style.form'], ['plain', ' '], ['bracket', '}}'], ['plain', ' '],
			['bracket', '{{'], ['macro', 'random'], ['separator', ':'], ['plain', 'one,two'], ['bracket', '}}']
		]);
		expect(painted('{{// omit this }}', 'delimiter')).toBe('// omit this');
	});

	test('inline code owns macros, tags, links, escapes and Markdown inside it', () => {
		expect(compact('Use `{{char}} <tag> **bold** [x](y)` then {{user}}.')).toEqual([
			['plain', 'Use '], ['code', '`{{char}} <tag> **bold** [x](y)`'], ['plain', ' then '],
			['bracket', '{{'], ['macro', 'user'], ['bracket', '}}'], ['plain', '.']
		]);
	});

	test('backtick spans use exact delimiter width and may contain single backticks', () => {
		expect(compact('``one `two` three``')).toEqual([['code', '``one `two` three``']]);
		expect(compact('`one `` two`')).toEqual([['code', '`one `` two`']]);
		expect(compact('`first\nsecond`')).toEqual([['code', '`first\nsecond`']]);
		expect(painted('`first\n\nsecond`', 'code')).toBe('');
	});

	test('fences support backticks, tildes, language labels, longer closing runs and unfinished blocks', () => {
		const text = 'Before\n```html\n<tag>{{user}}</tag>\n````\nAfter';
		expect(compact(text)).toEqual([
			['plain', 'Before\n'], ['code', '```html\n<tag>{{user}}</tag>\n````\n'], ['plain', 'After']
		]);
		expect(compact('~~~\n*unfinished* {{user}}')).toEqual([['code', '~~~\n*unfinished* {{user}}']]);
		expect(painted('```\n~~~\n```', 'code')).toBe('```\n~~~\n```');
		expect(painted('> ```\n> **example**\n> ```', 'code')).toBe('> ```\n> **example**\n> ```');
	});

	test('escapes protect Markdown, tags and macros; a doubled slash escapes only the slash', () => {
		const text = '\\*plain\\* \\_plain\\_ \\[link](target) \\<tag> \\{{user}} \\`code';
		expect(compact(text)).toEqual([['plain', text]]);
		expect(painted(String.raw`\\**bold**`, 'delimiter')).toBe('**|**');
	});

	test('headings color only their opening and optional closing markers', () => {
		const text = '# Title\n  ###### Deep title ##\n####### Not a heading\n#hashtag';
		expect(painted(text, 'heading')).toBe('#|######|##');
		expect(kindAt(text, 'Title')).toBe('plain');
	});

	test('unordered, numbered, task lists, nested quotes and rules color only their markers', () => {
		const text = '- Item\n* Item\n+ Item\n    - Nested\n12. Item\n2) Item\n- [x] Done\n> > - [ ] Todo\n---\n***\n___';
		expect(painted(text, 'delimiter')).toBe('-|*|+|-|12.|2)|-|[x]|>|>|-|[ ]|---|***|___');
		expect(kindAt(text, 'Done')).toBe('plain');
		expect(painted('Text - middle * unpaired + 2. prose', 'delimiter')).toBe('');
	});

	test('balanced emphasis, strong, combined emphasis and strikethrough dim their markers only', () => {
		const text = '*italic* **bold** ***both*** _italic_ __bold__ ___both___ ~~gone~~';
		expect(painted(text, 'delimiter')).toBe('*|*|**|**|***|***|_|_|__|__|___|___|~~|~~');
		for (const word of ['italic', 'bold', 'both', 'gone']) expect(kindAt(text, word)).toBe('plain');
	});

	test('nested emphasis can contain code or macros without recoloring them', () => {
		const text = '**Bold *nested* {{user}} and `code` end**';
		expect(painted(text, 'delimiter')).toBe('**|*|*|**');
		expect(painted(text, 'macro')).toBe('user');
		expect(painted(text, 'code')).toBe('`code`');
	});

	test('unpaired punctuation, intraword underscores and emphasis across paragraphs stay plain', () => {
		for (const text of ['snake_case_name', 'foo__bar__baz', 'a * b', '**unclosed', 'open*', '*first\n\nlast*']) {
			expect(compact(text)).toEqual([['plain', text]]);
		}
		expect(painted('*soft\nbreak*', 'delimiter')).toBe('*|*');
	});

	test('inline links and images color destinations, preserving label syntax and nested URL parentheses', () => {
		const text = '[**label** {{user}}](https://example.com/a_(b)) ![alt](image.png)';
		expect(painted(text, 'link')).toBe('https://example.com/a_(b)|image.png');
		expect(painted(text, 'macro')).toBe('user');
		expect(kindAt(text, 'label')).toBe('plain');
		expect(kindAt(text, '!')).toBe('delimiter');
		expect(painted('[unclosed](target', 'link')).toBe('');
	});

	test('reference links, definitions and autolinks distinguish URLs from ordinary tags', () => {
		const text = '[label][ref]\n\n[ref]: https://example.com\n<https://example.org> <a@b.com> <scene>';
		expect(painted(text, 'link')).toBe('ref|https://example.com|https://example.org|a@b.com');
		expect(painted(text, 'tag')).toBe('<scene>');
	});

	test('unfinished syntax, comparisons and macro-like prose remain unchanged', () => {
		for (const text of ['Keep <open and {{user and `code', 'Keep x < 10, {user}, and <tag!> unchanged.']) {
			expect(compact(text)).toEqual([['plain', text]]);
		}
	});

	test('every UTF-16 offset survives CRLF, tabs, emoji, combining marks and mixed syntax', () => {
		const text = '\t<persona>\r\n  😀 e\u0301 {{user}} says `hello  world`  \r\n**yes**\n[link](url)\n</persona>\n';
		expect(tokenizeEditorSyntax(text).map(segment => segment.text).join('')).toBe(text);
	});

	test('arbitrary editing fragments are lossless and produce no empty runs', () => {
		let seed = 83;
		const alphabet = ['a', ' ', '\t', '\r\n', '😀', '\\', '*', '_', '~', '`', '#', '[', ']', '(', ')', '<', '>', '{', '}', '"', ':'];
		for (let run = 0; run < 120; run++) {
			let text = '';
			for (let i = 0; i < 200; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; text += alphabet[seed % alphabet.length]; }
			const segments = tokenizeEditorSyntax(text);
			expect(segments.map(segment => segment.text).join('')).toBe(text);
			expect(segments.every(segment => segment.text.length > 0)).toBe(true);
		}
	});

	test('large unfinished inputs do not repeatedly scan for matching backticks or brackets', () => {
		for (const text of ['[x]('.repeat(12000), '`x\n\n'.repeat(12000), '{{'.repeat(12000)]) {
			expect(tokenizeEditorSyntax(text).map(segment => segment.text).join('')).toBe(text);
		}
	});

	test('empty input has no runs', () => expect(tokenizeEditorSyntax('')).toEqual([]));
});
