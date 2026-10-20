import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { MemoryScene } from '$shared/memory-scenes';

// Test read ordering and retained data; Svelte compiles runes in the app build.
const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity, snapshot: structuredClone });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
const realDatabase = { ...await import('$lib/services/database') };
afterAll(() => { mock.module('$lib/services/database', () => realDatabase); });

let reads: { chatId: string; resolve: (scenes: MemoryScene[]) => void; reject: (error: Error) => void }[] = [];
mock.module('$lib/services/database', () => ({ ...realDatabase, db: {
	...realDatabase.db,
	getMemoryScenes: (chatId: string) => new Promise<MemoryScene[]>((resolve, reject) => reads.push({ chatId, resolve, reject })),
	deleteMemoryScene: async () => {},
	saveMemoryScene: async (input: Partial<MemoryScene> & { expectedRevision?: number }) => ({ ...chapter(), ...input, id: input.id ?? 'new-chapter', revision: (input.expectedRevision ?? 0) + 1 })
} }));
const { SceneMemoryStore } = await import('./scene-store.svelte');
let store: InstanceType<typeof SceneMemoryStore>;
beforeEach(() => { reads = []; store = new SceneMemoryStore(); });
const chapter = (chatId = 'a'): MemoryScene => ({
	id: `chapter-${chatId}`, chatId, title: 'A chapter', content: 'Saved summary', source: [],
	createdAt: 1, updatedAt: 1, revision: 1, reviewReason: null
});
async function open() {
	const opening = store.loadForChat('a');
	reads.shift()!.resolve([chapter()]); await opening;
}

describe('memory refresh lifecycle', () => {
	test('first load waits for data, while refreshes retain loaded chapters and local work', async () => {
		const opening = store.loadForChat('a');
		expect(store.loaded).toBe(false); expect(store.refreshing).toBe(false);
		reads.shift()!.resolve([chapter()]); await opening;
		store.selection = { chatId: 'a', startId: 'message', endId: null };
		store.compaction = { level: 'arc', ids: ['chapter-a'] };
		const refresh = store.syncReload();
		expect(store.loaded).toBe(true); expect(store.refreshing).toBe(true); expect(store.scenes).toEqual([chapter()]);
		expect(store.selection?.startId).toBe('message'); expect(store.compaction?.ids).toEqual(['chapter-a']);
		reads.shift()!.resolve([{ ...chapter(), content: 'Updated summary', revision: 2 }]); await refresh;
		expect(store.loaded).toBe(true); expect(store.refreshing).toBe(false); expect(store.scenes[0].content).toBe('Updated summary');
		expect(store.selection?.startId).toBe('message'); expect(store.compaction?.ids).toEqual(['chapter-a']);
	});
	test('failed refreshes retain chapters and can be retried without hiding content', async () => {
		await open(); const refresh = store.syncReload();
		reads.shift()!.reject(new Error('Offline')); await expect(refresh).rejects.toThrow('Offline');
		expect(store.loaded).toBe(true); expect(store.refreshing).toBe(false); expect(store.scenes).toEqual([chapter()]); expect(store.loadError).toBe('Offline');
		const retry = store.syncReload(); expect(store.loaded).toBe(true); expect(store.loadError).toBe('');
		reads.shift()!.resolve([]); await retry;
		expect(store.loaded).toBe(true); expect(store.scenes).toEqual([]); expect(store.loadError).toBe('');
	});
	test('a failed first load remains unloaded until a retry succeeds', async () => {
		const opening = store.loadForChat('a'); reads.shift()!.reject(new Error('Offline'));
		await expect(opening).rejects.toThrow('Offline'); expect(store.loaded).toBe(false); expect(store.loadError).toBe('Offline');
		await open(); expect(store.loaded).toBe(true); expect(store.loadError).toBe('');
	});
	test('a stale refresh cannot undo a local chapter deletion or save', async () => {
		await open(); const refresh = store.syncReload();
		await store.removeScene(chapter());
		store.draft = { chatId: 'a', level: 'chapter', children: [], source: [], title: 'New', content: 'Saved now', phase: 'ready', error: '' };
		await store.saveDraft(); reads.shift()!.resolve([chapter()]); await refresh;
		expect(store.scenes.map(scene => scene.id)).toEqual(['new-chapter']); expect(store.scenes[0].content).toBe('Saved now');
	});
	test('concurrent edits retain a local save but still accept a higher server revision', async () => {
		for (const revision of [1, 3]) {
			await open(); const refresh = store.syncReload();
			store.draft = { chatId: 'a', sceneId: 'chapter-a', expectedRevision: 1, level: 'chapter', children: [], source: [], title: 'Edited', content: 'Local edit', phase: 'ready', error: '' };
			await store.saveDraft(); reads.shift()!.resolve([{ ...chapter(), revision, content: 'Remote edit' }]); await refresh;
			expect(store.scenes[0].revision).toBe(Math.max(2, revision));
			expect(store.scenes[0].content).toBe(revision > 2 ? 'Remote edit' : 'Local edit');
		}
	});
	test('switching chats clears old data and ignores a late refresh', async () => {
		await open(); store.selection = { chatId: 'a', startId: 'message', endId: null };
		const refresh = store.syncReload(), next = store.loadForChat('b');
		expect(store.activeChatId).toBe('b'); expect(store.loaded).toBe(false); expect(store.refreshing).toBe(false);
		expect(store.scenes).toEqual([]); expect(store.selection).toBeNull();
		reads[1].resolve([chapter('b')]); await next;
		reads[0].resolve([chapter()]); await refresh;
		expect(store.activeChatId).toBe('b'); expect(store.scenes).toEqual([chapter('b')]); expect(store.loaded).toBe(true);
	});
	test('an older failure cannot overwrite a newer refresh or reset its progress', async () => {
		await open(); const older = store.syncReload(), newer = store.syncReload();
		reads.shift()!.reject(new Error('Old failure')); await expect(older).rejects.toThrow('Old failure');
		expect(store.refreshing).toBe(true); expect(store.loadError).toBe('');
		reads.shift()!.resolve([chapter()]); await newer;
		expect(store.refreshing).toBe(false); expect(store.loaded).toBe(true);
	});
	test('clearing memory invalidates pending reads and errors', async () => {
		await open(); const refresh = store.syncReload(); store.clear();
		reads.shift()!.resolve([chapter()]); await refresh;
		expect(store.activeChatId).toBeNull(); expect(store.loaded).toBe(false); expect(store.refreshing).toBe(false);
		expect(store.scenes).toEqual([]); expect(store.loadError).toBe('');
	});
});
