/** Wire version changes whenever turn/variant mutations cease to be compatible. */
export const CONVERSATION_PROTOCOL = 2;

export interface ConversationPlacement {
	operation: 'append' | 'add_variant' | 'replace_variants';
	messageId: string | null;
	expectedLeafId: string | null;
	expectedVariantId: string | null;
	expectedRevision: number;
	contextFingerprint: string;
	replaceVariantIds?: string[];
}

export interface VariantSelection {
	chatId: string;
	messageId: string;
	variantId: string;
	expectedRevision: number;
}

export interface VariantBookmark extends VariantSelection { bookmarked: boolean }
export interface VariantContent extends VariantSelection { content: string; minor?: boolean }

/** Identity of the continued version and the entire selected transcript used to build its prompt. */
export interface ContinuationContext extends VariantSelection { contextFingerprint: string }

export function isContinuationContext(value: unknown): value is ContinuationContext {
	const c = value as ContinuationContext | null;
	return !!c && typeof c === 'object' &&
		[c.chatId, c.messageId, c.variantId, c.contextFingerprint].every(v => typeof v === 'string' && !!v) &&
		Number.isSafeInteger(c.expectedRevision) && c.expectedRevision >= 0;
}

export function isConversationPlacement(value: unknown): value is ConversationPlacement {
	const p = value as ConversationPlacement | null;
	return !!p && typeof p === 'object' && ['append', 'add_variant', 'replace_variants'].includes(p.operation) &&
		(p.messageId === null || typeof p.messageId === 'string' && !!p.messageId) &&
		(p.expectedLeafId === null || typeof p.expectedLeafId === 'string' && !!p.expectedLeafId) &&
		(p.expectedVariantId === null || typeof p.expectedVariantId === 'string' && !!p.expectedVariantId) &&
		Number.isSafeInteger(p.expectedRevision) && p.expectedRevision >= 0 && typeof p.contextFingerprint === 'string' &&
		!!p.contextFingerprint && (p.operation === 'append' ? p.messageId === null : p.messageId !== null) &&
		(p.replaceVariantIds === undefined || Array.isArray(p.replaceVariantIds) &&
			p.replaceVariantIds.every(id => typeof id === 'string' && !!id));
}
