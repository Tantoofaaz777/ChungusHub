import { expect, test } from 'bun:test';
import { normalizeCharacterAuthorsNote, resolveAuthorsNote } from './character-authors-note';

test('legacy and malformed state normalizes without enabling a private note', () => {
	for (const raw of [undefined, null, '', [], { text: 4, enabled: 'yes', position: 'unknown' }]) {
		expect(normalizeCharacterAuthorsNote(raw)).toEqual({ text: '', enabled: false, position: 'replace' });
		expect(resolveAuthorsNote('Chat.', raw)).toBe('Chat.');
	}
});

test('disabled notes preserve chat notes; each enabled combination preserves authored text', () => {
	const note = { text: 'Character {{user}}.', enabled: true, position: 'replace' };
	expect(resolveAuthorsNote('Chat.', { ...note, enabled: false })).toBe('Chat.');
	expect(resolveAuthorsNote('Chat.', note)).toBe(note.text);
	expect(resolveAuthorsNote('Chat.', { ...note, position: 'before' })).toBe(`${note.text}\nChat.`);
	expect(resolveAuthorsNote('Chat.', { ...note, position: 'after' })).toBe(`Chat.\n${note.text}`);
});

test('empty replacement suppresses chat notes; combinations avoid dangling empty separators', () => {
	for (const text of ['', '   ']) {
		expect(resolveAuthorsNote('Chat.', { text, enabled: true, position: 'replace' })).toBe('');
		for (const position of ['before', 'after']) {
			expect(resolveAuthorsNote('Chat.', { text, enabled: true, position })).toBe('Chat.');
			expect(resolveAuthorsNote('', { text: 'Character.', enabled: true, position })).toBe('Character.');
		}
	}
});
