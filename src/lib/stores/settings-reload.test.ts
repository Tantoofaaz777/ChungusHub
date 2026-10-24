import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity, snapshot: structuredClone });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
const realTransport = { ...await import('$lib/services/transport') };
afterAll(() => { mock.module('$lib/services/transport', () => realTransport); });
let reads: { key: string; resolve: (raw: string | null) => void; reject: (error: Error) => void }[] = [];
let writes: string[] = [];
mock.module('$lib/services/transport', () => ({ ...realTransport, dbRpc: async (method: string, args: unknown[]) => {
	if (method === 'getSetting') return new Promise((resolve, reject) => reads.push({ key: String(args[0]), resolve, reject }));
	if (method === 'setSetting') { writes.push(String(args[0])); return; }
	throw new Error(`Unexpected test RPC: ${method}`);
} }));
const { generalSettingsStore } = await import('./general-settings.svelte');
const { personaStore } = await import('./persona.svelte');
const { connectionStore } = await import('./connections.svelte');
const instantiate = <T extends object>(store: T): T => new (store.constructor as { new(): T })();
const settle = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
beforeEach(() => { reads = []; writes = []; });

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
