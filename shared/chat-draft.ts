/** Persisted draft identity. Revisions are opaque and change on every save, including equal text. */
export interface ChatDraft {
	chatId: string;
	content: string;
	updatedAt: number;
	revision: string;
}
