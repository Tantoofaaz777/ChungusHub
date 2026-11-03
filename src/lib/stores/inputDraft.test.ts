import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { DebouncedWriter } from '#lib/utils/debounced-write.ts';

// Exercise asynchronous ordering with the real store and debounce, without Svelte's compiler.
const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity, snapshot: structuredClone });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
const realDatabase = { ...await import('#lib/services/database.ts') };
const realSettings = { ...await import('./general-settings.svelte') };
afterAll(() => {
	mock.module('#lib/services/database.ts', () => realDatabase);
	mock.module('#lib/stores/general-settings.svelte.ts', () => realSettings);
});

function deferred<T = void>() {
	let resolve!: (value: T) => void, reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
async function settle() {
	for (let i = 0; i < 30; i++) await Promise.resolve();
}
type Row = { chatId: string; content: string; updatedAt: number; revision: string };
let disk = new Map<string, string>();
let revisions = new Map<string, string>();
function row(chatId: string): Row | null { return disk.has(chatId) ? { chatId, content: disk.get(chatId)!, updatedAt: 1, revision: revisions.get(chatId)! } : null; }
let reads: { chatId: string; result: ReturnType<typeof deferred<Row | null>> }[] = [];
let calls: string[] = [];
let delayReads = false;
let saveGate: ReturnType<typeof deferred> | null = null;
let deleteGate: ReturnType<typeof deferred> | null = null;
const settings = { saveDrafts: true };
mock.module('#lib/services/database.ts', () => ({
	...realDatabase,
	db: {
		...realDatabase.db,
		getChatDraft: async (chatId: string) => {
			calls.push(`read:${chatId}`);
			if (delayReads) {
				const result = deferred<Row | null>();
				reads.push({ chatId, result });
				return result.promise;
			}
			return row(chatId);
		},
		upsertChatDraft: async (chatId: string, content: string) => {
			calls.push(`save:${chatId}:${content}`);
			await saveGate?.promise;
			disk.set(chatId, content);
			revisions.set(chatId, crypto.randomUUID());
			return row(chatId);
		},
		deleteChatDraft: async (chatId: string, expectedRevision: string | null) => {
			calls.push(`delete:${chatId}`);
			await deleteGate?.promise;
			if (revisions.get(chatId) === expectedRevision) { disk.delete(chatId); revisions.delete(chatId); }
			return row(chatId);
		}
	}
}));
mock.module('#lib/stores/general-settings.svelte.ts', () => ({ ...realSettings, generalSettingsStore: settings }));
const { InputDraftStore } = await import('./inputDraft.svelte');
let store: InstanceType<typeof InputDraftStore>;
// Flush the real debounce explicitly so network ordering is deterministic, without sleeps.
function flush(chatId?: string) {
	return (store as unknown as { writer: DebouncedWriter }).writer.flush(chatId);
}
function answer(index: number, content: string | null) {
	const read = reads[index];
	read.result.resolve(content === null ? null : { chatId: read.chatId, content, updatedAt: 1, revision: revisions.get(read.chatId) ?? 'read-revision' });
}
beforeEach(async () => {
	disk = new Map([['a', 'sent text']]); reads = []; calls = [];
	revisions = new Map([['a', 'initial']]);
	delayReads = false; saveGate = null; deleteGate = null;
	settings.saveDrafts = true;
	store = new InputDraftStore();
	await store.load('a'); calls = [];
});
afterEach(async () => {
	saveGate?.resolve(); deleteGate?.resolve();
	await flush();
	await settle();
});

describe('composer draft races', () => {
	test('restores a saved draft and accepts a later remote edit or deletion', async () => {
		const draft = await store.load('a');
		expect(draft?.content).toBe('sent text');
		expect(store.isCurrent(draft!)).toBe(true);
		disk.set('a', 'remote edit');
		await store.syncReload('a');
		expect(store.remote?.content).toBe('remote edit');
		expect(store.isCurrent(store.remote!)).toBe(true);
		disk.delete('a');
		await store.syncReload('a');
		expect(store.remote?.content).toBe('');
	});

	test('discards an initial read that returns after the message was sent', async () => {
		delayReads = true;
		const load = store.load('a'); await settle();
		store.clear('a');
		answer(0, 'sent text');
		expect(await load).toBeNull();
		await settle();
		expect(disk.has('a')).toBe(false);
	});

	test('discards a sync read that returns after the message was sent', async () => {
		delayReads = true;
		const sync = store.syncReload('a'); await settle();
		store.clear('a'); answer(0, 'sent text'); await sync;
		expect(store.remote).toBeNull();
	});

	test('rejects a resolved local draft if a send precedes its UI callback', async () => {
		store.schedule('a', 'sent text');
		const load = store.load('a');
		store.clear('a');
		const draft = await load;
		expect(draft?.content).toBe('sent text');
		expect(store.isCurrent(draft!)).toBe(false);
	});

	test('rejects an already-published remote draft after a send or local edit', async () => {
		await store.syncReload('a');
		const beforeSend = store.remote!;
		store.clear('a');
		expect(store.isCurrent(beforeSend)).toBe(false);
		await store.syncReload('a');
		const beforeTyping = store.remote!;
		store.schedule('a', 'new text');
		expect(store.isCurrent(beforeTyping)).toBe(false);
	});

	test('does not restore a read over text typed and then erased', async () => {
		delayReads = true;
		const load = store.load('a'); await settle();
		store.schedule('a', 'new text'); store.schedule('a', '');
		answer(0, 'sent text');
		expect(await load).toBeNull();
	});

	test('newer reads win even when older responses arrive last', async () => {
		delayReads = true;
		const older = store.syncReload('a'); await settle();
		const newer = store.syncReload('a'); await settle();
		answer(1, 'new remote draft'); await newer;
		answer(0, 'sent text'); await older;
		expect(store.remote?.content).toBe('new remote draft');
		expect(store.isCurrent(store.remote!)).toBe(true);
	});

	test('waits for a save already in flight before deleting the sent draft', async () => {
		saveGate = deferred();
		store.schedule('a', 'sent text');
		const saving = flush('a'); await settle();
		store.clear('a');
		const reopening = store.load('a'); await settle();
		expect(calls).toEqual(['save:a:sent text']);
		saveGate.resolve(); await saving;
		expect((await reopening)?.content).toBe('');
		expect(calls).toEqual(['save:a:sent text', 'delete:a', 'read:a']);
		expect(disk.has('a')).toBe(false);
	});

	test('a sync started after clear waits for the deletion to finish', async () => {
		deleteGate = deferred(); store.clear('a');
		const sync = store.syncReload('a'); await settle();
		expect(calls).toEqual(['delete:a']);
		deleteGate.resolve(); await sync;
		expect(store.remote?.content).toBe('');
	});

	test('keeps a new draft typed while deletion of the sent draft is in flight', async () => {
		deleteGate = deferred(); store.clear('a'); await settle();
		store.schedule('a', 'next message');
		expect((await store.load('a'))?.content).toBe('next message');
		const saving = flush('a'); await settle();
		expect(calls).toEqual(['delete:a']);
		deleteGate.resolve(); await saving;
		expect(disk.get('a')).toBe('next message');
	});

	test('a failed save does not block the following deletion', async () => {
		saveGate = deferred();
		store.schedule('a', 'sent text');
		const saving = flush('a');
		const failed = saving.catch((error: Error) => error);
		await settle(); store.clear('a');
		saveGate.reject(new Error('offline'));
		expect(await failed).toEqual(new Error('offline'));
		await settle();
		expect(calls).toEqual(['save:a:sent text', 'delete:a']);
		expect(disk.has('a')).toBe(false);
	});

	test('keeps reads and writes for different chats independent', async () => {
		saveGate = deferred(); store.schedule('a', 'sent text');
		const saving = flush('a'); await settle();
		store.clear('b');
		expect((await store.load('b'))?.content).toBe('');
		saveGate.resolve(); await saving;
		expect(disk.get('a')).toBe('sent text');
	});

	test('a delayed send only clears the draft version it actually submitted', async () => {
		store.schedule('a', 'Submitted'); const submitted = store.captureSubmission('a', 'Submitted');
		store.schedule('a', 'New draft'); store.clear('a', submitted); await flush('a');
		expect(disk.get('a')).toBe('New draft'); expect(calls).not.toContain('delete:a');
		store.clear('a', store.captureSubmission('a', 'New draft')); await settle(); expect(disk.has('a')).toBe(false);
	});

	test('an unchanged sync read before a send acknowledgement still allows cleanup', async () => {
		store.schedule('a', 'Submitted'); await flush('a');
		const submitted = store.captureSubmission('a', 'Submitted');
		await store.syncReload('a'); const snapshot = store.remote!;
		expect(snapshot.content).toBe('Submitted');
		store.clear('a', submitted); await settle();
		expect(calls).toContain('delete:a'); expect(disk.has('a')).toBe(false);
		expect(store.isCurrent(snapshot)).toBe(false);
	});

	test('sending before autosave removes the saved draft replaced by the submitted edit', async () => {
		store.schedule('a', 'Submitted before autosave');
		const submitted = store.captureSubmission('a', 'Submitted before autosave');
		await store.syncReload('a'); store.clear('a', submitted); await settle(); await flush('a');
		expect(disk.has('a')).toBe(false); expect(calls).not.toContain('save:a:Submitted before autosave');
	});

	test('a read still in flight cannot block cleanup or restore the sent draft', async () => {
		const submitted = store.captureSubmission('a', 'sent text');
		delayReads = true;
		const sync = store.syncReload('a'); await settle();
		store.clear('a', submitted); await settle();
		answer(0, 'sent text'); await sync;
		expect(disk.has('a')).toBe(false); expect(store.remote).toBeNull();
	});

	test('cleanup follows the submitted save even if it finishes after capture and before sync', async () => {
		for (const alreadySaving of [false, true]) {
			saveGate = deferred(); store.schedule('a', 'Submitted');
			const saving = alreadySaving ? flush('a') : null;
			await settle();
			const submitted = store.captureSubmission('a', 'Submitted');
			const pendingSave = saving ?? flush('a'); await settle();
			saveGate.resolve(); await pendingSave;
			await store.syncReload('a');
			store.clear('a', submitted); await settle();
			expect(disk.has('a')).toBe(false);
		}
	});

	test('a sync after submission cannot authorize deleting a newer remote draft, even with equal text', async () => {
		for (const text of ['New text from B', 'Submitted']) {
			store.schedule('a', 'Submitted'); await flush('a');
			const submitted = store.captureSubmission('a', 'Submitted');
			const second = new InputDraftStore(); second.schedule('a', text);
			await (second as unknown as { writer: DebouncedWriter }).writer.flush('a');
			const remoteRevision = revisions.get('a');
			await store.syncReload('a');
			store.clear('a', submitted); await settle();
			expect(disk.get('a')).toBe(text); expect(revisions.get('a')).toBe(remoteRevision);
			expect(store.remote?.content).toBe(text); expect(store.isCurrent(store.remote!)).toBe(true);
		}
	});

	test('a sync after submitting a restored draft cannot replace its cleanup revision', async () => {
		const submitted = store.captureSubmission('a', 'sent text');
		const second = new InputDraftStore(); second.schedule('a', 'sent text');
		await (second as unknown as { writer: DebouncedWriter }).writer.flush('a');
		const remoteRevision = revisions.get('a');
		await store.syncReload('a'); store.clear('a', submitted); await settle();
		expect(revisions.get('a')).toBe(remoteRevision); expect(disk.get('a')).toBe('sent text');
	});

	test('a remote draft adopted before submission can be cleared after an earlier local save', async () => {
		store.schedule('a', 'Old local draft'); await flush('a');
		const second = new InputDraftStore(); second.schedule('a', 'Adopted remote draft');
		await (second as unknown as { writer: DebouncedWriter }).writer.flush('a');
		await store.syncReload('a');
		const submitted = store.captureSubmission('a', store.remote!.content);
		await store.syncReload('a'); store.clear('a', submitted); await settle();
		expect(disk.has('a')).toBe(false);
	});

	test('new local edits invalidate a submission even if their final text is identical', async () => {
		store.schedule('a', 'Submitted'); await flush('a');
		const submitted = store.captureSubmission('a', 'Submitted');
		store.schedule('a', 'Other text'); store.schedule('a', 'Submitted');
		await store.syncReload('a'); store.clear('a', submitted); await flush('a');
		expect(disk.get('a')).toBe('Submitted'); expect(calls).not.toContain('delete:a');
	});

	test('a send acknowledgement cannot erase another device’s newer draft, even with equal text', async () => {
		for (const text of ['New text from B', 'Submitted']) {
			store.schedule('a', 'Submitted'); await flush('a'); const submitted = store.captureSubmission('a', 'Submitted');
			const second = new InputDraftStore(); second.schedule('a', text);
			await (second as unknown as { writer: DebouncedWriter }).writer.flush('a');
			store.clear('a', submitted); await settle();
			expect(disk.get('a')).toBe(text); expect(store.remote?.content).toBe(text);
		}
	});

	test('cleanup waits for its own save acknowledgement without adopting a newer remote revision', async () => {
		saveGate = deferred(); deleteGate = deferred(); store.schedule('a', 'Submitted');
		const saving = flush('a'); await settle(); store.clear('a');
		saveGate.resolve(); await saving;
		await settle();
		const second = new InputDraftStore(); second.schedule('a', 'Remote after our save');
		await (second as unknown as { writer: DebouncedWriter }).writer.flush('a');
		deleteGate.resolve(); await settle();
		expect(disk.get('a')).toBe('Remote after our save');
		expect(store.remote?.content).toBe('Remote after our save');
	});

	test('an unknown draft is preserved rather than cleared without a server revision', async () => {
		const unloaded = new InputDraftStore(); unloaded.clear('a'); await settle();
		expect(disk.get('a')).toBe('sent text'); expect(unloaded.remote?.content).toBe('sent text');
	});

	test('a remote snapshot ignored by the focused composer cannot become the submitted draft', async () => {
		store.schedule('a', 'Local text'); await flush('a');
		const second = new InputDraftStore(); second.schedule('a', 'Remote text');
		await (second as unknown as { writer: DebouncedWriter }).writer.flush('a');
		await store.syncReload('a');
		// InputArea keeps its local text while focused. A later send must not clear the
		// different server snapshot just because a sync read observed its revision.
		store.clear('a', store.captureSubmission('a', 'Local text')); await settle();
		expect(disk.get('a')).toBe('Remote text');
	});

	test('does not restore drafts when saving drafts is disabled', async () => {
		const draft = await store.load('a');
		settings.saveDrafts = false;
		expect(store.isCurrent(draft!)).toBe(false);
		expect(await store.load('a')).toBeNull();
		await store.syncReload('a');
		expect(store.remote).toBeNull();
	});
});
