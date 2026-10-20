/**
 * Composer drafts, one per chat, persisted server-side so an unsent message
 * survives reloads and follows the user across devices.
 *
 * Writes ride the shared `DebouncedWriter`, keyed by chat id so a pending write for one
 * chat is never lost by switching to another before it fires, and committed when the tab
 * goes away so the last half-second of typing survives a close or a backgrounding rather
 * than replaying on wake.
 */
import { db } from '$lib/services/database';
import { DebouncedWriter } from '$lib/utils/debounced-write';
import { generalSettingsStore } from '$lib/stores/general-settings.svelte';

const SAVE_DEBOUNCE_MS = 500;

export interface InputDraftSnapshot {
	chatId: string;
	content: string;
	version: number;
}

export class InputDraftStore {
	private writer = new DebouncedWriter(SAVE_DEBOUNCE_MS, (chatId) => this.commit(chatId));
	// The text each pending write will send. Unlike every other store on the writer, a
	// composer draft is not held in reactive state anywhere, so the value has to wait here.
	private pending = new Map<string, string>();
	private writes = new Map<string, Promise<void>>();
	// Reads and local edits share a version: neither an older read nor a result
	// already awaiting its UI callback may restore text after a send or another edit.
	private versions = new Map<string, number>();

	// The latest draft pushed from another device. InputArea watches this and
	// adopts it when it matches the open chat and the user isn't mid-typing.
	remote = $state<InputDraftSnapshot | null>(null);

	private nextVersion(chatId: string): number {
		const version = (this.versions.get(chatId) ?? 0) + 1;
		this.versions.set(chatId, version);
		return version;
	}

	/** Check again at adoption, including after a resolved promise reaches the UI. */
	isCurrent(draft: InputDraftSnapshot): boolean {
		return generalSettingsStore.saveDrafts && this.versions.get(draft.chatId) === draft.version;
	}

	async load(chatId: string): Promise<InputDraftSnapshot | null> {
		if (!generalSettingsStore.saveDrafts) return null;
		const draft = { chatId, content: '', version: this.nextVersion(chatId) };
		// A not-yet-committed local write is newer than whatever the server has.
		const pending = this.pending.get(chatId);
		if (pending !== undefined) return { ...draft, content: pending };
		// A save or clear may already be in flight. Reading before it lands can
		// resurrect the sent draft even when this read started AFTER the send.
		await this.writes.get(chatId);
		if (!this.isCurrent(draft)) return null;
		const row = await db.getChatDraft(chatId);
		return this.isCurrent(draft) ? { ...draft, content: row?.content ?? '' } : null;
	}

	schedule(chatId: string, content: string): void {
		this.nextVersion(chatId);
		if (!generalSettingsStore.saveDrafts) return;
		this.pending.set(chatId, content);
		this.writer.schedule(chatId);
	}

	/** Drop the draft (message sent), cancelling any pending write first. */
	clear(chatId: string): void {
		this.nextVersion(chatId);
		this.writer.cancel(chatId);
		this.pending.delete(chatId);
		void this.write(chatId, '');
	}

	private async commit(chatId: string): Promise<void> {
		const content = this.pending.get(chatId);
		this.pending.delete(chatId);
		if (content === undefined) return;
		await this.write(chatId, content);
	}

	/** Serialize writes per chat so a save already in flight cannot overtake a clear. */
	private async write(chatId: string, content: string): Promise<void> {
		const previous = this.writes.get(chatId);
		// A failed save must still allow the following clear or new draft to be written.
		const write = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
			// An emptied box means "no draft", not an empty draft row.
			if (content.trim()) await db.upsertChatDraft(chatId, content);
			else await db.deleteChatDraft(chatId);
		});
		this.writes.set(chatId, write);
		try {
			await write;
		} finally {
			if (this.writes.get(chatId) === write) this.writes.delete(chatId);
		}
	}

	/** Another device changed a draft; surface the active chat's current value. */
	async syncReload(activeChatId: string | null): Promise<void> {
		if (!activeChatId || !generalSettingsStore.saveDrafts) return;
		const draft = await this.load(activeChatId);
		if (draft && this.isCurrent(draft)) this.remote = draft;
	}
}

export const inputDraftStore = new InputDraftStore();
