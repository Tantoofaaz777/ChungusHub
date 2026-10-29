import type { Chat, ChatListStats } from '#lib/types/chat.ts';
import { buildSearchRegex } from './chat-search';

export type SortKey = 'activity' | 'created' | 'messages' | 'title';
export type SortDir = 'asc' | 'desc';
export type FilterMode = 'all' | 'favorites' | 'duplicates';

export const SORT_OPTIONS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
	{ key: 'activity', label: 'Last activity', defaultDir: 'desc' },
	{ key: 'created', label: 'Date created', defaultDir: 'desc' },
	{ key: 'messages', label: 'Message count', defaultDir: 'desc' },
	{ key: 'title', label: 'Title', defaultDir: 'asc' }
];

/** Count only live chats: a deleted twin must stop keeping the survivor in the filter. */
export function chatTwinCounts(chats: Chat[], groups: Record<string, string>): Record<string, number> {
	const sizes = new Map<string, number>();
	for (const chat of chats) {
		const group = groups[chat.id];
		if (group !== undefined) sizes.set(group, (sizes.get(group) ?? 0) + 1);
	}
	return Object.fromEntries(chats.flatMap((chat) => {
		const group = groups[chat.id];
		return group !== undefined ? [[chat.id, sizes.get(group)!]] : [];
	}));
}

export function chatActivityAt(chat: Chat, stats: Record<string, ChatListStats>): number {
	return stats[chat.id]?.lastAt ?? chat.updatedAt;
}

/** Shared by the welcome list and the full browser; message hits are opt-in. */
export function filterAndSortChats(
	chats: Chat[],
	options: {
		query: string;
		filter: FilterMode;
		sort: SortKey;
		direction: SortDir;
		stats: Record<string, ChatListStats>;
		twins: Record<string, number>;
		messageHits?: Record<string, unknown>;
	}
): Chat[] {
	const matcher = buildSearchRegex(options.query.trim(), { matchCase: false, wholeWord: false });
	const list = chats.filter((chat) => {
		if (options.filter === 'favorites' && !chat.isFavorite) return false;
		if (options.filter === 'duplicates' && (options.twins[chat.id] ?? 0) < 2) return false;
		if (!matcher) return true;
		matcher.lastIndex = 0;
		return matcher.test(chat.title) || !!options.messageHits?.[chat.id];
	});
	const direction = options.direction === 'asc' ? 1 : -1;
	list.sort((a, b) => {
		let comparison: number;
		switch (options.sort) {
			case 'created': comparison = a.createdAt - b.createdAt; break;
			case 'messages': comparison = (options.stats[a.id]?.path ?? 0) - (options.stats[b.id]?.path ?? 0); break;
			case 'title': comparison = a.title.localeCompare(b.title); break;
			default: comparison = chatActivityAt(a, options.stats) - chatActivityAt(b, options.stats);
		}
		return comparison !== 0 ? comparison * direction : chatActivityAt(b, options.stats) - chatActivityAt(a, options.stats);
	});
	return options.filter === 'favorites'
		? list
		: [...list.filter((chat) => chat.isFavorite), ...list.filter((chat) => !chat.isFavorite)];
}
