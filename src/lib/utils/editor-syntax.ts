export type EditorSyntaxKind = 'plain' | 'tag' | 'code' | 'macro' | 'bracket' | 'separator' | 'delimiter' | 'heading' | 'link';

export interface EditorSyntaxSegment {
	kind: EditorSyntaxKind;
	text: string;
}

// One byte per UTF-16 code unit. Literal protects escaped characters without painting them.
const LITERAL = 1, TAG = 2, CODE = 3, MACRO = 4, BRACKET = 5,
	SEPARATOR = 6, DELIMITER = 7, HEADING = 8, LINK = 9;
const KINDS: EditorSyntaxKind[] = ['plain', 'plain', 'tag', 'code', 'macro', 'bracket', 'separator', 'delimiter', 'heading', 'link'];
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITE = /\s/;

/** Paint-only recognition of common Markdown plus prompt syntax. Never renders HTML or
 * rewrites input: every source code unit is emitted exactly once, including CRLF and emoji.
 * Code/escapes own their contents. All token styles must remain color-only so the native
 * textarea, not this scanner, continues to own selection, caret geometry and editing. */
export function tokenizeEditorSyntax(text: string): EditorSyntaxSegment[] {
	const paint = new Uint8Array(text.length);
	const lines: { start: number; end: number; body: number }[] = [];
	const boundaries = new Set<number>();
	let fence: { char: string; width: number; start: number } | null = null;

	// Block syntax is line-local. A fence protects even an unfinished block while typing.
	for (let start = 0; start < text.length;) {
		const newline = text.indexOf('\n', start);
		const end = newline < 0 ? text.length : newline + 1;
		const line = text.slice(start, end).replace(/\r?\n$/, '');
		let body = 0;
		const quotes: number[] = [];
		while (true) {
			const quote = /^ {0,3}>[ \t]?/.exec(line.slice(body));
			if (!quote) break;
			quotes.push(start + body + quote[0].indexOf('>'));
			body += quote[0].length;
		}
		const rest = line.slice(body);
		const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(rest);
		if (fence) {
			if (marker && marker[1][0] === fence.char && marker[1].length >= fence.width && !marker[2].trim()) {
				paint.fill(CODE, fence.start, end);
				boundaries.add(fence.start); boundaries.add(end);
				fence = null;
			}
		} else if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
			fence = { char: marker[1][0], width: marker[1].length, start };
		} else {
			for (const index of quotes) paint[index] = DELIMITER;
			const offset = start + body;
			const heading = /^ {0,3}(#{1,6})(?=[ \t]|$)/.exec(rest);
			const rule = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(rest);
			const list = /^[ \t]*([-+*]|\d{1,9}[.)])(?=[ \t]|$)/.exec(rest);
			if (heading) {
				const index = offset + heading[0].length - heading[1].length;
				paint.fill(HEADING, index, index + heading[1].length);
				const closing = /[ \t]+(#+)[ \t]*$/.exec(rest.slice(heading[0].length));
				if (closing) {
					const index = offset + heading[0].length + closing.index + closing[0].indexOf('#');
					paint.fill(HEADING, index, index + closing[1].length);
				}
			} else if (rule) paint.fill(DELIMITER, offset, start + line.length);
			else if (list) {
				const index = offset + list[0].length - list[1].length;
				paint.fill(DELIMITER, index, index + list[1].length);
				const task = /^[ \t]+\[[ xX]\](?=[ \t]|$)/.exec(rest.slice(list[0].length));
				if (task) {
					const index = offset + list[0].length + task[0].indexOf('[');
					paint.fill(DELIMITER, index, index + 3);
				}
			}
			if (!rest.trim() || heading || rule || list) boundaries.add(start);
		}
		lines.push({ start, end, body: start + body });
		start = end;
	}
	if (fence) { paint.fill(CODE, fence.start); boundaries.add(fence.start); }

	const blockStarts = [...boundaries].sort((a, b) => a - b);
	function crossesBlock(start: number, end: number): boolean {
		let low = 0, high = blockStarts.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (blockStarts[middle] <= start) low = middle + 1;
			else high = middle;
		}
		return low < blockStarts.length && blockStarts[low] <= end;
	}

	// Index exact backtick runs once; repeated unmatched runs must not rescan the document.
	const nextTick = new Map<number, number>();
	const previousTick = new Map<number, number>();
	for (const match of text.matchAll(/`+/g)) {
		if (paint[match.index] === CODE) continue;
		const previous = previousTick.get(match[0].length);
		if (previous !== undefined) nextTick.set(previous, match.index);
		previousTick.set(match[0].length, match.index);
	}

	for (let i = 0; i < text.length;) {
		if (paint[i]) { i++; continue; }
		const char = text[i];
		if (char === '\\' && ESCAPABLE.test(text[i + 1] ?? '')) {
			paint.fill(LITERAL, i, i + 2); i += 2; continue;
		}
		if (char === '`') {
			let width = 1;
			while (text[i + width] === '`') width++;
			const close = nextTick.get(i);
			if (close !== undefined && !/\r?\n[ \t]*\r?\n/.test(text.slice(i + width, close))
				&& !crossesBlock(i, close)) {
				paint.fill(CODE, i, close + width); i = close + width; continue;
			}
			i += width; continue;
		}
		if (text.startsWith('{{', i)) {
			// Same flat name / dotted control / colon-argument shapes as MACRO_REGEX.
			const macro = /^\{\{\s*(\/\/[^{}]*?|\w+(?:\.\w+)?(?::[^{}]*?)?)\s*\}\}/.exec(text.slice(i));
			if (macro) {
				const end = i + macro[0].length;
				paint.fill(LITERAL, i, end);
				paint.fill(BRACKET, i, i + 2); paint.fill(BRACKET, end - 2, end);
				const bodyStart = i + 2 + /^\s*/.exec(macro[0].slice(2))![0].length;
				if (macro[1].startsWith('//')) paint.fill(DELIMITER, bodyStart, bodyStart + macro[1].length);
				else {
					const name = /^\w+(?:\.\w+)?/.exec(macro[1])![0];
					paint.fill(MACRO, bodyStart, bodyStart + name.length);
					for (let j = bodyStart + name.length; j < end - 2; j++) if (text[j] === ':') paint[j] = SEPARATOR;
				}
				i = end; continue;
			}
		}
		if (char === '<') {
			const autoLink = /^<(?:https?:\/\/[^<>\s]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})>/.exec(text.slice(i));
			if (autoLink) {
				const end = i + autoLink[0].length;
				paint.fill(LINK, i, end); paint[i] = paint[end - 1] = DELIMITER; i = end; continue;
			}
			const tag = /^<\/?[A-Za-z_][A-Za-z0-9_.:-]*(?=[\s/>])(?:[^<>"'\r\n]|"[^"\r\n]*"|'[^'\r\n]*')*>/.exec(text.slice(i));
			if (tag) { paint.fill(TAG, i, i + tag[0].length); i += tag[0].length; continue; }
		}
		i++;
	}

	// Match bracket/parenthesis pairs once. An incomplete link is ordinary editable text.
	const pairs = new Map<number, number>();
	const squares: number[] = [], parens: number[] = [];
	for (let i = 0; i < text.length; i++) {
		if (boundaries.has(i)) { squares.length = 0; parens.length = 0; }
		if (paint[i]) continue;
		const stack = text[i] === '[' || text[i] === ']' ? squares : parens;
		if (text[i] === '[' || text[i] === '(') stack.push(i);
		else if (text[i] === ']' || text[i] === ')') {
			const start = stack.pop();
			if (start !== undefined) pairs.set(start, i);
		}
	}
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== '[' || paint[i]) continue;
		const labelEnd = pairs.get(i);
		if (labelEnd === undefined) continue;
		const tail = labelEnd + 1;
		if (text[tail] !== '(' && text[tail] !== '[') continue;
		const end = pairs.get(tail);
		if (end === undefined) continue;
		paint[i] = paint[labelEnd] = paint[tail] = paint[end] = DELIMITER;
		if (i && text[i - 1] === '!' && !paint[i - 1]) paint[i - 1] = DELIMITER;
		for (let j = tail + 1; j < end; j++) if (!paint[j]) paint[j] = LINK;
	}
	// Reference definitions also make the destination visible while editing.
	for (const line of lines) {
		const definition = /^ {0,3}\[([^\]\r\n]+)\]:[ \t]+(\S+)/.exec(text.slice(line.body, line.end));
		if (!definition || paint[line.body]) continue;
		const start = line.body + definition[0].indexOf('['), close = pairs.get(start);
		if (close === undefined) continue;
		paint[start] = paint[close] = paint[close + 1] = DELIMITER;
		const destination = line.body + definition[0].length - definition[2].length;
		for (let j = destination; j < destination + definition[2].length; j++) if (!paint[j]) paint[j] = LINK;
	}

	// Pair emphasis markers, including nested runs. Words_like_this are never emphasis.
	type Delimiter = { start: number; remaining: number; width: number; closes: boolean };
	const stacks: Record<string, Delimiter[]> = { '*': [], '_': [], '~': [] };
	for (let i = 0; i < text.length;) {
		if (boundaries.has(i)) for (const stack of Object.values(stacks)) stack.length = 0;
		const char = text[i];
		if (paint[i] || !stacks[char]) { i++; continue; }
		let width = 1;
		while (text[i + width] === char && !paint[i + width]) width++;
		if (char === '~' && width !== 2) { i += width; continue; }
		const before = text[i - 1] ?? '', after = text[i + width] ?? '';
		const beforeWhite = !before || WHITE.test(before), afterWhite = !after || WHITE.test(after);
		const beforePunct = PUNCTUATION.test(before), afterPunct = PUNCTUATION.test(after);
		const left = !afterWhite && (!afterPunct || beforeWhite || beforePunct);
		const right = !beforeWhite && (!beforePunct || afterWhite || afterPunct);
		const opens = left && (char !== '_' || !right || beforePunct);
		const closes = right && (char !== '_' || !left || afterPunct);
		let remaining = width;
		const stack = stacks[char];
		while (closes && remaining && stack.length) {
			const opener = stack.at(-1)!;
			// CommonMark's multiple-of-three rule prevents spurious intraword pairings.
			if (char !== '~' && (opens || opener.closes) && (opener.width + width) % 3 === 0
				&& (opener.width % 3 !== 0 || width % 3 !== 0)) break;
			const used = Math.min(opener.remaining, remaining);
			paint.fill(DELIMITER, opener.start + opener.remaining - used, opener.start + opener.remaining);
			paint.fill(DELIMITER, i + width - remaining, i + width - remaining + used);
			opener.remaining -= used; remaining -= used;
			if (!opener.remaining) stack.pop();
		}
		if (opens && remaining) stack.push({ start: i + width - remaining, remaining, width, closes });
		i += width;
	}

	const segments: EditorSyntaxSegment[] = [];
	for (let start = 0; start < text.length;) {
		const kind = KINDS[paint[start]];
		let end = start + 1;
		while (end < text.length && KINDS[paint[end]] === kind) end++;
		segments.push({ kind, text: text.slice(start, end) });
		start = end;
	}
	return segments;
}
