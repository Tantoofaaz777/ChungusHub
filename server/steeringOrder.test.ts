import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDatabaseFixture } from './test-fixtures';
import { createSteeringNote, sortSteeringNotes, type SteeringNote } from '../src/lib/types/steering';

let dataDir: string;
let db: (typeof import('./db'))['serverDb'];
let call: (typeof import('./db'))['callDbMethod'];
const previousDataDir = process.env.CHUNGUS_DATA_DIR;
beforeAll(async () => {
	dataDir = mkdtempSync(join(tmpdir(), 'chungus-steering-order-'));
	process.env.CHUNGUS_DATA_DIR = dataDir;
	({ serverDb: db, callDbMethod: call } = await import('./db'));
	db.closeForTests();
});
afterAll(() => {
	db?.closeForTests();
	if (previousDataDir === undefined) delete process.env.CHUNGUS_DATA_DIR;
	else process.env.CHUNGUS_DATA_DIR = previousDataDir;
	removeDatabaseFixture(dataDir, 'chungus-steering-order-');
});
function create(text: string) {
	const note = createSteeringNote({ text, title: text, scope: 'global', scopeId: null });
	db.insertSteeringNote({ ...note }); return note;
}
const all = () => db.getAllSteeringNotes() as SteeringNote[];

test('atomic reorder RPC persists positions and preserves current note contents and switches', () => {
	const a = create('First'), b = create('Second');
	db.updateSteeringNote({ ...a, text: 'Latest remote edit', enabled: false });
	expect(call('reorderSteeringNotes', [[b.id, a.id]])).toEqual([b.id, a.id]);
	expect(sortSteeringNotes(all()).map(note => note.id)).toEqual([b.id, a.id]);
	expect(all().find(note => note.id === a.id)).toMatchObject({ text: 'Latest remote edit', enabled: false, sortOrder: 1 });
	// A stale editor/toggle carries its old position, but cannot overwrite the newer order.
	db.updateSteeringNote({ ...a, sortOrder: 0, title: 'Renamed' });
	expect(all().find(note => note.id === a.id)).toMatchObject({ title: 'Renamed', sortOrder: 1 });
	db.closeForTests();
	expect(sortSteeringNotes(all()).map(note => note.id)).toEqual([b.id, a.id]);
});

test('partial or stale reorder requests keep concurrent additions and never resurrect deleted ids', () => {
	const existing = all(), fresh = create('Concurrent addition'), removed = create('Removed');
	db.deleteSteeringNote(removed.id);
	const result = call('reorderSteeringNotes', [[fresh.id, fresh.id, removed.id, 'missing']]) as string[];
	expect(result).toEqual([fresh.id, ...sortSteeringNotes(existing).map(note => note.id)]);
	expect(new Set(result).size).toBe(all().length);
	expect(all().some(note => note.id === removed.id)).toBe(false);
	expect(all().map(note => note.sortOrder).sort()).toEqual([0, 1, 2]);
});

test('invalid ordering fails without modifying persisted positions', () => {
	const before = all();
	expect(() => call('reorderSteeringNotes', [[null]])).toThrow('Invalid steering order');
	expect(all()).toEqual(before);
});
