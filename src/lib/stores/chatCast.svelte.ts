/**
 * Chat → character index.
 *
 * Each chat is bound to exactly one library character (ST-style). This keeps a
 * lightweight chatId → characterId map so the chat lists can show whose story a
 * chat is without loading anything heavy. Resolution to names/art is lazy against
 * the character library, so renames and new art show up automatically. Alongside it we
 * keep a chatId → personaId map (the persona the chat's most recent message was sent
 * with) so the lists show whose persona a chat belongs to, NOT the global active one.
 */
import { db } from '$lib/services/database';
import { characterLibraryStore } from './characterLibrary.svelte';
import type { PortraitFocus } from '$lib/utils/portrait-focus';
import { storyRoleName } from '$lib/types/library';

export interface ChatCastMember {
	libraryEntryId: string;
	name: string;
	imageUrl: string | null;
	/** Travels with the art, so every list that draws this face aims it the same way. */
	portraitFocus?: PortraitFocus;
}

class ChatCastStore {
	// chatId → bound character id (or null if the chat has no character yet).
	private characterByChat = $state<Map<string, string | null>>(new Map());
	// chatId → persona id of the chat's most recent user message (or null/absent).
	private personaByChat = $state<Map<string, string | null>>(new Map());
	loaded = $state(false);

	/** Pull every chat + last-used persona once and build both indexes. */
	async load(): Promise<void> {
		const [chats, personas] = await Promise.all([db.getAllChats(), db.getLastPersonaByChat()]);
		const charMap = new Map<string, string | null>();
		for (const chat of chats) charMap.set(chat.id, chat.characterId ?? null);
		this.characterByChat = charMap;
		const persMap = new Map<string, string | null>();
		for (const [chatId, personaId] of Object.entries(personas)) persMap.set(chatId, personaId);
		this.personaByChat = persMap;
		this.loaded = true;
	}

	/** Record/refresh a chat's bound character (called by the chat store). */
	setForChat(chatId: string, characterId: string | null): void {
		const next = new Map(this.characterByChat);
		next.set(chatId, characterId);
		this.characterByChat = next;
	}

	/** Record/refresh a chat's persona (called when a user message is sent, so the
	 *  lists stay in step with the persona that message locked in). */
	setPersonaForChat(chatId: string, personaId: string | null): void {
		const next = new Map(this.personaByChat);
		next.set(chatId, personaId);
		this.personaByChat = next;
	}

	/** Drop a chat from both indexes (after it is actually deleted). */
	removeChat(chatId: string): void {
		if (this.characterByChat.has(chatId)) {
			const next = new Map(this.characterByChat);
			next.delete(chatId);
			this.characterByChat = next;
		}
		if (this.personaByChat.has(chatId)) {
			const next = new Map(this.personaByChat);
			next.delete(chatId);
			this.personaByChat = next;
		}
	}

	/** The character featured in a chat, as a single-element list (or empty). */
	charactersForChat(chatId: string): ChatCastMember[] {
		const member = this.resolve(this.characterByChat.get(chatId) ?? null);
		return member ? [member] : [];
	}

	/** The persona the chat's most recent message was sent with, resolved lazily
	 *  against the library, so a rename/new art shows up. Null if none is tracked or the
	 *  persona was since deleted. Deliberately NOT the global active persona. */
	personaForChat(chatId: string): ChatCastMember | null {
		return this.resolvePersona(this.personaByChat.get(chatId) ?? null);
	}

	/** characterId → chatIds, for character-first browsing. */
	chatsByCharacter(): Map<string, string[]> {
		const map = new Map<string, string[]>();
		for (const [chatId, characterId] of this.characterByChat) {
			if (!characterId) continue;
			const bucket = map.get(characterId);
			if (bucket) bucket.push(chatId);
			else map.set(characterId, [chatId]);
		}
		return map;
	}

	/** The most recently-updated chat bound to a character, if any. */
	latestChatForCharacter(
		characterId: string,
		chats: { id: string; updatedAt: number }[]
	): string | null {
		const ids = new Set(this.chatsByCharacter().get(characterId) ?? []);
		const candidates = chats.filter((c) => ids.has(c.id)).sort((a, b) => b.updatedAt - a.updatedAt);
		return candidates[0]?.id ?? null;
	}

	private resolve(characterId: string | null): ChatCastMember | null {
		if (!characterId) return null;
		const entry = characterLibraryStore.entries.find((e) => e.id === characterId);
		if (!entry) return null;
		return {
			libraryEntryId: entry.id,
			name: storyRoleName(entry.identity),
			imageUrl: entry.identity.imageUrl ?? null,
			portraitFocus: entry.identity.portraitFocus
		};
	}

	private resolvePersona(personaId: string | null): ChatCastMember | null {
		if (!personaId) return null;
		const entry = characterLibraryStore.entries.find(
			(e) => e.id === personaId && e.type === 'persona'
		);
		if (!entry) return null;
		return {
			libraryEntryId: entry.id,
			name: storyRoleName(entry.identity),
			imageUrl: entry.identity.imageUrl ?? null,
			portraitFocus: entry.identity.portraitFocus
		};
	}
}

export const chatCastStore = new ChatCastStore();
