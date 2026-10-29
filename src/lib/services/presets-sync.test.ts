import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { PromptItem, PromptPreset } from '#lib/types/database.ts';

const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity, snapshot: structuredClone });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
const realTransport = { ...await import('./transport') };
const realDatabase = { ...await import('./database') };
afterAll(() => {
	mock.module('#lib/services/transport.ts', () => realTransport);
	mock.module('#lib/services/database.ts', () => realDatabase);
});

type DiskPreset = Omit<PromptPreset, 'items'> & { items: (Omit<PromptItem, 'id'> & { id?: string })[] };
type Snapshot = { presets: DiskPreset[]; drafts: DiskPreset[] };
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
const disk = (id = 'p'): DiskPreset => ({
	id, name: id, items: [
		{ name: 'System', role: 'system', content: 'Write a story.', enabled: true },
		{ name: 'History', role: 'user', content: '{{chatHistory}}', enabled: true }
	], controls: [{ id: 'tone', macro: 'tone', label: 'Tone', type: 'select', options: [{ id: 'warm', label: 'Warm', injectedText: 'Warmly' }] }]
});
let snapshot: Snapshot;
let read: ReturnType<typeof deferred<Snapshot>> | null;
let cleanup: ReturnType<typeof deferred<void>> | null;
let saving: ReturnType<typeof deferred<void>> | null;
let writes: { path: string; method: string; body: any }[];
mock.module('#lib/services/transport.ts', () => ({
	...realTransport,
	getClientId: () => 'test-client',
	apiGet: async () => read ? read.promise : structuredClone(snapshot),
	apiSend: async (path: string, method: string, body: unknown) => {
		writes.push({ path, method, body: structuredClone(body) });
		if (method === 'DELETE' && path.endsWith('/draft')) await cleanup?.promise;
		if (method === 'PUT') await saving?.promise;
		return {};
	}
}));
mock.module('#lib/services/database.ts', () => ({
	...realDatabase, db: { ...realDatabase.db, getSetting: async () => 'p', setSetting: async () => {} }
}));
const { PresetService, clonePreset } = await import('./presets.svelte');
let service: InstanceType<typeof PresetService>;
beforeEach(() => {
	snapshot = { presets: [disk()], drafts: [] }; read = null; cleanup = null; saving = null; writes = [];
	service = new PresetService();
});

