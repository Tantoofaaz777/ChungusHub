/**
 * Which sprite the open chat is showing.
 *
 * One question, answered from the newest assistant turn on the active path. Because the
 * reading is stored on the message row, swiping between siblings and walking branches shows
 * each turn's own sprite with no new call: the engine only ever runs for a turn nobody has
 * read yet.
 *
 * The layer is what asks (`ensureRead`), so a chat nobody is looking at never spends anything,
 * and a phone, which never draws one, spends nothing on sprites at all.
 */

import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { db } from '$lib/services/database';
import { chatStore } from '$lib/stores/chat.svelte';
import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
import { toastStore } from '$lib/stores/toast.svelte';
import { readSprite } from '$lib/services/spriteService';
import { spriteForLabel } from '$lib/utils/sprites';
import type { Message } from '$lib/types/chat';
import { characterRoleName, type LibraryEntry } from '$lib/types/library';

/** What the engine is doing about the newest reply, which is what the layer's dot reports. */
export type SpriteStatus = 'read' | 'reading' | 'failed' | 'idle';

class SpriteStore {
	/** Turns being read right now. Reactive because the dot reads it. */
	private inFlight = new SvelteSet<string>();
	/**
	 * Turns whose reading failed, against the exact text that failed: message id → content.
	 *
	 * Keyed on the content and not just the id so the guard stops a retry storm without
	 * outliving what it is guarding: rewriting or continuing a turn clears its reading server
	 * side and produces different text, which is a new question and deserves a new attempt.
	 * Same text, no retry until the reader asks for one or the app starts again.
	 */
	private failed = new SvelteMap<string, string>();

	/** The open chat's character, only while it actually has sprites to choose between. */
	private character = $derived.by((): LibraryEntry | null => {
		const characterId = chatStore.activeChat?.characterId;
		if (!characterId) return null;
		const entry = characterLibraryStore.entries.find(
			(e) => e.id === characterId && e.type === 'character'
		);
		return entry?.identity.sprites?.length ? entry : null;
	});

	/** The newest assistant turn on the branch being read, or null. A user turn waiting for its
	 *  reply leaves the sprite on the turn before it, which is the one still on screen. */
	private newestReply = $derived.by((): Message | null => {
		const path = chatStore.currentChatState?.activePath ?? [];
		for (let i = path.length - 1; i >= 0; i--) {
			if (path[i].role === 'assistant') return path[i];
		}
		return null;
	});

	/** Whether the sprite layer has something to draw for the open chat. */
	active = $derived(featurePromptsStore.spritesEnabled && this.character !== null);

	/**
	 * The picture to draw: the newest turn that HAS been read, walking back up the branch.
	 *
	 * Deliberately not "the newest turn, or the default": a reply is born unread and its
	 * reading lands a second or two later, so keying the sprite on the newest turn alone drops
	 * the character to their default sprite on every single reply and then swaps it, a blink
	 * that says nothing happened. The picture holds what it last knew and changes once, when
	 * there is something new to say. The default is for a chat where nothing has been read at
	 * all, which is the only moment there is nothing else to show.
	 */
	spritePath = $derived.by((): string | null => {
		if (!this.active) return null;
		const identity = this.character?.identity;
		if (!identity) return null;
		const path = chatStore.currentChatState?.activePath ?? [];
		for (let i = path.length - 1; i >= 0; i--) {
			const turn = path[i];
			if (turn.role !== 'assistant' || !turn.spriteLabel) continue;
			// A reading whose sprite has since been deleted keeps walking rather than falling
			// to the default: an older known picture is closer to the truth than a reset.
			const sprite = spriteForLabel(identity.sprites, turn.spriteLabel);
			if (sprite) return sprite.path;
		}
		return identity.defaultSprite ?? null;
	});

	characterName = $derived(this.character ? characterRoleName(this.character.identity) : null);

