import { expect, test } from 'bun:test';
import type { RecoveredGeneration } from '#shared/recovered-generation.ts';
const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity });
const { RecoveredGenerationsStore } = await import('./recoveredGenerations.svelte');
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
const record = (id: string, chatId = 'a'): RecoveredGeneration => ({ id, chatId, createdAt: 1, reason: 'Changed', payload: { content: id } });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture() {
	const reads: { chatId: string; task: ReturnType<typeof deferred<RecoveredGeneration[]>> }[] = [];
	const writes: { chatId: string; id: string; task: ReturnType<typeof deferred<void>> }[] = [];
	const store = new RecoveredGenerationsStore({
		getRecoveredGenerations: chatId => { const task = deferred<RecoveredGeneration[]>(); reads.push({ chatId, task }); return task.promise; },
		discardRecoveredGeneration: (chatId, id) => { const task = deferred<void>(); writes.push({ chatId, id, task }); return task.promise; }
	});
	return { store, reads, writes };
}

test('newer refreshes and chat changes supersede late recovery reads', async () => {
	const { store, reads } = fixture();
	store.setChat('a'); const next = store.refresh();
	reads[1].task.resolve([record('new')]); await next;
	reads[0].task.resolve([record('old')]); await settle();
	expect(store.entries.map(r => r.id)).toEqual(['new']);
	store.setChat('b'); store.setChat('a');
	reads[3].task.resolve([record('returned')]); await settle();
	reads[2].task.resolve([record('wrong-chat', 'b')]); await settle();
	expect(store.entries.map(r => r.id)).toEqual(['returned']);
	expect(store.loading).toBe(false);
});

test('refresh failure retains saved text and a retry clears the error', async () => {
	const { store, reads } = fixture(); store.setChat('a'); reads[0].task.resolve([record('keep')]); await settle();
	const failing = store.refresh(); reads[1].task.reject(new Error('Offline')); await failing;
	expect(store.error).toBe('Offline'); expect(store.entries[0].id).toBe('keep');
	const retry = store.refresh(); reads[2].task.resolve([record('keep'), record('added')]); await retry;
	expect(store.error).toBeNull(); expect(store.entries).toHaveLength(2);
});

test('failed discard preserves the response and concurrent reads cannot restore a deleted response', async () => {
	const { store, reads, writes } = fixture(); store.setChat('a'); reads[0].task.resolve([record('keep')]); await settle();
	const failed = store.discard('keep').catch(error => error);
	writes[0].task.reject(new Error('Offline')); expect((await failed).message).toBe('Offline');
	expect(store.entries[0].payload).toEqual({ content: 'keep' }); expect(store.removingId).toBeNull();
	const oldRead = store.refresh();
	const removed = store.discard('keep'); await store.refresh();
	writes[1].task.resolve(); await removed;
	expect(store.entries).toEqual([]);
	reads[1].task.resolve([record('keep')]); await oldRead;
	expect(store.entries).toEqual([]);
	reads[2].task.resolve([]); await settle(); expect(store.loading).toBe(false);
});

test('a discard finishing after leaving and returning refreshes that chat without clearing a newer write', async () => {
	const { store, reads, writes } = fixture(); store.setChat('a'); reads[0].task.resolve([record('old'), record('new')]); await settle();
	const oldWrite = store.discard('old'); store.setChat('b'); store.setChat('a');
	reads[2].task.resolve([record('old'), record('new')]); await settle();
	const newWrite = store.discard('new');
	writes[0].task.resolve(); await oldWrite;
	expect(store.removingId).toBe('new');
	writes[1].task.resolve(); await newWrite;
	expect(reads).toHaveLength(4);
	reads[3].task.resolve([]); reads[1].task.resolve([record('foreign', 'b')]); await settle();
	expect(store.entries).toEqual([]); expect(store.removingId).toBeNull();
});