describe('preset refresh preserves editor identity', () => {
	test('legacy notes do not create drafts, refresh the editor or survive normal writes', async () => {
		snapshot.presets[0].items = snapshot.presets[0].items.map(item => ({ ...item, note: 'Old annotation' }));
		snapshot.drafts = [structuredClone(snapshot.presets[0])];
		Object.assign(snapshot.drafts[0].items[0], { note: 'Different annotation' });
		await service.initialize(); const before = service.getEffective('p')!;
		expect(before.items.every(item => !('note' in item))).toBe(true);
		expect(service.hasDraft('p')).toBe(false); expect(writes).toEqual([]);
		Object.assign(snapshot.presets[0].items[0], { note: 'Remote annotation change' });
		await service.syncReload();
		expect(service.getEffective('p')).toBe(before); expect(service.getContentVersion()).toBe(0);
		expect(writes).toEqual([]);
		const legacy = { ...before, items: before.items.map(item => ({ ...item, note: 'Stale annotation' })) };
		expect(clonePreset(legacy).items.every(item => !('note' in item))).toBe(true);
		legacy.items[0].content = 'Revised instructions'; await service.saveDraft(legacy);
		expect(writes[0].body.items.every((item: object) => !('note' in item))).toBe(true);
		expect(writes[0].body.items.map((item: PromptItem) => item.id)).toEqual(before.items.map(item => item.id));
	});
	test('legacy unnamed items keep their IDs across reorder and annotation changes', async () => {
		snapshot.presets[0].items = snapshot.presets[0].items.map(item => ({ ...item, name: '', note: 'Old annotation' }));
		await service.initialize(); const [system, history] = service.getEffective('p')!.items;
		snapshot.presets[0].items = snapshot.presets[0].items.toReversed().map(item => ({ ...item, note: 'Changed annotation' }));
		await service.syncReload();
		expect(service.getEffective('p')!.items.map(item => item.id)).toEqual([history.id, system.id]);
		expect(writes).toEqual([]);
	});

	test('unchanged legacy presets retain objects, item IDs and editor version without writing files', async () => {
		await service.initialize(); const before = service.getEffective('p')!;
		const ids = before.items.map(item => item.id);
		await service.syncReload(); await service.syncReload();
		expect(service.getEffective('p')).toBe(before);
		expect(service.getEffective('p')!.items.map(item => item.id)).toEqual(ids);
		expect(service.getContentVersion()).toBe(0); expect(writes).toEqual([]);
	});
	test('updates to a different preset do not replace the active editor', async () => {
		snapshot.presets.push(disk('other')); await service.initialize(); const before = service.getEffective('p');
		snapshot.presets[1].name = 'Changed elsewhere'; await service.syncReload();
		expect(service.getEffective('p')).toBe(before); expect(service.getContentVersion()).toBe(0);
		expect(service.getEffective('other')!.name).toBe('Changed elsewhere');
	});
	test('legacy reorder, insertion and text edits preserve IDs of the existing named rows', async () => {
		await service.initialize(); const [system, history] = service.getEffective('p')!.items;
		snapshot.presets[0].items = [
			snapshot.presets[0].items[1],
			{ name: 'New item', role: 'system', content: 'Extra', enabled: true },
			{ ...snapshot.presets[0].items[0], content: 'Revised instructions', role: 'assistant' }
		];
		await service.syncReload(); const next = service.getEffective('p')!.items;
		expect(next[0].id).toBe(history.id); expect(next[2].id).toBe(system.id);
		expect([system.id, history.id]).not.toContain(next[1].id); expect(next[2].content).toBe('Revised instructions');
		expect(service.getContentVersion()).toBe(1);
	});
	test('draft and committed writes retain item IDs across another client and save', async () => {
		await service.initialize(); const edit = clonePreset(service.getEffective('p')!);
		edit.items[0].content = 'Draft instructions'; await service.saveDraft(edit);
		expect(writes[0].body.items.map((item: PromptItem) => item.id)).toEqual(edit.items.map(item => item.id));
		snapshot.drafts = [{ id: 'p', ...writes[0].body }];
		const otherClient = new PresetService(); await otherClient.initialize();
		expect(otherClient.getEffective('p')!.items.map(item => item.id)).toEqual(edit.items.map(item => item.id));
		const before = otherClient.getEffective('p'); await otherClient.syncReload();
		expect(otherClient.getEffective('p')).toBe(before); expect(otherClient.getContentVersion()).toBe(0);
		await otherClient.commitDraft('p');
		const saved = writes.findLast(write => write.path === '/api/presets/p' && write.method === 'PUT')!;
		expect(saved.body.items.map((item: PromptItem) => item.id)).toEqual(edit.items.map(item => item.id));
		snapshot = { presets: [{ id: 'p', ...saved.body }], drafts: [] };
		await otherClient.syncReload();
		expect(otherClient.getEffective('p')!.items.map(item => item.id)).toEqual(edit.items.map(item => item.id));
	});
	test('stored IDs survive remote renames, text changes, insertion, removal and reorder', async () => {
		snapshot.presets[0].items = snapshot.presets[0].items.map((item, index) => ({ ...item, id: `item-${index}` }));
		await service.initialize();
		snapshot.presets[0].items = [
			{ ...snapshot.presets[0].items[1], name: 'Renamed', content: 'Changed elsewhere', role: 'assistant' },
			{ id: 'new-row', name: '', content: 'Inserted', role: 'system', enabled: true }
		];
		await service.syncReload();
		expect(service.getEffective('p')!.items.map(item => item.id)).toEqual(['item-1', 'new-row']);
		expect(service.getEffective('p')!.items[0].name).toBe('Renamed'); expect(service.getContentVersion()).toBe(1);
	});
	test('a committed update under an unchanged draft does not replace the effective editor', async () => {
		snapshot.drafts = [{ ...disk(), name: 'Draft' }]; await service.initialize();
		const before = service.getEffective('p'); snapshot.presets[0].name = 'Committed elsewhere';
		await service.syncReload();
		expect(service.getEffective('p')).toBe(before); expect(service.getContentVersion()).toBe(0);
		expect(service.getCommitted('p')!.name).toBe('Committed elsewhere');
	});
	test('identity alone never creates an unsaved draft or changes control/option IDs', async () => {
		await service.initialize(); const edit = clonePreset(service.getEffective('p')!);
		edit.items = edit.items.map(item => ({ ...item, id: crypto.randomUUID() })); await service.saveDraft(edit);
		expect(service.hasDraft('p')).toBe(false); expect(writes).toEqual([]);
		expect(service.getEffective('p')!.controls[0].id).toBe('tone');
		expect(service.getEffective('p')!.controls[0].options![0].id).toBe('warm');
	});
	test('duplicate and import renew item IDs while public exports keep their existing format', async () => {
		await service.initialize(); const original = service.getEffective('p')!;
		const copy = await service.duplicatePreset('p', 'Copy');
		const exported = service.exportPresetJson('p'); const document = JSON.parse(exported);
		expect(document.items.every((item: object) => !('id' in item))).toBe(true);
		const imported = await service.importPresetJson(exported);
		for (const preset of [copy, imported]) {
			expect(preset.items.every(item => !original.items.some(old => old.id === item.id))).toBe(true);
			const stored = writes.find(write => write.path === `/api/presets/${preset.id}`)!.body;
			expect(stored.items.map((item: PromptItem) => item.id)).toEqual(preset.items.map(item => item.id));
		}
	});
	test('duplicate and empty stored IDs are repaired without producing duplicate row keys', async () => {
		snapshot.presets[0].items = [
			{ ...snapshot.presets[0].items[0], id: 'shared' },
			{ ...snapshot.presets[0].items[1], id: 'shared' },
			{ ...snapshot.presets[0].items[0], id: '' }
		];
		await service.initialize(); const before = service.getEffective('p')!;
		expect(before.items[0].id).toBe('shared'); expect(new Set(before.items.map(item => item.id)).size).toBe(3);
		expect(before.items.every(item => item.id.trim())).toBe(true);
		await service.syncReload(); expect(service.getEffective('p')).toBe(before);
	});
	test('a failed fetch retains the active draft and editor version', async () => {
		await service.initialize(); const edit = clonePreset(service.getEffective('p')!); edit.name = 'Local draft';
		await service.saveDraft(edit); const before = service.getEffective('p'); read = deferred();
		const refresh = service.syncReload(); read.reject(new Error('Offline'));
		await expect(refresh).rejects.toThrow('Offline');
		expect(service.getEffective('p')).toBe(before); expect(service.hasDraft('p')).toBe(true); expect(service.getContentVersion()).toBe(0);
	});
	test('redundant drafts are ignored without deleting files during a read', async () => {
		snapshot.presets.push(disk('other')); await service.initialize();
		snapshot.presets = [{ ...disk(), name: 'Remote replacement' }]; snapshot.drafts = [structuredClone(snapshot.presets[0])];
		await service.syncReload();
		expect(writes).toEqual([]); expect(service.hasDraft('p')).toBe(false);
		expect(service.getEffective('p')!.name).toBe('Remote replacement'); expect(service.getEffective('other')).toBeNull();
		expect(service.getContentVersion()).toBe(1);
	});
	test('a local edit during a refresh wins over stale data and is never deleted as a phantom draft', async () => {
		await service.initialize(); read = deferred(); const refresh = service.syncReload();
		const edit = clonePreset(service.getEffective('p')!); edit.items[0].content = 'Still typing'; await service.saveDraft(edit);
		const before = service.getEffective('p');
		read.resolve({ presets: [disk()], drafts: [disk()] }); await refresh;
		expect(service.getEffective('p')).toBe(before); expect(service.getEffective('p')!.items[0].content).toBe('Still typing');
		expect(service.getContentVersion()).toBe(0); expect(writes.some(write => write.method === 'DELETE')).toBe(false);
	});
	test('a refresh cannot resurrect a locally deleted preset or drop a newly created one', async () => {
		snapshot.presets.push(disk('other')); await service.initialize(); read = deferred(); const refresh = service.syncReload();
		await service.deletePreset('other'); const created = await service.createPreset('New');
		read.resolve(structuredClone(snapshot)); await refresh;
		expect(service.getEffective('other')).toBeNull(); expect(service.getEffective(created.id)).toBe(created);
	});
	test('an older response cannot replace a newer snapshot, even if the newer read was unchanged', async () => {
		await service.initialize(); const before = service.getEffective('p');
		const olderRead = deferred<Snapshot>(); read = olderRead; const older = service.syncReload();
		read = deferred(); const newer = service.syncReload(); read.resolve(structuredClone(snapshot)); await newer;
		olderRead.resolve({ presets: [{ ...disk(), name: 'Stale' }], drafts: [] }); await older;
		expect(service.getEffective('p')).toBe(before); expect(service.getContentVersion()).toBe(0);
	});
	test('a refresh started after a draft upload begins still retains the pending local edit', async () => {
		await service.initialize(); saving = deferred();
		const edit = clonePreset(service.getEffective('p')!); edit.name = 'Upload pending';
		const upload = service.saveDraft(edit); const before = service.getEffective('p');
		await service.syncReload(); const after = service.getEffective('p');
		saving.resolve(); await upload;
		expect(after).toBe(before); expect(service.hasDraft('p')).toBe(true);
	});
	test('an upload finishing during a read cannot let its stale snapshot discard the draft', async () => {
		await service.initialize(); saving = deferred();
		const edit = clonePreset(service.getEffective('p')!); edit.name = 'Just uploaded';
		const upload = service.saveDraft(edit); const before = service.getEffective('p');
		read = deferred(); const refresh = service.syncReload(); saving.resolve(); await upload;
		read.resolve(structuredClone(snapshot)); await refresh;
		expect(service.getEffective('p')).toBe(before); expect(service.hasDraft('p')).toBe(true);
		expect(service.getContentVersion()).toBe(0);
	});
	test('a refresh cannot restore a discarded draft while its delete is still in flight', async () => {
		await service.initialize(); const edit = clonePreset(service.getEffective('p')!); edit.name = 'Old draft';
		await service.saveDraft(edit); snapshot.drafts = [{ id: 'p', ...writes[0].body }];
		cleanup = deferred(); const discard = service.discardDraft('p'); await service.syncReload();
		const hasDraft = service.hasDraft('p'); cleanup.resolve(); await discard;
		expect(hasDraft).toBe(false); expect(service.getEffective('p')!.name).toBe('p');
	});
});
