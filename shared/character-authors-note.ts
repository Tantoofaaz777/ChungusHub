/** Private app state, shared by a character's chats. Never part of a card or version. */
export interface CharacterAuthorsNote {
	text: string;
	enabled: boolean;
	position: 'replace' | 'before' | 'after';
}

export function normalizeCharacterAuthorsNote(raw: unknown): CharacterAuthorsNote {
	const note = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
	return {
		text: typeof note.text === 'string' ? note.text : '',
		enabled: note.enabled === true,
		position: note.position === 'before' || note.position === 'after' ? note.position : 'replace'
	};
}

/** Compose before macro expansion; the preset places the result through {{authorsNote}}. */
export function resolveAuthorsNote(chatText: string | undefined, raw: unknown): string {
	const chat = chatText?.trim() ? chatText : '';
	const note = normalizeCharacterAuthorsNote(raw);
	if (!note.enabled) return chat;
	if (note.position === 'replace') return note.text.trim() ? note.text : '';
	const parts = note.position === 'before' ? [note.text, chat] : [chat, note.text];
	return parts.filter(text => text.trim()).join('\n');
}
