import { expect, test } from 'bun:test';
import type { Message } from '#lib/types/chat.ts';
import { deletionStats, inactiveResponseVersions, responseVersions, transcriptChange } from './response-versions';
import { findVersionHits } from './chat-search';
import { chatBookmarks } from './chat-bookmarks';

const turn = (id = 'reply', parentId: string | null = null): Message => ({
	id, chatId: 'chat', parentId, role: 'assistant', content: 'Selected', selectedVariantId: 'a',
	createdAt: 1, isBookmarked: true, variants: [
		{ id: 'a', content: 'Selected', createdAt: 1, isBookmarked: true },
		{ id: 'b', content: 'Saved needle needle', createdAt: 2, thinking: 'Reasoning', isBookmarked: true },
		{ id: 'c', content: 'Another needle', createdAt: 3, isBookmarked: false }
	]
} as Message);

test('inspecting a version preserves its exact payload and the structural turn without selecting it', () => {
	const message = turn(), before = structuredClone(message);
	const versions = responseVersions(message);
	expect(versions.map(v => [v.variantId, v.index, v.selected])).toEqual([['a', 0, true], ['b', 1, false], ['c', 2, false]]);
	expect(versions[1].message).toMatchObject({ id: 'reply', chatId: 'chat', parentId: null, role: 'assistant',
		content: 'Saved needle needle', thinking: 'Reasoning', selectedVariantId: 'b' });
	expect(message).toEqual(before);
});

test('search results distinguish versions of the same turn and exclude the selected version', () => {
	const message = turn(), before = structuredClone(message);
	const candidates = inactiveResponseVersions([message]).map(v => ({ messageId: v.message.id,
		variantId: v.variantId!, ordinal: v.ordinal, versionIndex: v.index, text: v.message.content }));
	const regex = /needle/g;
	expect(findVersionHits(candidates, regex, 10)).toEqual([
		{ messageId: 'reply', variantId: 'b', ordinal: 1, versionIndex: 1, count: 2, snippet: 'Saved needle needle' },
		{ messageId: 'reply', variantId: 'c', ordinal: 1, versionIndex: 2, count: 1, snippet: 'Another needle' }
	]);
	expect(findVersionHits(candidates, regex, 1)).toHaveLength(1);
	expect(findVersionHits(candidates, regex, 0)).toEqual([]);
	expect(regex.lastIndex).toBe(0);
	expect(message).toEqual(before);
});

test('two bookmarked versions share a turn number and retain distinct identities and selection state', () => {
	const message = turn(), before = structuredClone(message);
	const bookmarks = chatBookmarks([message], [message]);
	expect(bookmarks.map(b => [b.key, b.variantId, b.ordinal, b.onPath, b.message.content])).toEqual([
		['reply:a', 'a', 1, true, 'Selected'], ['reply:b', 'b', 1, false, 'Saved needle needle']
	]);
	expect(message).toEqual(before);
	expect(chatBookmarks([message], [{ id: message.id, selectedVariantId: 'b' }]).map(b => b.onPath)).toEqual([false, true]);
});

test('deletion counts turns separately from all of their saved versions', () => {
	const root = turn(), child = { ...turn('child', root.id), variants: undefined, selectedVariantId: undefined };
	expect(deletionStats([root, child], root.id)).toEqual({ turns: 2, versions: 4 });
	expect(deletionStats([root, child], root.id, false)).toEqual({ turns: 1, versions: 1 });
	expect(responseVersions(child)).toEqual([{ message: child, variantId: null, index: 0, selected: true }]);
});

test('scroll classification detects a swipe even when the last turn ID stays the same', () => {
	const message = turn(), previous = { id: message.id, variantId: 'a' };
	expect(transcriptChange(previous, [message])).toBe('same');
	expect(transcriptChange(previous, [{ ...message, selectedVariantId: 'b' }])).toBe('replace');
	expect(transcriptChange(previous, [message, turn('child', message.id)])).toBe('append');
	expect(transcriptChange(previous, [])).toBe('replace');
	expect(transcriptChange({ id: null, variantId: null }, [message])).toBe('append');
});
