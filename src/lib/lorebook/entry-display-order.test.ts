import { describe, expect, test } from 'bun:test';
import { createEmptyLorebookEntry } from './types';
import { createEntryDisplayOrder } from './entry-display-order';

const entry = (id: string, order: number) => ({ ...createEmptyLorebookEntry(), id, comment: id, order });
const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id);

describe('lorebook editor row positions', () => {
	test('editing order keeps the row in place with live values until refresh', () => {
		const display = createEntryDisplayOrder();
		const original = [entry('a', 10), entry('b', 20), entry('c', 30)];
		expect(ids(display(original, 'book', 'order', 0))).toEqual(['a', 'b', 'c']);
		const edited = original.map((row) => row.id === 'a' ? { ...row, order: 99, content: 'Edited text' } : row);
		const held = display(edited, 'book', 'order', 0);
		expect(ids(held)).toEqual(['a', 'b', 'c']);
		expect(held[0]).toBe(edited[0]);
		expect(held[0].order).toBe(99);
		expect(ids(display(edited, 'book', 'order', 1))).toEqual(['b', 'c', 'a']);
		expect(ids(edited)).toEqual(['a', 'b', 'c']);
	});

	test('reopening an editor and changing book or sort use the current values', () => {
		const display = createEntryDisplayOrder();
		const rows = [entry('a', 10), entry('b', 20)];
		display(rows, 'first', 'order', 0);
		rows[0].order = 30;
		expect(ids(createEntryDisplayOrder()(rows, 'first', 'order', 0))).toEqual(['b', 'a']);
		expect(ids(display(rows, 'second', 'order', 0))).toEqual(['b', 'a']);
		expect(ids(display(rows, 'second', 'order-desc', 0))).toEqual(['a', 'b']);
	});

	test('new and removed entries update immediately without moving retained rows', () => {
		const display = createEntryDisplayOrder();
		const rows = [entry('a', 10), entry('b', 20)];
		display(rows, 'book', 'order', 0);
		const added = [...rows, entry('c', 0)];
		expect(ids(display(added, 'book', 'order', 0))).toEqual(['a', 'b', 'c']);
		const removed = added.filter((row) => row.id !== 'a');
		expect(ids(display(removed, 'book', 'order', 0))).toEqual(['b', 'c']);
		expect(ids(display(removed, 'book', 'order', 1))).toEqual(['c', 'b']);
	});

	test('searching a filtered view does not lose hidden row positions', () => {
		const display = createEntryDisplayOrder();
		const rows = [entry('a', 10), entry('b', 20)];
		display(rows, 'book', 'order', 0);
		rows[0].order = 30;
		expect(ids(display(rows, 'book', 'order', 0).filter((row) => row.id === 'b'))).toEqual(['b']);
		expect(ids(display(rows, 'book', 'order', 0))).toEqual(['a', 'b']);
	});
});
