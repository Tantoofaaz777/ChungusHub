import type { Message } from '#lib/types/chat.ts';

type BookmarkSource = Pick<Message, 'id' | 'parentId' | 'createdAt' | 'isBookmarked'>;

/** Message numbers follow parent links, so swipes share a number without being merged.
 * Ancestor depths are memoized: a long chat is indexed once, not once per bookmark. */
export function chatBookmarks<T extends BookmarkSource>(messages: T[], activePath: Pick<Message, 'id'>[]) {
	const saved = messages.filter(message => message.isBookmarked);
	if (!saved.length) return [];
	const byId = new Map(messages.map(message => [message.id, message]));
	const onPath = new Set(activePath.map(message => message.id));
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
	return saved.map(message => ({ message, ordinal: ordinal(message), onPath: onPath.has(message.id) }))
		.sort((a, b) => a.ordinal - b.ordinal || a.message.createdAt - b.message.createdAt);
}
