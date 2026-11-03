import type { Message } from '#lib/types/chat.ts';
import { collectSubtree } from './message-tree';

/** A reading copy of a version. Its structural identity always belongs to the original turn. */
export function responseVersions(turn: Message) {
	if (!turn.variants?.length) return [{ message: turn, variantId: null, index: 0, selected: true }];
	return turn.variants.map((variant, index) => ({
		message: { ...turn, ...variant, id: turn.id, chatId: turn.chatId, parentId: turn.parentId,
			role: turn.role, selectedVariantId: variant.id },
		variantId: variant.id, index, selected: variant.id === turn.selectedVariantId
	}));
}

export function inactiveResponseVersions(turns: Message[]) {
	return turns.flatMap((turn, index) => responseVersions(turn).filter(version => !version.selected)
		.map(version => ({ ...version, ordinal: index + 1 })));
}

/** Turn deletion removes all of its versions, even versions that are not currently selected. */
export function deletionStats(messages: Message[], id: string, includeSelf = true) {
	const subtree = collectSubtree(messages, id), turns = includeSelf ? subtree : subtree.slice(1);
	return { turns: turns.length, versions: turns.reduce((total, turn) => total + (turn.variants?.length || 1), 0) };
}

export function transcriptChange(previous: { id: string | null; variantId: string | null }, messages: Message[]): 'same' | 'append' | 'replace' {
	const last = messages.at(-1);
	if (previous.id === (last?.id ?? null) && previous.variantId === (last?.selectedVariantId ?? null)) return 'same';
	if (previous.id === null || messages.some(turn => turn.id === previous.id &&
		(turn.selectedVariantId ?? null) === previous.variantId)) return 'append';
	return 'replace';
}
