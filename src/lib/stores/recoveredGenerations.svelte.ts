import { db } from '#lib/services/database.ts';
import type { RecoveredGeneration } from '#shared/recovered-generation.ts';

interface RecoveryApi {
	getRecoveredGenerations(chatId: string): Promise<RecoveredGeneration[]>;
	discardRecoveredGeneration(chatId: string, id: string): Promise<void>;
}

export class RecoveredGenerationsStore {
	chatId = $state<string | null>(null);
	entries = $state<RecoveredGeneration[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	removingId = $state<string | null>(null);
	open = $state(false);
	private ticket = 0;
	private epoch = 0;
	private refreshAfterWrite = false;
	constructor(private api: RecoveryApi = db) {}

	setChat(chatId: string | null) {
		if (chatId === this.chatId) return;
		++this.ticket; ++this.epoch; this.chatId = chatId; this.entries = []; this.error = null;
		this.loading = false; this.removingId = null; this.open = false; this.refreshAfterWrite = false;
		if (chatId) void this.refresh();
	}
	async refresh(): Promise<void> {
		const chatId = this.chatId;
		if (!chatId) return;
		if (this.removingId) { this.refreshAfterWrite = true; return; }
		const ticket = ++this.ticket;
		this.loading = true; this.error = null;
		try {
			const entries = await this.api.getRecoveredGenerations(chatId);
			if (ticket === this.ticket && this.chatId === chatId) this.entries = entries;
		} catch (error) {
			if (ticket === this.ticket && this.chatId === chatId) this.error = error instanceof Error ? error.message : String(error);
		} finally { if (ticket === this.ticket && this.chatId === chatId) this.loading = false; }
	}
	async discard(id: string): Promise<void> {
		const chatId = this.chatId;
		const epoch = this.epoch;
		if (!chatId || this.removingId || !this.entries.some(entry => entry.id === id)) return;
		++this.ticket; this.loading = false; this.removingId = id;
		try {
			await this.api.discardRecoveredGeneration(chatId, id);
			if (this.chatId === chatId && this.epoch === epoch) { ++this.ticket; this.entries = this.entries.filter(entry => entry.id !== id); }
			else if (this.chatId === chatId) void this.refresh();
		} finally {
			if (this.chatId === chatId && this.epoch === epoch) {
				this.removingId = null;
				if (this.refreshAfterWrite) { this.refreshAfterWrite = false; void this.refresh(); }
			}
		}
	}
}
export const recoveredGenerations = new RecoveredGenerationsStore();
