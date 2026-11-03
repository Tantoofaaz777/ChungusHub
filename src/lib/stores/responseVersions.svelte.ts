/** Opening a version is inspection only. Context mutations go through the message store. */
class ResponseVersionsStore {
	target = $state<{ chatId: string; messageId: string; variantId: string | null } | null>(null);
	show(chatId: string, messageId: string, variantId: string | null = null) {
		this.target = { chatId, messageId, variantId };
	}
	close() { this.target = null; }
}
export const responseVersionsStore = new ResponseVersionsStore();
