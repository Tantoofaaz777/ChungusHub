import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

let dataDir: string;
let serverDb: (typeof import('./db'))['serverDb'];
let callDbMethod: (typeof import('./db'))['callDbMethod'];
const previousDataDir = process.env.CHUNGUS_DATA_DIR;

beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-settings-snapshot-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb, callDbMethod } = await import('./db'));
	serverDb.closeForTests();
});

afterAll(() => {
	serverDb?.closeForTests();
	if (previousDataDir === undefined) delete process.env.CHUNGUS_DATA_DIR;
	else process.env.CHUNGUS_DATA_DIR = previousDataDir;
	const absolute = resolve(dataDir);
	if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('chungus-settings-snapshot-')) {
		throw new Error('Unsafe test data path');
	}
	rmSync(absolute, { recursive: true, force: true });
});

test('bulk settings RPC returns raw rows losslessly and does not include connection credentials', () => {
	serverDb.setSetting('appearance', '{"font":"Poppins"}');
	serverDb.setSetting('empty', '');
	serverDb.setSetting('__proto__', 'a normal key');
	serverDb.setConnectionCredentials('snapshot-test', 'openai', 'not-a-setting');
	const rows = callDbMethod('getAllSettings', []) as Record<string, string>;
	expect(rows.appearance).toBe(serverDb.getSetting('appearance')!);
	expect(rows.empty).toBe('');
	expect(Object.hasOwn(rows, '__proto__')).toBe(true);
	expect(rows.__proto__).toBe('a normal key');
	expect(JSON.stringify(rows)).not.toContain('not-a-setting');
	expect(JSON.parse(JSON.stringify(rows)).__proto__).toBe('a normal key');
});

test('a later snapshot reflects writes and deletes without changing an earlier result', () => {
	serverDb.setSetting('changing', 'before');
	const first = serverDb.getAllSettings();
	serverDb.setSetting('changing', 'after');
	serverDb.deleteSetting('empty');
	const second = serverDb.getAllSettings();
	expect(first.changing).toBe('before');
	expect(second.changing).toBe('after');
	expect(Object.hasOwn(second, 'empty')).toBe(false);
});
