import { expect, test } from 'bun:test';
import { chatBookmarks } from './chat-bookmarks';

const turn = (id: string, parentId: string | null, createdAt: number, isBookmarked = true) => ({ id, parentId, createdAt, isBookmarked });

test('bookmarks include off-path swipes, retain their distinct ids and use story message numbers', () => {
	const messages = [turn('third', 'second', 30), turn('alternate', 'root', 40), turn('root', null, 10, false), turn('second', 'root', 20)];
	const before = [...messages];
	expect(chatBookmarks(messages, [{ id: 'root' }, { id: 'second' }, { id: 'third' }]).map(({ message, ordinal, onPath }) => [message.id, ordinal, onPath]))
		.toEqual([['second', 2, true], ['alternate', 2, false], ['third', 3, true]]);
	expect(messages).toEqual(before);
});

test('unmarked or removed turns do not leave dangling bookmarks', () => {
	expect(chatBookmarks([turn('root', null, 1, false)], [])).toEqual([]);
	expect(chatBookmarks([], [])).toEqual([]);
	expect(chatBookmarks([turn('orphan', 'removed', 1)], []).map(item => item.ordinal)).toEqual([1]);
});

test('a large reversed input and every bookmarked ancestor are indexed without recursive stack growth', () => {
	const messages = Array.from({ length: 10000 }, (_, index) => turn(String(index), index ? String(index - 1) : null, index));
	const result = chatBookmarks([...messages].reverse(), messages);
	expect(result).toHaveLength(10000);
	expect(result[0].ordinal).toBe(1);
	expect(result.at(-1)!.ordinal).toBe(10000);
	expect(result.every(item => item.onPath)).toBe(true);
});
