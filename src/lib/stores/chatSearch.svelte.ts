/**
 * Find-in-chat: whether the search bar is up over the message list, and what it is
 * looking for.
 *
 * A chat satellite, deliberately NOT part of uiStore's panel
 * choreography: the bar is inline chat chrome, not a workspace surface, so it must be
 * able to sit open alongside a docked Settings or Library without either closing the
 * other. The matches themselves live in the bar: they are DOM Ranges over the rendered
 * transcript (see utils/chat-search.ts), so only the mounted component can own them.
 *
 * Query and options survive a close/reopen and a chat switch, the way a browser's find
 * bar remembers what you last looked for.
 */

class ChatSearchStore {
	open = $state(false);
	query = $state('');
	matchCase = $state(false);
	wholeWord = $state(false);

	/** Bumped on every open request so the bar re-focuses and selects its text even when
	 *  it was already up: pressing the shortcut again must reset the field, not no-op. */
	openNonce = $state(0);

	show(): void {
		this.open = true;
		this.openNonce++;
	}

	close(): void {
		this.open = false;
	}
}

export const chatSearch = new ChatSearchStore();
