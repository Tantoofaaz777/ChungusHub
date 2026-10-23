/**
 * The restore swap and its journal.
 *
 * This file deliberately never touches `serverDb`. A restore replaces the database FILE, and
 * a process that has opened the live handle can never do that: `bun:sqlite` does not release
 * the file once `db.transaction()` has run on it, and migrations run inside one. That is
 * precisely why the swap happens at boot before anything opens a database, and this test
 * reproduces that state rather than working around it: every connection it makes is a plain
 * one it closes itself.
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSnapshot } from './snapshot';
import { beginRestore, cancelPendingRestore, readJournal, resumeInterruptedRestore } from './restore';
import { patchManifest } from './manifest';
import { journalPath } from './paths';

const roots: string[] = [];
let dataDir: string;
let backupDir: string;

/** A database the swap can replace: real enough for the inventory queries, built without a
 *  transaction so this process actually lets go of the file. */
function seedDatabase(chatIds: string[]): void {
	const db = new Database(join(dataDir, 'chungushub.db'), { create: true });
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
	db.run('INSERT OR REPLACE INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)', [1, 'test', Date.now()]);
	db.exec('CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT, created_at INTEGER, updated_at INTEGER)');
	db.exec(
		'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, chat_id TEXT, content TEXT, created_at INTEGER, attachments_json TEXT)'
	);
	for (const id of chatIds) {
		db.run('INSERT OR REPLACE INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
			id,
			id,
			Date.now(),
			Date.now()
		]);
	}
	db.close();
}

function chatIds(): string[] {
	const db = new Database(join(dataDir, 'chungushub.db'), { readonly: true });
	const rows = db.query('SELECT id FROM chats ORDER BY id').all() as { id: string }[];
	db.close();
	return rows.map((r) => r.id);
}

function writeImage(name: string, body: string): void {
	mkdirSync(join(dataDir, 'images', 'characters'), { recursive: true });
	writeFileSync(join(dataDir, 'images', 'characters', name), body);
}

beforeEach(() => {
	const root = mkdtempSync(join(tmpdir(), 'chungus-swap-'));
	roots.push(root);
	dataDir = join(root, 'user-data');
	backupDir = join(root, 'backups');
	mkdirSync(dataDir, { recursive: true });
	process.env.CHUNGUS_DATA_DIR = dataDir;
	process.env.CHUNGUS_BACKUP_DIR = backupDir;
});

afterAll(() => {
	for (const root of roots) {
		try {
			rmSync(root, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	}
});

describe('restore swap', () => {
	test('puts the data back and leaves the security files alone', async () => {
		seedDatabase(['one', 'two']);
		writeImage('kept.png', 'KEPT');
		mkdirSync(join(dataDir, 'custom-fonts'), { recursive: true });
		writeFileSync(join(dataDir, 'custom-fonts', 'kept.woff2'), 'FONT');
		mkdirSync(join(dataDir, 'presets'), { recursive: true });
		writeFileSync(join(dataDir, 'presets', 'p.json'), '{"name":"P","items":[]}');
		const snapshot = await createSnapshot({ kind: 'manual', label: 'point' });

		// Move on: a new chat, a new picture, one of the old pictures gone.
		seedDatabase(['one', 'two', 'made-later']);
		writeImage('made-later.png', 'LATER');
		writeFileSync(join(dataDir, 'custom-fonts', 'made-later.woff2'), 'LATER');
		rmSync(join(dataDir, 'images', 'characters', 'kept.png'));
		writeFileSync(join(dataDir, 'security.json'), '{"passwordHash":"changed-since"}');
		expect(chatIds()).toEqual(['made-later', 'one', 'two']);

		beginRestore(snapshot.id);
		expect(readJournal()?.snapshotId).toBe(snapshot.id);
		const restored = await resumeInterruptedRestore();

		expect(restored).toBe(snapshot.id);
		expect(chatIds()).toEqual(['one', 'two']);
		expect(readFileSync(join(dataDir, 'images', 'characters', 'kept.png'), 'utf8')).toBe('KEPT');
		expect(existsSync(join(dataDir, 'images', 'characters', 'made-later.png'))).toBe(false);
		expect(existsSync(join(dataDir, 'presets', 'p.json'))).toBe(true);
		expect(readFileSync(join(dataDir, 'custom-fonts', 'kept.woff2'), 'utf8')).toBe('FONT');
		expect(existsSync(join(dataDir, 'custom-fonts', 'made-later.woff2'))).toBe(false);
		// The door is not part of the room: untouched in both directions.
		expect(readFileSync(join(dataDir, 'security.json'), 'utf8')).toContain('changed-since');
		expect(existsSync(journalPath())).toBe(false);
	});

	test('running the swap twice lands in the same place', async () => {
		seedDatabase(['a']);
		writeImage('x.png', 'X');
		const snapshot = await createSnapshot({ kind: 'manual' });
		seedDatabase(['a', 'b']);

		beginRestore(snapshot.id);
		await resumeInterruptedRestore();
		// A crash between the swap and clearing the marker leaves exactly this: the marker
		// still there over data that is already correct. Doing it again must be harmless.
		beginRestore(snapshot.id);
		await resumeInterruptedRestore();

		expect(chatIds()).toEqual(['a']);
		expect(readFileSync(join(dataDir, 'images', 'characters', 'x.png'), 'utf8')).toBe('X');
	});

	test('nothing to resume without a marker', async () => {
		seedDatabase(['a']);
		expect(await resumeInterruptedRestore()).toBe(null);
	});

	test('a cancelled claim leaves the data alone and the next boot restores nothing', async () => {
		seedDatabase(['a']);
		const snapshot = await createSnapshot({ kind: 'manual' });
		seedDatabase(['a', 'made-later']);

		beginRestore(snapshot.id);
		cancelPendingRestore();

		expect(readJournal()).toBe(null);
		expect(await resumeInterruptedRestore()).toBe(null);
		// The claim was one small file; withdrawing it must cost nothing on either side.
		expect(chatIds()).toEqual(['a', 'made-later']);
		expect(readJournal()).toBe(null);
	});

	test('refuses a snapshot written by a newer app', async () => {
		seedDatabase(['a']);
		const snapshot = await createSnapshot({ kind: 'manual' });
		patchManifest(snapshot.id, { schemaVersion: 9999 });
		expect(() => beginRestore(snapshot.id)).toThrow(/newer version/i);
		expect(existsSync(journalPath())).toBe(false);
	});

	test('a marker naming a snapshot that is gone stops the boot instead of guessing', async () => {
		seedDatabase(['a']);
		const snapshot = await createSnapshot({ kind: 'manual' });
		beginRestore(snapshot.id);
		rmSync(join(backupDir, snapshot.id), { recursive: true, force: true });
		await expect(resumeInterruptedRestore()).rejects.toThrow(/no longer readable/i);
	});

	test('an unreadable marker is fatal rather than ignored', async () => {
		seedDatabase(['a']);
		mkdirSync(backupDir, { recursive: true });
		writeFileSync(journalPath(), 'not json at all');
		expect(() => readJournal()).toThrow(/cannot be read/i);
	});
});
