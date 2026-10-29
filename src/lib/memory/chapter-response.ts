import { parseJsonObject } from '#lib/utils/json-extract.ts';

/** Structured chapter output, with plain-text compatibility for custom memory prompts. */
export function parseChapterResponse(raw: string, label = 'Chapter'): { title?: string; content: string } {
	const text = raw.trim();
	if (!text) throw new Error(`The model returned no ${label.toLowerCase()}. Check the connection’s output limit or write one below.`);
	const data = parseJsonObject(text);
	const candidate = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
	const array = candidate.startsWith('[');
	const structured = Object.hasOwn(data, 'title') || Object.hasOwn(data, 'content') ||
		array || candidate.startsWith('{') || /^```json(?:\s|$)/i.test(text);
	if (!structured) return { content: text };
	if (array || typeof data.title !== 'string' || !data.title.trim() || typeof data.content !== 'string' || !data.content.trim()) {
		throw new Error(`The model returned an invalid ${label.toLowerCase()} JSON. Use an object with non-empty "title" and "content" strings, or return plain text.`);
	}
	return { title: data.title.trim(), content: data.content.trim() };
}
