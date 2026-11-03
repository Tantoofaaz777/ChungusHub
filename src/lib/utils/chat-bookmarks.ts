import type { Message } from '#lib/types/chat.ts';

type BookmarkSource = Pick<Message, 'id' | 'parentId' | 'createdAt' | 'isBookmarked'> & {
	selectedVariantId?: string;
	variants?: readonly { id: string; createdAt: number; isBookmarked?: boolean }[];
};

/** Bookmarked versions share their stable turn’s number and keep distinct version IDs.
 * Ancestor depths are memoized: a long chat is indexed once, not once per bookmark. */
export function chatBookmarks<T extends BookmarkSource>(messages: T[], activePath: (Pick<Message, 'id'> & { selectedVariantId?: string })[]) {
	const saved = messages.flatMap(turn => turn.variants?.length
		? turn.variants.flatMap((variant, versionIndex) => variant.isBookmarked
			? [{ message: { ...turn, ...variant, id: turn.id, parentId: turn.parentId } as T,
				variantId: variant.id as string | null, versionIndex, key: `${turn.id}:${variant.id}` }] : [])
		: turn.isBookmarked ? [{ message: turn, variantId: null as string | null, versionIndex: 0, key: turn.id }] : []);
	if (!saved.length) return [];
	const byId = new Map(messages.map(message => [message.id, message]));
	const onPath = new Set(activePath.map(message => message.id));
	const selected = new Map(activePath.map(message => [message.id, message.selectedVariantId]));
	const depths = new Map<string, number>();
	function ordinal(message: T): number {
		const chain: T[] = [], seen = new Set<string>();
		let current: T | undefined = message;
		while (current && !depths.has(current.id) && !seen.has(current.id)) {
			seen.add(current.id); chain.push(current);
			current = current.parentId ? byId.get(current.parentId) : undefined;
		}
		let depth = current ? depths.get(current.id) ?? 0 : 0;
		for (const ancestor of chain.reverse()) depths.set(ancestor.id, ++depth);
		return depths.get(message.id)!;
	}
	return saved.map(entry => ({ ...entry, ordinal: ordinal(entry.message),
		onPath: onPath.has(entry.message.id) && (!entry.variantId || entry.variantId === (selected.get(entry.message.id) ?? entry.message.selectedVariantId)) }))
		.sort((a, b) => a.ordinal - b.ordinal || a.message.createdAt - b.message.createdAt);
}
