import { expect, test } from 'bun:test';
import { mapLimit } from './copy-batch';

test('copy failure waits for active workers and starts no more files before cleanup', async () => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const copied: number[] = [];
	const work = mapLimit([0, 1, 2, 3], 2, async value => {
		copied.push(value);
		if (value === 0) await gate;
		else throw new Error('disk failed');
	});
	let finished = false;
	const result = work.catch(error => { finished = true; return error; });
	for (let i = 0; i < 10; i++) await Promise.resolve();
	expect(finished).toBe(false); expect(copied).toEqual([0, 1]);
	release(); expect(await result).toEqual(new Error('disk failed'));
	expect(copied).toEqual([0, 1]);
});

test('copy batches respect their concurrency limit and include every file', async () => {
	let active = 0, maximum = 0; const copied: number[] = [];
	await mapLimit([0, 1, 2, 3, 4], 2, async value => {
		maximum = Math.max(maximum, ++active); await Promise.resolve(); copied.push(value); --active;
	});
	expect(maximum).toBe(2); expect(copied.sort()).toEqual([0, 1, 2, 3, 4]);
});
