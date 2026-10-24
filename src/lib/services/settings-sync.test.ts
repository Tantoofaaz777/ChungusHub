import { expect, test } from 'bun:test';
import { SettingsSync } from './settings-sync';

function deferred<T = void>() {
	let resolve!: (value: T) => void, reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('setting writes keep invocation order while unrelated keys remain independent', async () => {
	const sync = new SettingsSync(), gate = deferred(), calls: string[] = [];
	const a = sync.write('theme', async () => { calls.push('first'); await gate.promise; });
	const b = sync.write('theme', async () => { calls.push('last'); });
	await sync.write('persona', async () => { calls.push('persona'); });
	expect(calls).toEqual(['first', 'persona']);
	gate.resolve(); await Promise.all([a, b]);
	expect(calls).toEqual(['first', 'persona', 'last']);
});

test('a failed setting save does not block the next save', async () => {
	const sync = new SettingsSync(), gate = deferred(); let saved = false;
	const a = sync.write('key', () => gate.promise);
	const rejected = a.catch(error => error);
	const b = sync.write('key', async () => { saved = true; });
	await settle(); gate.reject(new Error('offline')); expect(await rejected).toEqual(new Error('offline')); await b;
	expect(saved).toBe(true);
});

test('a reload waits for a save already in flight before reading the server', async () => {
	const sync = new SettingsSync(), gate = deferred(); let disk = 'old', state = '';
	const write = sync.write('key', async () => { await gate.promise; disk = 'new'; });
	const read = sync.reload(['key'], async () => disk, value => { state = value; });
	await settle(); expect(state).toBe('');
	gate.resolve(); await Promise.all([write, read]); expect(state).toBe('new');
});

test('direct prompt reads also wait for the latest queued control-value save', async () => {
	const sync = new SettingsSync(), gate = deferred(); let disk = 'old';
	const a = sync.write('controls', async () => { await gate.promise; disk = 'first'; });
	const b = sync.write('controls', async () => { disk = 'latest'; });
	const read = sync.read('controls', async () => disk);
	gate.resolve(); await Promise.all([a, b]); expect(await read).toBe('latest');
});

test('a read cannot undo an edit even when its save completed before the response', async () => {
	const sync = new SettingsSync(), gate = deferred<string>(); let state = 'old';
	const read = sync.reload(['key'], () => gate.promise, value => { state = value; });
	state = 'new'; await sync.write('key', async () => {});
	gate.resolve('old'); await read; expect(state).toBe('new');
});

test('an edit awaiting its debounce timer invalidates an older read too', async () => {
	const sync = new SettingsSync(), gate = deferred<string>(); let state = 'new';
	const read = sync.reload(['key'], () => gate.promise, value => { state = value; });
	sync.changed('key'); gate.resolve('old'); await read; expect(state).toBe('new');
});

test('newer reloads win when responses finish in reverse order', async () => {
	const sync = new SettingsSync(), old = deferred<string>(), next = deferred<string>(); let state = '';
	const a = sync.reload(['key'], () => old.promise, value => { state = value; });
	const b = sync.reload(['key'], () => next.promise, value => { state = value; });
	next.resolve('latest'); await b; old.resolve('outdated'); await a; expect(state).toBe('latest');
});

test('related settings publish atomically and one edited key rejects the stale bundle', async () => {
	const sync = new SettingsSync(), gate = deferred<string>(); let state = 'local';
	const read = sync.reload(['connections', 'routing'], () => gate.promise, value => { state = value; });
	await sync.write('routing', async () => {});
	gate.resolve('old bundle'); await read; expect(state).toBe('local');
});

test('a failed reload cannot replace the last good state and a retry can succeed', async () => {
	const sync = new SettingsSync(); let state = 'good';
	await expect(sync.reload(['key'], async () => { throw new Error('offline'); }, value => { state = value; })).rejects.toThrow('offline');
	expect(state).toBe('good');
	await sync.reload(['key'], async () => 'reconnected', value => { state = value; }); expect(state).toBe('reconnected');
});