	/**
	 * The engine's state on the newest reply, in one word.
	 *
	 * `idle` covers both a chat with nothing to read yet and the instant between a reply
	 * landing and its call starting. `failed` is the only one the reader can act on, and it is
	 * the reason this exists: without it a dead engine looks exactly like a calm one, since
	 * the picture simply holds the last thing it knew.
	 */
	status = $derived.by((): SpriteStatus => {
		const message = this.newestReply;
		if (!message) return 'idle';
		if (this.inFlight.has(message.id)) return 'reading';
		if (this.failed.get(message.id) === message.content) return 'failed';
		return message.spriteLabel ? 'read' : 'idle';
	});

	/**
	 * Throw away a turn's reading so the engine reads it again: the sprite half of
	 * `memoryStore.invalidateMessage`, called from the same two places in `messageStore` and
	 * gated by the caller on the matching Re-read setting.
	 *
	 * A no-op unless the reading actually exists and this chat could draw a sprite from it, so
	 * an edit in a chat with no sprites costs nothing at all. **The caller refreshes**: both
	 * call sites already refetch the chat right after their own write, and a refetch in here
	 * would make that two for one edit. Same division as `memoryStore.invalidateMessage`.
	 */
	async invalidateMessage(messageId: string): Promise<void> {
		if (!this.active) return;
		const path = chatStore.currentChatState?.activePath ?? [];
		const message = path.find((m) => m.id === messageId);
		if (!message || message.role !== 'assistant' || !message.spriteLabel) return;

		// A turn whose earlier reading failed gets a clean slate: the text is different now,
		// which is the same reason the failure guard is keyed on content.
		this.failed.delete(messageId);
		await db.updateMessageSpriteLabel(messageId, null);
	}

	/**
	 * Read the newest turn if it has never been read. Called by the layer on every change, so
	 * it must be cheap and idempotent: every reason not to call the model is checked here.
	 */
	ensureRead(): void {
		if (!this.active) return;
		const character = this.character;
		const message = this.newestReply;
		if (!character || !message) return;
		if (message.spriteLabel) return;
		if (this.inFlight.has(message.id)) return;
		if (this.failed.get(message.id) === message.content) return;

		// Everything up to and INCLUDING the turn being read. How much of that the model
		// actually sees is the template's call ({{chatHistoryLast3}} takes three turns,
		// {{lastMessage}} takes one), so the cut belongs to the author, not to this store.
		// The truncation is not optional though: a user turn sitting after an unread reply
		// would otherwise be the newest thing every history macro shows.
		const path = chatStore.currentChatState?.activePath ?? [];
		const index = path.findIndex((m) => m.id === message.id);

		this.inFlight.add(message.id);
		void this.read(character, message, path.slice(0, index + 1));
	}

	/**
	 * Read the newest reply again after a failure: what the dot does when it is red.
	 *
	 * The guard exists to stop a broken engine from re-asking on every render, not to stop the
	 * reader from asking, so this drops it for that one turn and then goes through the ordinary
	 * door, which still refuses if the engine is off or the turn has since been read.
	 */
	retry(): void {
		const message = this.newestReply;
		if (!message) return;
		this.failed.delete(message.id);
		this.ensureRead();
	}

	private async read(
		character: LibraryEntry,
		message: Message,
		messages: Message[]
	): Promise<void> {
		try {
			const label = await readSprite({
				labels: (character.identity.sprites ?? []).map((sprite) => sprite.label),
				messages
			});
			await db.updateMessageSpriteLabel(message.id, label);
			// Re-read the chat rather than patching the row in place: the message the layer
			// reads belongs to the chat store, and one owner per piece of state is what keeps
			// a reading from disagreeing with what is on disk. A no-op if the reader has since
			// opened a different chat.
			await chatStore.refreshChat(message.chatId);
		} catch (e) {
			// A background sidecar that fails silently is a picture frozen on the last one it
			// knew with nothing on screen admitting the engine is dead, so this says so once
			// per turn.
			this.failed.set(message.id, message.content);
			console.error('[sprites] reading the newest turn failed:', e);
			toastStore.failed('pick a sprite for this reply', e);
		} finally {
			this.inFlight.delete(message.id);
		}
	}
}

export const spriteStore = new SpriteStore();
