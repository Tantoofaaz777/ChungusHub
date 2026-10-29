/**
 * The message cursor: which turn of the open story the keyboard is on.
 *
 * The transcript is long and Tab is not navigation, so a turn a hundred messages back has to
 * be ADDRESSED rather than stepped to. Three doors land on this one cursor, and the store is
 * deliberately the only thing they share: the transcript's own arrows (near), find in chat's
 * live hit (anywhere in the branch), and `/go` (a turn number, which every message already
 * wears under its portrait).
 *
 * **Marking and taking are separate facts.** `mark` says which turn the cursor is on and
 * paints the ring; `goTo` also moves the keyboard there. Find in chat marks every hit while
 * the reader is still typing in its field, and a mark that stole focus would empty that box
 * on the first match.
 *
 * The cursor belongs to ONE story: it is stamped with the chat it was set in and reads as
 * absent everywhere else, so a chat switch drops it with nothing to clean up.
 *
 * See architecture/chat-sessions.md, "The message cursor".
 */
import { chatStore } from '#lib/stores/chat.svelte.ts';

class ChatCursorStore {
	/** The chat the cursor was set in. A position in one story means nothing in another. */
	#chatId = $state<string | null>(null);
	#id = $state<string | null>(null);

	/** Bumped whenever the keyboard should MOVE to the cursor rather than only mark it.
	 *  `MessageList` consumes it, because the turn may still sit behind the transcript window:
	 *  the landing waits for the row to exist instead of firing on the press. */
	takeNonce = $state(0);
	/** Bookmarks open at the message heading; keyboard steps use the nearest edge. */
	scrollBlock = $state<ScrollLogicalPosition>('nearest');

	/** Bumped whenever the composer should take the keyboard back. */
	composerNonce = $state(0);

	/** The cursored turn, or null when the keyboard is in the composer. */
	get id(): string | null {
		return this.#chatId === chatStore.activeChatId ? this.#id : null;
	}

	/** Position on the visible path, or -1 when there is no cursor. */
	get index(): number {
		const id = this.id;
		if (!id) return -1;
		return (chatStore.currentChatState?.activePath ?? []).findIndex((m) => m.id === id);
	}

	/** Put the cursor on a turn without moving the keyboard. */
	mark(id: string): void {
		this.#chatId = chatStore.activeChatId;
		this.#id = id;
	}

	/** Put the cursor on a turn and take the keyboard there. */
	goTo(id: string, scrollBlock: ScrollLogicalPosition = 'nearest'): void {
		this.scrollBlock = scrollBlock;
		this.mark(id);
		this.takeNonce++;
	}

	/** Take the keyboard to wherever the cursor already is, and nowhere when there is none. */
	take(): void {
		if (this.id) this.takeNonce++;
	}

	/** Drop a temporary mark without focusing the composer or moving the transcript. */
	clear(): void {
		this.#id = null;
	}

	/**
	 * Move by turns.
	 *
	 * **Always a step, from wherever the cursor is**, which is what lets one gesture both enter
	 * the story and walk it: a modifier held down and the arrow tapped is the shape a reader
	 * reaches for, and a door that only ever resumed would answer the second tap by landing
	 * where it already was.
	 *
	 * With no cursor at all the first step lands on the newest turn whichever way it was
	 * pressed: the composer sits under the story, so arriving in it always means going up.
	 * Stepping down past the newest turn hands the keyboard back to the composer, which is what
	 * makes the transcript and the box one continuous run rather than two places with a wall
	 * between.
	 */
	step(delta: number): void {
		const path = chatStore.currentChatState?.activePath ?? [];
		if (path.length === 0) return;
		const from = this.index;
		if (from < 0) {
			this.goTo(path[path.length - 1].id);
			return;
		}
		const next = from + delta;
		if (next >= path.length) {
			this.toComposer();
			return;
		}
		this.goTo(path[Math.max(0, next)].id);
	}

	/** Land on a 1-based turn number, the one every message wears under its portrait. False
	 *  when the story has no such turn, so the caller can say so instead of moving nowhere. */
	goToOrdinal(ordinal: number): boolean {
		const path = chatStore.currentChatState?.activePath ?? [];
		const turn = path[ordinal - 1];
		if (!turn) return false;
		this.goTo(turn.id);
		return true;
	}

	/** How many turns the open story has, for the callers that report a bad number. */
	get turnCount(): number {
		return chatStore.currentChatState?.activePath.length ?? 0;
	}

	/** Hand the keyboard back to the composer. */
	toComposer(): void {
		this.clear();
		this.composerNonce++;
	}
}

export const chatCursor = new ChatCursorStore();
