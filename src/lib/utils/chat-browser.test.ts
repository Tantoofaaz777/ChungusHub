import { describe, expect, test } from 'bun:test';
import type { Chat, ChatListStats } from '$lib/types/chat';
import { chatTwinCounts, filterAndSortChats } from './chat-browser';

function chat(id: string, overrides: Partial<Chat> = {}): Chat {
	return {
		id, title: id, createdAt: 0, updatedAt: 0, rootMessageId: null,
		activeLeafId: null, canonLeafId: null, settings: null, characterId: null,
		characterVersionId: null, isFavorite: false, featureState: null, ...overrides
	};
}

const options = {
	query: '', filter: 'all', sort: 'activity', direction: 'desc',
	stats: {} as Record<string, ChatListStats>, twins: {} as Record<string, number>
} as const;
const ids = (chats: Chat[]) => chats.map((entry) => entry.id);

describe('shared chat browser', () => {
	test('search is literal, case insensitive, and resets the matcher between rows', () => {
		const chats = [chat('a', { title: '[LILA]' }), chat('b', { title: '[lila]' }), chat('c', { title: 'Lila' })];
		expect(ids(filterAndSortChats(chats, { ...options, query: ' [lila] ' }))).toEqual(['a', 'b']);
	});

	test('message hits are used only when supplied by the full browser', () => {
		const chats = [chat('a')];
		expect(filterAndSortChats(chats, { ...options, query: 'message text' })).toEqual([]);
		expect(ids(filterAndSortChats(chats, { ...options, query: 'message text', messageHits: { a: { hits: 1 } } }))).toEqual(['a']);
	});

	test('favorites stay first in either direction and the favorites filter excludes the rest', () => {
		const chats = [chat('a'), chat('b', { isFavorite: true }), chat('c')];
		expect(ids(filterAndSortChats(chats, { ...options, sort: 'title', direction: 'asc' }))).toEqual(['b', 'a', 'c']);
		expect(ids(filterAndSortChats(chats, { ...options, sort: 'title', direction: 'desc' }))).toEqual(['b', 'c', 'a']);
		expect(ids(filterAndSortChats(chats, { ...options, filter: 'favorites' }))).toEqual(['b']);
	});

	test('activity uses the active branch, with updatedAt as the empty-chat fallback', () => {
		const chats = [chat('a', { updatedAt: 90 }), chat('b', { updatedAt: 30 })];
		const stats = { a: { path: 2, total: 9, lastAt: 10 }, b: { path: 0, total: 0, lastAt: null } };
		expect(ids(filterAndSortChats(chats, { ...options, stats }))).toEqual(['b', 'a']);
	});

	test('sorts creation dates and branch message counts, breaking ties with activity', () => {
		const chats = [chat('a', { createdAt: 10, updatedAt: 10 }), chat('b', { createdAt: 20, updatedAt: 20 }), chat('c', { updatedAt: 30 })];
		const stats = { a: { path: 2, total: 50, lastAt: 10 }, b: { path: 3, total: 3, lastAt: 20 }, c: { path: 2, total: 2, lastAt: 30 } };
		expect(ids(filterAndSortChats(chats, { ...options, sort: 'created', direction: 'asc' }))).toEqual(['c', 'a', 'b']);
		expect(ids(filterAndSortChats(chats, { ...options, sort: 'messages', stats }))).toEqual(['b', 'c', 'a']);
	});

	test('identical-chat filtering ignores stale deleted partners, but counts twins outside a scope', () => {
		const chats = [chat('a'), chat('b'), chat('c')];
		const twins = chatTwinCounts(chats, { a: 'pair', b: 'pair', c: 'single', deleted: 'single' });
		expect(twins).toEqual({ a: 2, b: 2, c: 1 });
		expect(ids(filterAndSortChats(chats, { ...options, filter: 'duplicates', twins }))).toEqual(['a', 'b']);
		expect(ids(filterAndSortChats([chats[0]], { ...options, filter: 'duplicates', twins }))).toEqual(['a']);
	});

	test('combining query and filters does not mutate the source list', () => {
		const chats = [chat('z', { isFavorite: true }), chat('a'), chat('b')];
		expect(filterAndSortChats(chats, { ...options, query: 'a', filter: 'favorites' })).toEqual([]);
		filterAndSortChats(chats, { ...options, sort: 'title', direction: 'asc' });
		expect(ids(chats)).toEqual(['z', 'a', 'b']);
	});
});
