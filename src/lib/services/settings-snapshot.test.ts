import { describe, expect, test } from 'bun:test';
import { SettingsSnapshot } from './settings-snapshot';

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => { resolve = yes; });
	return { promise, resolve };
}

describe('boot settings snapshot', () => {
	test('one bulk read serves dependent initializers, including absent keys; normal reads stay fresh', async () => {
		const snapshot = new SettingsSnapshot();
		let loads = 0, freshReads = 0;
		const fresh = async () => { freshReads++; return 'latest'; };
		expect(await snapshot.read('theme', fresh)).toBe('latest');
		await snapshot.run(async () => { loads++; return { theme: 'saved' }; }, async () => {
			expect(await snapshot.read('theme', fresh)).toBe('saved');
			expect(await snapshot.read('missing', fresh)).toBeNull();
			expect(await snapshot.read('theme', fresh)).toBe('saved');
		});
		expect(await snapshot.read('theme', fresh)).toBe('latest');
		expect(loads).toBe(1);
		expect(freshReads).toBe(2);
	});

	test('migrations that write or delete a key read the server again, without discarding unrelated rows', async () => {
		const snapshot = new SettingsSnapshot();
		let stored: string | null = 'old';
		await snapshot.run(async () => ({ active: 'old', other: 'unchanged' }), async () => {
			snapshot.invalidate('active');
			stored = 'migrated';
			expect(await snapshot.read('active', async () => stored)).toBe('migrated');
			stored = null;
			expect(await snapshot.read('active', async () => stored)).toBeNull();
			expect(await snapshot.read('other', async () => 'wrong')).toBe('unchanged');
		});
	});

	test('a write during the bulk read cannot be overwritten by its late response', async () => {
		const snapshot = new SettingsSnapshot(), loading = deferred<Record<string, string>>();
		const run = snapshot.run(() => loading.promise, async () => {
			expect(await snapshot.read('key', async () => 'committed')).toBe('committed');
			expect(await snapshot.read('other', async () => 'wrong')).toBe('saved');
		});
		snapshot.invalidate('key');
		loading.resolve({ key: 'before write', other: 'saved' });
		await run;
	});

	test('remote changes or reconnects invalidate the whole snapshot, even before its response arrives', async () => {
		const snapshot = new SettingsSnapshot(), loading = deferred<Record<string, string>>();
		const run = snapshot.run(() => loading.promise, async () => {
			expect(await snapshot.read('key', async () => 'remote')).toBe('remote');
			expect(await snapshot.read('missing', async () => 'added remotely')).toBe('added remotely');
		});
		snapshot.invalidate();
		loading.resolve({ key: 'stale' });
		await run;
	});

	test('failed initialization and failed loading both release the snapshot for a fresh retry', async () => {
		const snapshot = new SettingsSnapshot();
		await expect(snapshot.run(async () => ({ key: 'old' }), async () => { throw new Error('boot failed'); })).rejects.toThrow('boot failed');
		expect(await snapshot.read('key', async () => 'fresh')).toBe('fresh');
		await expect(snapshot.run(async () => { throw new Error('read failed'); }, async () => {})).rejects.toThrow('read failed');
		await snapshot.run(async () => ({ key: 'retry' }), async () => {
			expect(await snapshot.read('key', async () => 'wrong')).toBe('retry');
		});
	});

	test('overlapping scopes fail without clearing the current scope', async () => {
		const snapshot = new SettingsSnapshot();
		await snapshot.run(async () => ({ key: 'outer' }), async () => {
			await expect(snapshot.run(async () => ({}), async () => {})).rejects.toThrow('already active');
			expect(await snapshot.read('key', async () => 'wrong')).toBe('outer');
		});
	});

	test('raw empty strings, JSON null and object-like keys retain their meaning', async () => {
		const snapshot = new SettingsSnapshot();
		await snapshot.run(async () => JSON.parse('{"empty":"","json":"null","__proto__":"value"}'), async () => {
			const fresh = async () => 'wrong';
			expect(await snapshot.read('empty', fresh)).toBe('');
			expect(await snapshot.read('json', fresh)).toBe('null');
			expect(await snapshot.read('__proto__', fresh)).toBe('value');
			expect(await snapshot.read('constructor', fresh)).toBeNull();
		});
	});
});
