import { expect, test } from 'bun:test';
import { lazyModule } from './lazy-module';

test('concurrent consumers and later visits share the same module', async () => {
	let calls = 0;
	const module = { default: 'panel' };
	const load = lazyModule(async () => { calls++; return module; });
	const first = load();
	expect(load()).toBe(first);
	expect(await first).toBe(module);
	expect(await load()).toBe(module);
	expect(calls).toBe(1);
});

test('a failed load can be retried, including synchronous failures', async () => {
	let calls = 0;
	const load = lazyModule(() => {
		if (++calls === 1) throw new Error('offline');
		return Promise.resolve('ready');
	});
	await expect(load()).rejects.toThrow('offline');
	expect(await load()).toBe('ready');
	expect(calls).toBe(2);
});
