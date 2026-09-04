export type EditorSyntaxKind = 'plain' | 'tag' | 'code' | 'macro';

export interface EditorSyntaxSegment {
	kind: EditorSyntaxKind;
	text: string;
}

const MACRO_NAME_PART = /\w/;
const TAG_NAME_START = /[A-Za-z_]/;
const TAG_NAME_PART = /[A-Za-z0-9_.:-]/;

function macroEnd(text: string, start: number): number | null {
	if (!text.startsWith('{{', start)) return null;
	let cursor = start + 2;
	if (!MACRO_NAME_PART.test(text[cursor] ?? '')) return null;
	while (MACRO_NAME_PART.test(text[cursor] ?? '')) cursor++;
	if (text[cursor] === '.') {
		cursor++;
		if (!MACRO_NAME_PART.test(text[cursor] ?? '')) return null;
		while (MACRO_NAME_PART.test(text[cursor] ?? '')) cursor++;
	}
	return text.startsWith('}}', cursor) ? cursor + 2 : null;
}

function tagEnd(text: string, start: number): number | null {
	if (text[start] !== '<') return null;
	let cursor = start + 1;
	if (text[cursor] === '/') cursor++;
	if (!TAG_NAME_START.test(text[cursor] ?? '')) return null;
	cursor++;
	while (TAG_NAME_PART.test(text[cursor] ?? '')) cursor++;

	// Once the name ends, only whitespace, a closing slash, or the angle bracket can follow.
	// This keeps comparisons such as "< 10" and fragments such as "<tag!" as ordinary text.
	const afterName = text[cursor];
	if (afterName !== '>' && afterName !== '/' && afterName !== ' ' && afterName !== '\t') {
		return null;
	}

	let quote: '"' | "'" | null = null;
	for (; cursor < text.length; cursor++) {
		const char = text[cursor];
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === '\r' || char === '\n' || char === '<') return null;
		if (char === '>') return cursor + 1;
	}
	return null;
}

function codeEnd(text: string, start: number): number | null {
	if (text[start] !== '`') return null;
	let width = 1;
	while (text[start + width] === '`') width++;
	const delimiter = '`'.repeat(width);
	const close = text.indexOf(delimiter, start + width);
	return close < 0 ? null : close + width;
}

function append(segments: EditorSyntaxSegment[], kind: EditorSyntaxKind, text: string): void {
	if (!text) return;
	const previous = segments.at(-1);
	if (previous?.kind === kind) previous.text += text;
	else segments.push({ kind, text });
}

/**
 * Splits editor text into paint-only syntax runs. Concatenating every returned `text`
 * reproduces the input byte for byte; this scanner never validates or transforms what will
 * be saved. Closed backtick spans own their contents, so prompt syntax inside code stays code.
 */
export function tokenizeEditorSyntax(text: string): EditorSyntaxSegment[] {
	const segments: EditorSyntaxSegment[] = [];
	let plainStart = 0;
	let cursor = 0;

	while (cursor < text.length) {
		let kind: Exclude<EditorSyntaxKind, 'plain'> | null = null;
		let end: number | null = null;

		if (text[cursor] === '`') {
			kind = 'code';
			end = codeEnd(text, cursor);
		} else if (text.startsWith('{{', cursor)) {
			kind = 'macro';
			end = macroEnd(text, cursor);
		} else if (text[cursor] === '<') {
			kind = 'tag';
			end = tagEnd(text, cursor);
		}

		if (!kind || end === null) {
			cursor++;
			continue;
		}

		append(segments, 'plain', text.slice(plainStart, cursor));
		append(segments, kind, text.slice(cursor, end));
		cursor = end;
		plainStart = cursor;
	}

	append(segments, 'plain', text.slice(plainStart));
	return segments;
}
