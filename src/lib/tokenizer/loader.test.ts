import { expect, test } from 'bun:test';
import { createEncodingLoader, TokenizerLoading, withTokenizers } from './loader';

test('creating the loader imports nothing; a first read loads only the requested vocabulary once', async () => {
	const calls: string[] = [];
	let finish!: (value: { countTokens: (text: string) => number }) => void;
	const loader = createEncodingLoader({
		cl100k_base: () => { calls.push('cl'); return new Promise(resolve => { finish = resolve; }); },
		o200k_base: async () => { calls.push('o'); return { countTokens: () => 2 }; }
	});
	expect(calls).toEqual([]);
	let first!: TokenizerLoading;
	try { loader.read('cl100k_base'); } catch (error) { first = error as TokenizerLoading; }
	expect(first).toBeInstanceOf(TokenizerLoading);
	let second!: TokenizerLoading;
	try { loader.read('cl100k_base'); } catch (error) { second = error as TokenizerLoading; }
	expect(second.ready).toBe(first.ready);
	await Promise.resolve();
	expect(calls).toEqual(['cl']);
	finish({ countTokens: text => text.length });
	await first.ready;
	expect(loader.read('cl100k_base')('abc')).toBe(3);
	await loader.load('cl100k_base');
	expect(calls).toEqual(['cl']);
});

test('mixed-model calculations await each missing vocabulary instead of accepting partial counts', async () => {
	const calls: string[] = [];
	const loader = createEncodingLoader({
		cl100k_base: async () => { calls.push('cl'); return { countTokens: () => 7 }; },
		o200k_base: async () => { calls.push('o'); return { countTokens: () => 11 }; }
	});
	expect(await withTokenizers(() => loader.read('cl100k_base')('text') + loader.read('o200k_base')('text'))).toBe(18);
	expect(calls).toEqual(['cl', 'o']);
	expect(await withTokenizers(() => loader.read('o200k_base')('again'))).toBe(11);
	expect(calls).toEqual(['cl', 'o']);
});

test('failed imports propagate to actions, allow retry and never notify readiness prematurely', async () => {
	let attempts = 0, notifications = 0;
	const loader = createEncodingLoader({
		cl100k_base: async () => { throw new Error('unused'); },
		o200k_base: async () => { if (++attempts === 1) throw new Error('offline'); return { countTokens: () => 42 }; }
	});
	const stop = loader.subscribe(() => { notifications++; });
	await expect(withTokenizers(() => loader.read('o200k_base')('text'))).rejects.toThrow('offline');
	expect(notifications).toBe(0);
	expect(await withTokenizers(() => loader.read('o200k_base')('text'))).toBe(42);
	expect(attempts).toBe(2);
	expect(notifications).toBe(1);
	stop();
	await expect(withTokenizers(() => { throw new Error('ordinary calculation error'); })).rejects.toThrow('ordinary calculation error');
});
