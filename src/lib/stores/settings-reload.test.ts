import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity, snapshot: structuredClone });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
const realTransport = { ...await import('#lib/services/transport.ts') };
afterAll(() => { mock.module('#lib/services/transport.ts', () => realTransport); });
let reads: { key: string; resolve: (raw: string | null) => void; reject: (error: Error) => void }[] = [];
let writes: string[] = [];
mock.module('#lib/services/transport.ts', () => ({ ...realTransport, dbRpc: async (method: string, args: unknown[]) => {
	if (method === 'getSetting') return new Promise((resolve, reject) => reads.push({ key: String(args[0]), resolve, reject }));
	if (method === 'setSetting') { writes.push(String(args[0])); return; }
	throw new Error(`Unexpected test RPC: ${method}`);
} }));
const { generalSettingsStore } = await import('./general-settings.svelte');
const { personaStore } = await import('./persona.svelte');
const { connectionStore } = await import('./connections.svelte');
const { libraryViewPrefs, personasViewPrefs } = await import('./browseViewPrefs.svelte');
const instantiate = <T extends object>(store: T): T => new (store.constructor as { new(): T })();
const settle = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
beforeEach(() => { reads = []; writes = []; });

test('character and persona preferences use two columns for old settings and restore saved column choices', async () => {
	for (const template of [libraryViewPrefs, personasViewPrefs]) {
		const store = Reflect.construct(template.constructor, ['grid-columns-test']) as typeof template;
		const legacy = store.syncReload();
		reads.shift()!.resolve(JSON.stringify({ viewMode: 'grid', cardSize: 5, sort: 'oldest', perPage: 25 }));
		await legacy;
		expect(store.gridColumns).toBe(2);
		expect(store.viewMode).toBe('grid');
		expect(store.sort).toBe('oldest');
		expect(store.perPage).toBe(25);
		const saved = store.syncReload();
		reads.shift()!.resolve(JSON.stringify({ viewMode: 'grid', gridColumns: 3 }));
		await saved;
		expect(store.gridColumns).toBe(3);
	}
});

test('a general-settings reload cannot undo a newly saved chat preference', async () => {
	const store = instantiate(generalSettingsStore), stale = JSON.stringify(store.settings);
	const read = store.syncReload(); store.setDoubleClickToEdit(true); await settle();
	expect(writes).toEqual(['generalSettings']); reads[0].resolve(stale); await read;
	expect(store.settings.doubleClickToEdit).toBe(true);
});

test('an active-persona reload cannot restore the previous selection after a save', async () => {
	const store = instantiate(personaStore); store.activeId = 'old';
	const read = store.syncReload(); store.setActive('new'); await settle();
	reads[0].resolve('old'); await read; expect(store.activeId).toBe('new');
});

test('a routing read failure cannot publish half of a connections snapshot', async () => {
	const store = instantiate(connectionStore);
	const initialConnections = store.connections, initialAssignments = store.assignments;
	const load = (store as any).load() as Promise<void>; const failed = load.catch(error => error);
	reads[0].resolve(JSON.stringify([{ id: 'remote', name: 'Remote' }])); await settle();
	expect(reads).toHaveLength(2); reads[1].reject(new Error('routing offline'));
	expect(await failed).toEqual(new Error('routing offline'));
	expect(store.connections).toBe(initialConnections); expect(store.assignments).toBe(initialAssignments);
});
