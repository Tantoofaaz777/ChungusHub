import { buildSearchRegex, MAX_MATCHES } from './chat-search';
import type { EditorSyntaxSegment } from './editor-syntax';

export interface EditorSearchOptions {
	matchCase: boolean;
	wholeWord: boolean;
}

export interface EditorMatch {
	start: number;
	end: number;
}

/** UTF-16 offsets match native textarea selections. Search semantics are shared with chat. */
export function findEditorMatches(
	text: string, query: string, options: EditorSearchOptions, limit = MAX_MATCHES
): EditorMatch[] {
	const regex = buildSearchRegex(query, options);
	if (!regex || limit <= 0) return [];
	const matches: EditorMatch[] = [];
	for (const match of text.matchAll(regex)) {
		matches.push({ start: match.index, end: match.index + match[0].length });
		if (matches.length >= limit) break;
	}
	return matches;
}

/** Replacement is literal, including dollar signs. The painting budget never limits Replace all. */
export function replaceAllEditorMatches(
	text: string, query: string, replacement: string, options: EditorSearchOptions
): string {
	const regex = buildSearchRegex(query, options);
	return regex ? text.replace(regex, () => replacement) : text;
}

export interface EditorSearchSegment extends EditorSyntaxSegment {
	match: number | null;
}

/** Split paint-only runs at match boundaries, preserving syntax and every authored character. */
export function markEditorMatches(
	segments: readonly EditorSyntaxSegment[], matches: readonly EditorMatch[]
): EditorSearchSegment[] {
	const marked: EditorSearchSegment[] = [];
	let offset = 0;
	let index = 0;
	for (const segment of segments) {
		const end = offset + segment.text.length;
		let cursor = offset;
		while (cursor < end) {
			while (index < matches.length && matches[index].end <= cursor) index++;
			const hit = matches[index];
			const inside = !!hit && hit.start <= cursor;
			const until = Math.min(end, hit ? (inside ? hit.end : hit.start) : end);
			marked.push({
				kind: segment.kind,
				text: segment.text.slice(cursor - offset, until - offset),
				match: inside ? index : null
			});
			cursor = until;
		}
		offset = end;
	}
	return marked;
}
