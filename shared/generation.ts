/**
 * The story-turn placement that rides an `llm` request, so the SERVER can write the reply
 * when the generation ends (architecture/server-core.md).
 *
 * It lives here rather than in a copy per side because it is a wire shape with two consumers
 * and no compiler between them: `handleLlm` types its message structurally, so a field
 * renamed on one side alone would vanish through `JSON.stringify` with nothing failing to
 * build. Same reasoning as `SyncScope` in ./sync.ts.
 */
import { isContinuationContext, isConversationPlacement, type ContinuationContext, type ConversationPlacement } from './conversation';

export interface ContinuationCommit extends ContinuationContext {
	continuationSent: string;
	spendSteeringIds: string[];
}
export interface ContinuationBase {
	content: string;
	thinking: string | null;
	tokensCompletion: number | null;
	generationMs: number | null;
	reasoningMs: number | null;
}
export interface ContinuationPatch extends ContinuationBase {
	tokensPrompt: number | null;
	finishReason: string | null;
}
export function isContinuationCommit(value: unknown): value is ContinuationCommit {
	const c = value as ContinuationCommit | null;
	return isContinuationContext(c) && typeof (c as ContinuationCommit).continuationSent === 'string' &&
		Array.isArray((c as ContinuationCommit).spendSteeringIds) && (c as ContinuationCommit).spendSteeringIds.every(id => typeof id === 'string' && !!id);
}

export interface GenerationCommit {
	placement?: ConversationPlacement;
	chatId: string;
	/** The row the turn hangs under; null lands a root sibling (an opening scene). */
	parentId: string | null;
	/** The chat's leaf as the request leaves. The commit moves the leaf only if it still
	 *  reads that, so a reader who walked to another branch meanwhile is left where they are. */
	expectedLeafId: string | null;
	/** Claim `rootMessageId` when the chat holds none. Opening scene only. */
	claimsRoot: boolean;
	/** The lorebook scan that shaped this turn, stored on the row it produces. */
	lorebook: unknown;
	/** Ids of the 'once' steering notes this prompt resolved, spent inside the commit. */
	spendSteeringIds: string[];
	/** Snapshot of sibling subtrees to replace, only after a complete reply is saved. */
	replaceMessageIds?: string[];
}

/** Whether an inbound placement is shaped like one. Every field is checked, `spendSteeringIds`
 *  down to its elements: an id that is not a string reaches a SQL bind inside the commit
 *  transaction and throws there, which discards a reply that has already been paid for. */
export function isGenerationCommit(value: unknown): value is GenerationCommit {
	const c = value as GenerationCommit | null;
	return (
		!!c &&
		typeof c === 'object' &&
		typeof c.chatId === 'string' &&
		!!c.chatId &&
		(c.placement === undefined || isConversationPlacement(c.placement)) &&
		(c.parentId === null || typeof c.parentId === 'string') &&
		(c.expectedLeafId === null || typeof c.expectedLeafId === 'string') &&
		typeof c.claimsRoot === 'boolean' &&
		Array.isArray(c.spendSteeringIds) &&
		c.spendSteeringIds.every((id) => typeof id === 'string') &&
		(c.replaceMessageIds === undefined || (
			Array.isArray(c.replaceMessageIds) && c.replaceMessageIds.every(id => typeof id === 'string' && !!id)
		))
	);
}
