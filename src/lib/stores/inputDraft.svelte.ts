/**
 * Composer drafts, one per chat, persisted server-side so an unsent message
 * survives reloads and follows the user across devices.
 *
 * Writes ride the shared `DebouncedWriter`, keyed by chat id so a pending write for one
 * chat is never lost by switching to another before it fires, and committed when the tab
 * goes away so the last half-second of typing survives a close or a backgrounding rather
 * than replaying on wake.
 */
import { db } from '#lib/services/database.ts';
import { DebouncedWriter } from '#lib/utils/debounced-write.ts';
import { generalSettingsStore } from '#lib/stores/general-settings.svelte.ts';
import { toastStore } from './toast.svelte';
import type { ChatDraft } from '#shared/chat-draft.ts';

const SAVE_DEBOUNCE_MS = 500;

export interface InputDraftSnapshot {
	chatId: string;
	content: string;
	version: number;
}

interface DraftEdit {
	version: number;
	base: ChatDraft | null;
	saved?: ChatDraft | null;
}

export interface InputDraftSubmission {
	version: number;
	content: string;
	readonly draft: ChatDraft | null;
}

export class InputDraftStore {
	private writer = new DebouncedWriter(SAVE_DEBOUNCE_MS, (chatId) => this.commit(chatId));
	// The text each pending write will send. Unlike every other store on the writer, a
	// composer draft is not held in reactive state anywhere, so the value has to wait here.
	private pending = new Map<string, string>();
	private writes = new Map<string, Promise<ChatDraft | null>>();
	private serverDrafts = new Map<string, ChatDraft | null>();
	// Snapshot versions invalidate stale reads and callbacks. Only edits invalidate
	// a submitted draft: reading unchanged text must not prevent its cleanup.
	private versions = new Map<string, number>();
	private edits = new Map<string, DraftEdit>();

	// The latest draft pushed from another device. InputArea watches this and
	// adopts it when it matches the open chat and the user isn't mid-typing.
	remote = $state<InputDraftSnapshot | null>(null);

	private nextVersion(chatId: string): number {
		const version = (this.versions.get(chatId) ?? 0) + 1;
		this.versions.set(chatId, version);
		return version;
	}

	private nextEdit(chatId: string): number {
		this.edits.set(chatId, { version: this.editVersion(chatId) + 1, base: this.serverDrafts.get(chatId) ?? null });
		return this.nextVersion(chatId);
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
		if (!this.isCurrent(draft)) return null;
		this.serverDrafts.set(chatId, row);
		return { ...draft, content: row?.content ?? '' };
	}

	schedule(chatId: string, content: string): void {
		this.nextEdit(chatId);
		if (!generalSettingsStore.saveDrafts) return;
		this.pending.set(chatId, content);
		this.writer.schedule(chatId);
	}

	private editVersion(chatId: string): number { return this.edits.get(chatId)?.version ?? 0; }

	/** Pin cleanup to the submitted draft, including its own save if it finishes later. */
	captureSubmission(chatId: string, content: string): InputDraftSubmission {
		const edit = this.edits.get(chatId), observed = this.serverDrafts.get(chatId) ?? null;
		// Sending before the debounce fires consumes the saved draft this edit replaced.
		// A different remote snapshot merely observed while composing is not ours to delete.
		const known = this.pending.get(chatId) === content ? edit?.base ?? null : observed?.content === content ? observed : null;
		const savedBeforeSubmission = edit?.saved;
		return {
			version: this.editVersion(chatId), content,
			get draft() { return edit?.saved !== savedBeforeSubmission ? edit?.saved ?? null : known; }
		};
	}

	/** A delayed send must not clear a draft edited while its write was in flight. */
	clear(chatId: string, submitted?: InputDraftSubmission): void {
		if (submitted && this.editVersion(chatId) !== submitted.version) return;
		const version = this.nextEdit(chatId);
		this.writer.cancel(chatId);
		this.pending.delete(chatId);
		void this.write(chatId, '', submitted).then(row => {
			if (row && this.versions.get(chatId) === version) this.remote = { chatId, content: row.content, version };
		}).catch(error => toastStore.failed('clear the draft', error));
	}

	private async commit(chatId: string): Promise<void> {
		const content = this.pending.get(chatId);
		this.pending.delete(chatId);
		if (content === undefined) return;
		const version = this.versions.get(chatId)!, row = await this.write(chatId, content);
		if (!content.trim() && row && this.versions.get(chatId) === version) this.remote = { chatId, content: row.content, version };
	}

	/** Serialize writes per chat so a save already in flight cannot overtake a clear. */
	private async write(chatId: string, content: string, submitted?: InputDraftSubmission): Promise<ChatDraft | null> {
		const previous = this.writes.get(chatId);
		const edit = this.edits.get(chatId);
		const revisionOf = (row: ChatDraft | null) => row && (!submitted || row.content === submitted.content) ? row.revision : null;
		const knownRevision = submitted ? submitted.draft?.revision ?? null : revisionOf(this.serverDrafts.get(chatId) ?? null);
		// Bind cleanup to our own prior acknowledgement, not to a later remote reload.
		// A failed save falls back to the revision known before that save was attempted.
		const expected = previous ? previous.then(revisionOf, () => knownRevision) : Promise.resolve(knownRevision);
		const write = expected.then(async revision => {
			// An emptied box means "no draft", not an empty draft row.
			const row = content.trim() ? await db.upsertChatDraft(chatId, content) : await db.deleteChatDraft(chatId, revision);
			this.serverDrafts.set(chatId, row);
			if (edit) edit.saved = row;
			return row;
		});
		this.writes.set(chatId, write);
		try {
			return await write;
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
