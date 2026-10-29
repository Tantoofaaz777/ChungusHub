/** State transitions only: rune shims do not attempt to test Svelte reactivity. */
import { beforeEach, describe, expect, test } from 'bun:test';
import type { PromptLogEntry } from './types';
import type { PromptLogEvent } from '#lib/services/transport.ts';

const globals = globalThis as unknown as Record<string, unknown>;
const previousState = globals.$state;
const previousDerived = globals.$derived;
globals.$state = <T>(value: T) => value;
globals.$derived = <T>(value: T) => value;
const { promptLogStore } = await import('./promptLog.svelte');
if (previousState === undefined) delete globals.$state; else globals.$state = previousState;
if (previousDerived === undefined) delete globals.$derived; else globals.$derived = previousDerived;

const store = promptLogStore as unknown as {
	entries: PromptLogEntry[]; limit: number; selectedId: string | null; compareIds: string[];
	handle(event: PromptLogEvent): void;
	applySnapshot(data: { entries: PromptLogEntry[]; limit: number }): void;
};

function entry(id: string, startedAt: number): PromptLogEntry {
	return { id, startedAt, source: 'chat', kind: 'completion', provider: 'test', model: 'test', messages: [], stream: true, status: 'pending' };
}

beforeEach(() => {
	store.selectedId = null;
	store.compareIds = [];
	store.applySnapshot({ entries: [], limit: 10 });
});

describe('live prompt log retention', () => {
	test('the live feed stays bounded and clears an evicted selection/compare pick', () => {
		for (let i = 1; i <= 10; i++) store.handle({ type: 'request', entry: entry(`p${i}`, i) });
		store.selectedId = 'p1';
		store.compareIds = ['p1', 'p10'];
		store.handle({ type: 'request', entry: entry('p11', 11) });
		expect(store.entries).toHaveLength(10);
		expect(store.entries.map(e => e.id)).toEqual(['p11', 'p10', 'p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3', 'p2']);
		expect(store.selectedId).toBeNull();
		expect(store.compareIds).toEqual(['p10']);
	});

	test('retention from another device removes entries and follows server tie ordering', () => {
		store.applySnapshot({ entries: [entry('a', 100), entry('b', 100), entry('c', 100)], limit: 10 });
		store.selectedId = 'a';
		store.compareIds = ['a', 'b'];
		store.handle({ type: 'retention', limit: 2, ids: ['c', 'b'] });
		expect(store.entries.map(e => e.id)).toEqual(['c', 'b']);
		expect(store.limit).toBe(2);
		expect(store.selectedId).toBeNull();
		expect(store.compareIds).toEqual(['b']);
	});

	test('duplicate requests and late results cannot grow the list', () => {
		store.applySnapshot({ entries: [entry('new', 2)], limit: 1 });
		store.handle({ type: 'request', entry: entry('new', 2) });
		store.handle({ type: 'request', entry: entry('old', 1) });
		store.handle({ type: 'result', id: 'old', result: { status: 'done', endedAt: 3 } });
		expect(store.entries.map(e => e.id)).toEqual(['new']);
	});
});
