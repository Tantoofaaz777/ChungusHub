import { expect, test } from 'bun:test';
import { EditorRpc } from './editor-rpc';
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>(yes => { resolve = yes; });
	return { promise, resolve };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('a refresh waits for a discrete save already in flight, even without an autosave timer', async () => {
	const gate = deferred(); let disk = 'old';
	const rpc = new EditorRpc(async method => {
		if (method === 'updateSteeringNote') { await gate.promise; disk = 'new'; }
		else if (method === 'getAllSteeringNotes') return disk;
	});
	const save = rpc.call('updateSteeringNote', [{ id: 'a' }]);
	let shown = ''; const read = rpc.call<string>('getAllSteeringNotes', []).then(value => { shown = value; });
	await settle(); expect(shown).toBe(''); gate.resolve(); await Promise.all([save, read]); expect(shown).toBe('new');
});

test('queued editor updates use snapshots and a deletion cannot be overtaken by an earlier save', async () => {
	const gate = deferred(), calls: string[] = [];
	const rpc = new EditorRpc(async (method, args) => {
		calls.push(`${method}:${(args[0] as any).text ?? args[0]}`);
		if (calls.length === 1) await gate.promise;
	});
	const row = { id: 'a', text: 'first' };
	const a = rpc.call('updateSteeringNote', [row]); row.text = 'last';
	const b = rpc.call('updateSteeringNote', [row]); const del = rpc.call('deleteSteeringNote', ['a']);
	await settle(); expect(calls).toEqual(['updateSteeringNote:first']);
	gate.resolve(); await Promise.all([a, b, del]);
	expect(calls).toEqual(['updateSteeringNote:first', 'updateSteeringNote:last', 'deleteSteeringNote:a']);
});

test('unrelated rows and scopes remain independent and a failed save permits retry', async () => {
	const gate = deferred(), calls: string[] = [];
	const rpc = new EditorRpc(async (method, args) => {
		calls.push(method);
		if ((args[0] as any)?.id === 'a') { await gate.promise; throw new Error('offline'); }
	});
	const failed = rpc.call('updateLorebook', [{ id: 'a' }]).catch(error => error);
	await rpc.call('updateLorebook', [{ id: 'b' }]); await rpc.call('getAllSteeringNotes', []);
	expect(calls).toEqual(['updateLorebook', 'updateLorebook', 'getAllSteeringNotes']);
	gate.resolve(); expect(await failed).toEqual(new Error('offline'));
	await rpc.call('deleteLorebook', ['a']); expect(calls.at(-1)).toBe('deleteLorebook');
});

test('clearing history cannot be overtaken by a pending append from another chat', async () => {
	const gate = deferred(), disk: string[] = [];
	const rpc = new EditorRpc(async (method, args) => {
		if (method === 'addInputHistory') { await gate.promise; disk.push(String(args[1])); }
		if (method === 'clearInputHistory') disk.length = 0;
		if (method === 'getInputHistory') return [...disk];
	});
	const add = rpc.call('addInputHistory', ['chat', 'sent text', 100]);
	const clear = rpc.call('clearInputHistory', []), read = rpc.call('getInputHistory', [100]);
	gate.resolve(); await Promise.all([add, clear]); expect(await read).toEqual([]);
});
