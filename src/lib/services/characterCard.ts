import type { CardAsset, CharacterCardMetadata } from '$lib/types/character-card';

export function cardObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid character card: ${label} must be an object.`);
	return value as Record<string, unknown>;
}

const TEXT_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'creator',
	'creator_notes', 'system_prompt', 'post_history_instructions', 'character_version', 'nickname'];
const LIST_FIELDS = ['tags', 'alternate_greetings', 'group_only_greetings', 'source'];
const KNOWN_FIELDS = new Set([...TEXT_FIELDS, ...LIST_FIELDS, 'extensions', 'assets', 'character_book',
	'creator_notes_multilingual', 'creation_date', 'modification_date']);

/** Validate shapes before mapping: malformed fields must never import as an empty character. */
export function validateCharacterCard(value: unknown): Record<string, unknown> {
	const root = cardObject(value, 'card');
	if (root.spec !== undefined && root.spec !== 'chara_card_v2' && root.spec !== 'chara_card_v3') {
		throw new Error(`Unsupported character card specification: ${String(root.spec)}`);
	}
	const data = root.data === undefined ? root : cardObject(root.data, 'data');
	if (typeof data.name !== 'string') throw new Error('Invalid character card: name must be a string.');
	for (const name of TEXT_FIELDS) if (data[name] !== undefined && typeof data[name] !== 'string') {
		throw new Error(`Invalid character card: ${name} must be a string.`);
	}
	for (const name of LIST_FIELDS) if (data[name] !== undefined &&
		(!Array.isArray(data[name]) || (data[name] as unknown[]).some((v) => typeof v !== 'string'))) {
		throw new Error(`Invalid character card: ${name} must be an array of strings.`);
	}
	// Some card exporters spell an absent embedded lorebook as null.
	if (data.character_book != null) cardObject(data.character_book, 'character_book');
	for (const name of ['extensions', 'creator_notes_multilingual']) {
		if (data[name] !== undefined) cardObject(data[name], name);
	}
	if (data.creator_notes_multilingual && Object.values(data.creator_notes_multilingual).some((v) => typeof v !== 'string')) {
		throw new Error('Invalid multilingual creator notes.');
	}
	for (const name of ['creation_date', 'modification_date']) if (data[name] !== undefined &&
		(typeof data[name] !== 'number' || !Number.isFinite(data[name]) || (data[name] as number) < 0)) {
		throw new Error(`Invalid character card: ${name} must be a non-negative timestamp.`);
	}
	if (data.assets !== undefined) {
		if (!Array.isArray(data.assets) || data.assets.length > 1024) throw new Error('Invalid character card assets.');
		for (const raw of data.assets) {
			const asset = cardObject(raw, 'asset');
			if (['type', 'uri', 'name', 'ext'].some((key) => typeof asset[key] !== 'string')) throw new Error('Invalid character card asset fields.');
		}
	}
	return data;
}

export function cardMetadata(root: Record<string, unknown>, data: Record<string, unknown>): CharacterCardMetadata {
	const extensions = { ...(data.extensions as Record<string, unknown> ?? {}) };
	delete extensions.chungushub; // Native fidelity blocks must never recursively nest on re-export.
	return {
		version: root.spec === 'chara_card_v3' ? 3 : 2,
		extensions,
		...(data.assets !== undefined ? { assets: data.assets as CardAsset[] } : {}),
		...(data.creator_notes_multilingual ? { creatorNotesMultilingual: data.creator_notes_multilingual as Record<string, string> } : {}),
		...(data.source ? { source: data.source as string[] } : {}),
		...(data.group_only_greetings ? { groupOnlyGreetings: data.group_only_greetings as string[] } : {}),
		...(data.creation_date !== undefined ? { creationDate: data.creation_date as number } : {}),
		...(data.modification_date !== undefined ? { modificationDate: data.modification_date as number } : {}),
		...(data.character_book ? { characterBook: data.character_book as Record<string, unknown> } : {}),
		extra: Object.fromEntries(Object.entries(data).filter(([key]) => !KNOWN_FIELDS.has(key)))
	};
}

/** Creator notes follow the browser language with English and original-text fallbacks. */
export function localizedCreatorNotes(notes: Record<string, string> | undefined, fallback: string, language?: string): string {
	const lang = (language ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')).split('-')[0].toLowerCase();
	return notes?.[lang] ?? notes?.en ?? fallback;
}
