import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { createEmptyLorebook } from '#lib/lorebook/types.ts';
import { createSteeringNote } from '#lib/types/steering.ts';
import { createEmptyPersona, type LibraryEntry } from '#lib/types/library.ts';
import { imageService } from '#lib/services/imageService.ts';

const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity, snapshot: structuredClone });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
const realDb = { ...await import('#lib/services/database.ts') };
afterAll(() => { mock.module('#lib/services/database.ts', () => realDb); });
let reads: { kind: string; resolve: (rows: any[]) => void }[] = [];
let writes: string[] = [];
let refuseDelete = false;
mock.module('#lib/services/database.ts', () => ({ ...realDb, db: new Proxy({}, { get: (_, method: string) => {
	if (['getAllLorebooks', 'getAllSteeringNotes', 'getAllLibraryEntries'].includes(method)) return () => new Promise(resolve => reads.push({ kind: method, resolve }));
	if (method === 'getAllCharacterVersions') return async () => [];
	if (method === 'getAllChats') return async () => [];
	return async () => { writes.push(method); if (method === 'deleteLibraryEntry' && refuseDelete) throw new Error('Last persona'); };
} }) }));
const { lorebookStore } = await import('#lib/lorebook/store.svelte.ts');
const { steeringStore } = await import('./steering.svelte');
const { characterLibraryStore } = await import('./characterLibrary.svelte');
const instantiate = <T extends object>(store: T): T => new (store.constructor as { new(): T })();
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => { reads = []; writes = []; refuseDelete = false; });

for (const kind of ['lorebook', 'steering', 'library'] as const) {
	function fixture() {
		if (kind === 'lorebook') {
			const store = instantiate(lorebookStore), row = createEmptyLorebook('Original');
			(store as any)._books = [row];
			return { refresh: () => store.refresh(), edit: () => store.updateBookMeta(row.id, { name: 'Local' }),
				flush: () => store.flush(), rows: () => store.books, row, label: (value: any) => value.name };
		}
		if (kind === 'steering') {
			const store = instantiate(steeringStore), row = createSteeringNote({ text: 'Original', scope: 'global', scopeId: null });
			(store as any)._notes = [row];
			return { refresh: () => store.refresh(), edit: () => store.scheduleEdit(row.id, { text: 'Local' }),
				flush: () => store.flush(), rows: () => store.notes, row, label: (value: any) => value.text };
		}
		const store = instantiate(characterLibraryStore), seed = createEmptyPersona();
		const row: LibraryEntry = { id: seed.id, type: 'persona', identity: { name: 'Original' }, data: { traits: seed.traits }, isFavorite: false, createdAt: 1, updatedAt: 1 };
		(store as any)._entries = [row];
		return { refresh: () => store.refresh(), edit: () => store.scheduleIdentityEdit(row.id, { name: 'Local' }),
			flush: () => store.flushEntry(), rows: () => store.entries, row, label: (value: any) => value.identity.name };
	}

	test(`${kind} keeps an edit whose autosave completed during an older reload`, async () => {
		const f = fixture(), stale = structuredClone(f.row);
		const read = f.refresh(); await settle(); expect(reads).toHaveLength(1);
		f.edit(); await f.flush(); reads[0].resolve([stale]); await read;
		expect(f.label(f.rows()[0])).toBe('Local');
	});

	test(`${kind} accepts newer remote data even when that device's clock is behind`, async () => {
		const f = fixture(); f.row.updatedAt = Date.now() + 60_000;
		const incoming = { ...structuredClone(f.row), updatedAt: 1 };
		const read = f.refresh(); await settle(); reads[0].resolve([incoming]); await read;
		expect(f.rows()[0].updatedAt).toBe(1);
	});

	test(`${kind} ignores an older response that finishes after a newer reload`, async () => {
		const f = fixture(), stale = structuredClone(f.row);
		const a = f.refresh(); await settle(); const b = f.refresh(); await settle();
		reads[1].resolve([]); await b; reads[0].resolve([stale]); await a;
		expect(f.rows()).toEqual([]);
	});
}

test('a steering reload cannot resurrect a local deletion or discard a newly created note', async () => {
	const store = instantiate(steeringStore), old = createSteeringNote({ text: 'Old', scope: 'global', scopeId: null });
	(store as any)._notes = [old]; const read = store.refresh(); await settle();
	await store.remove(old.id); const added = await store.create({ text: 'New', scope: 'global', scopeId: null });
	reads[0].resolve([structuredClone(old)]); await read; expect(store.notes.map(row => row.id)).toEqual([added.id]);
});

test('a lorebook reload cannot resurrect a local deletion or discard a newly created book', async () => {
	const store = instantiate(lorebookStore), old = createEmptyLorebook('Old');
	(store as any)._books = [old]; const read = store.refresh(); await settle();
	await store.deleteBook(old.id); const added = await store.createBook('New');
	reads[0].resolve([structuredClone(old)]); await read; expect(store.books.map(row => row.id)).toEqual([added.id]);
});

for (const active of [[false, false], [true, true]]) {
	test(`malformed character versions (${active.join(', ')}) fail before any import write or upload`, async () => {
		const store = instantiate(characterLibraryStore), character = createEmptyPersona();
		const upload = spyOn(imageService, 'saveImage').mockResolvedValue('images/characters/import.png');
		try {
			await expect(store.importFromSillyTavern({ character, entryType: 'character',
				imageFile: new File(['portrait'], 'portrait.png'), lorebook: null,
				versions: active.map((flag, i) => ({ name: `Version ${i}`, data: { traits: character.traits }, active: flag }))
			})).rejects.toThrow('exactly one active');
			expect(upload).not.toHaveBeenCalled(); expect(writes).toEqual([]); expect(store.entries).toEqual([]);
		} finally { upload.mockRestore(); }
	});
}

test('a refused bulk library deletion keeps the entry and its portrait', async () => {
	const store = instantiate(characterLibraryStore), seed = createEmptyPersona();
	const row: LibraryEntry = { id: seed.id, type: 'persona', identity: { name: 'Last persona', imageUrl: 'images/personas/keep.png' }, data: { traits: seed.traits }, isFavorite: false, createdAt: 1, updatedAt: 1 };
	(store as any)._entries = [row]; refuseDelete = true;
	const remove = spyOn(imageService, 'deleteImage').mockResolvedValue();
	try {
		await expect(store.deleteEntries([row.id])).rejects.toThrow('Last persona');
		expect(remove).not.toHaveBeenCalled(); expect(store.entries).toEqual([row]);
	} finally { remove.mockRestore(); }
});
