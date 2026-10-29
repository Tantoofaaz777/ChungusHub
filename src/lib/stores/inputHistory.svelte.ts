/**
 * The ↑/↓ recall log: every message sent from the composer, in send order,
 * independent of the messages table, so an entry survives its message (or whole
 * chat) being deleted. Storage is always global with the chat id alongside;
 * the chat-only view is just a client-side filter over it.
 */
import { db } from '#lib/services/database.ts';
import { generalSettingsStore } from '#lib/stores/general-settings.svelte.ts';

export interface InputHistoryEntry {
	id: number;
	chatId: string | null;
	content: string;
}

class InputHistoryStore {
	/** Oldest → newest; navigation walks it back to front. */
	entries = $state<InputHistoryEntry[]>([]);

	async initialize(): Promise<void> {
		await this.reload();
	}

	async reload(): Promise<void> {
		const ticket = ++this.readTicket, before = this.entries;
		const rows = await db.getInputHistory(generalSettingsStore.inputHistoryLimit);
		if (ticket === this.readTicket && before === this.entries) this.entries = rows;
	}
	private readTicket = 0;

	/** Log a sent message. Echoed locally so recall works before the write lands. */
	record(chatId: string | null, content: string): void {
		if (!generalSettingsStore.inputHistory) return;
		const limit = generalSettingsStore.inputHistoryLimit;
		// The local id is a placeholder; the real one arrives on the next reload.
		this.entries = [...this.entries, { id: -Date.now(), chatId, content }].slice(-limit);
		void db.addInputHistory(chatId, content, limit);
	}

	async clearAll(): Promise<void> {
		this.entries = [];
		await db.clearInputHistory();
	}
}

export const inputHistoryStore = new InputHistoryStore();
