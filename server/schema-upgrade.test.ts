/**
 * What a migration is allowed to do to a database that already holds someone's stories.
 *
 * Restoring an old snapshot is not a special path, it is the upgrade path a user who did not
 * open the app all year would take anyway: the app finds an older `_migrations` and runs
 * whatever is missing. That only stays safe while migrations are structure, so any migration
 * that rewrites rows has to be a decision made here rather than something discovered later.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';

import { MIGRATIONS_FOR_TESTS } from './db';

/**
 * The migrations that deliberately rewrite rows. Each needs focused coverage of its boundary;
 * a repeatable backfill must be idempotent, while destructive schema cleanup must prove that
 * unrelated rows survive and malformed values cannot break the upgrade.
 */
const DATA_MIGRATIONS: string[] = [
	'44: backfill_chat_default_version',
	'45: remove_chungus_assistant_storage'
];

describe('migrations', () => {
	test('a migration only moves data when it was decided here', () => {
		const movers = MIGRATIONS_FOR_TESTS.filter((m) =>
			/\b(UPDATE\s+\w+\s+SET|INSERT\s+INTO|DELETE\s+FROM)\b/i.test(m.sql)
		).map((m) => `${m.version}: ${m.name}`);
		expect(movers).toEqual(DATA_MIGRATIONS);
	});
});

/**
 * Data migrations, driven against real rows in the shape they sit on disk. The shared setup
 * stops before migration 44 so each suite can seed the state its migration is expected to see.
 * Migration 44 is applied twice because repeatability is part of that backfill's contract;
 * migration 45 is applied once, as the real runner guarantees, and tests its destructive edge.
 */
const BACKFILL = MIGRATIONS_FOR_TESTS.find((m) => m.version === 44)!;
const ASSISTANT_CLEANUP = MIGRATIONS_FOR_TESTS.find((m) => m.version === 45)!;

let db: Database;

/** The stored payload as `libraryPayload` writes it: identity + data, and each pointer only
 *  when set, which is why an entry from before these fields simply has no key for them. */
function entry(id: string, type: 'character' | 'persona', payload: Record<string, unknown>): void {
	db.run('INSERT INTO character_library (id, type, data_json, is_favorite, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 1)', [
		id,
		type,
		JSON.stringify({ identity: { name: id }, data: { traits: {} }, ...payload })
	]);
}

/** An entry whose stored payload is not JSON at all. The library read fails loud on this
 *  row; the migration's job is to leave it exactly as it found it. */
function tornEntry(id: string): void {
	db.run('INSERT INTO character_library (id, type, data_json, is_favorite, created_at, updated_at) VALUES (?, ?, ?, 0, 1, 1)', [
		id,
		'character',
		'{not json'
	]);
}

function version(id: string, entryId: string): void {
	db.run('INSERT INTO character_versions (id, entry_id, name, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)', [
		id,
		entryId,
		id,
		'{}'
	]);
}

const raw = (id: string): string =>
	(db.query('SELECT data_json FROM character_library WHERE id = ?').get(id) as { data_json: string }).data_json;

const defaultVersionOf = (id: string): unknown => JSON.parse(raw(id)).defaultVersionId;

function runBackfill(): void {
	db.exec(BACKFILL.sql);
}

beforeEach(() => {
	db = new Database(':memory:');
	db.exec('PRAGMA foreign_keys = ON');
	for (const migration of [...MIGRATIONS_FOR_TESTS].sort((a, b) => a.version - b.version)) {
		if (migration.version >= BACKFILL.version) continue;
		db.exec(migration.sql);
	}
});

afterEach(() => db.close());

describe('44: the chat-default version backfill', () => {
	test('a character that was being played on a fork keeps being played on it', () => {
		// The whole point. Before the seed existed the pin came off `activeVersionId`, so this
		// reader has been getting "Pirate" for months; the seed alone would hand them the
		// first variant ever made and say nothing.
		entry('aria', 'character', { activeVersionId: 'pirate' });
		version('original', 'aria');
		version('pirate', 'aria');

		runBackfill();

		expect(defaultVersionOf('aria')).toBe('pirate');
	});

	test('a row that already names a default is not touched', () => {
		entry('aria', 'character', { activeVersionId: 'pirate', defaultVersionId: 'original' });
		version('original', 'aria');
		version('pirate', 'aria');
		const before = raw('aria');

		runBackfill();

		expect(raw('aria')).toBe(before);
	});

	test('an unversioned character is left byte for byte alone', () => {
		// Nothing to pin: the entry stores exactly what it stored before any of these fields
		// existed, and it has to go on doing that.
		entry('solo', 'character', {});
		const before = raw('solo');

		runBackfill();

		expect(raw('solo')).toBe(before);
	});

	test('an active pointer naming a version that is gone is not revived', () => {
		// Writing that id in would make a default nothing resolves; the seed's own fallback to
		// the first variant is the truer answer.
		entry('aria', 'character', { activeVersionId: 'deleted-one' });
		version('original', 'aria');
		const before = raw('aria');

		runBackfill();

		expect(raw('aria')).toBe(before);
	});

	test('a version belonging to another character does not qualify', () => {
		entry('aria', 'character', { activeVersionId: 'someone-elses' });
		entry('bram', 'character', {});
		version('original', 'aria');
		version('someone-elses', 'bram');
		const before = raw('aria');

		runBackfill();

		expect(raw('aria')).toBe(before);
	});

	test('a persona is never touched', () => {
		entry('reader', 'persona', { activeVersionId: 'pirate' });
		const before = raw('reader');

		runBackfill();

		expect(raw('reader')).toBe(before);
	});

	test('a payload it cannot parse is left alone instead of failing the upgrade', () => {
		// A torn row must not take the boot down with it: json_extract raises on malformed
		// JSON, and the guards are what keep that raise out of the migration.
		tornEntry('torn');
		entry('aria', 'character', { activeVersionId: 'pirate' });
		version('pirate', 'aria');

		expect(() => runBackfill()).not.toThrow();

		expect(raw('torn')).toBe('{not json');
		expect(defaultVersionOf('aria')).toBe('pirate');
	});

	test('running it twice changes nothing the second time', () => {
		entry('aria', 'character', { activeVersionId: 'pirate' });
		entry('solo', 'character', {});
		entry('kept', 'character', { activeVersionId: 'pirate2', defaultVersionId: 'original2' });
		tornEntry('torn');
		version('original', 'aria');
		version('pirate', 'aria');
		version('original2', 'kept');
		version('pirate2', 'kept');

		runBackfill();
		const afterFirst = ['aria', 'solo', 'kept', 'torn'].map(raw);

		runBackfill();

		expect(['aria', 'solo', 'kept', 'torn'].map(raw)).toEqual(afterFirst);
	});
});

describe('45: the Chungus Assistant storage removal', () => {
	test('drops the legacy tables and removes only the obsolete settings properties', () => {
		db.run(
			'INSERT INTO assistant_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
			['session', 'Old Assistant', 1, 1]
		);
		db.run(
			"INSERT INTO assistant_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
			['assistant-message', 'session', 'legacy reply', 1]
		);
		db.run(
			'INSERT INTO assistant_files (id, session_id, message_id, name, kind, bytes, lines, token_estimate, text_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			['file', 'session', 'assistant-message', 'notes.txt', 'text', 5, 1, 2, 'assistant-files/file.txt', 1]
		);
		db.run('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
			'chat',
			'Story',
			1,
			1
		]);
		db.run(
			"INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
			['story-message', 'chat', 'ordinary story reply', 1]
		);
		db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [
			'generalSettings',
			JSON.stringify({ saveDrafts: true, assistantLauncher: false, assistantCostSeen: true })
		]);
		db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [
			'connectionAssignments',
			JSON.stringify({ primary: 'main', assistant: 'old', memory: 'memory-model' })
		]);

		db.exec(ASSISTANT_CLEANUP.sql);

		const tables = db
			.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'assistant_%' ORDER BY name")
			.all();
		expect(tables).toEqual([]);
		expect(db.query('SELECT content FROM messages WHERE id = ?').get('story-message')).toEqual({
			content: 'ordinary story reply'
		});
		const general = db.query('SELECT value FROM settings WHERE key = ?').get('generalSettings') as {
			value: string;
		};
		const assignments = db.query('SELECT value FROM settings WHERE key = ?').get('connectionAssignments') as {
			value: string;
		};
		expect(JSON.parse(general.value)).toEqual({ saveDrafts: true });
		expect(JSON.parse(assignments.value)).toEqual({ primary: 'main', memory: 'memory-model' });
	});

	test('leaves malformed settings byte for byte unchanged', () => {
		db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['generalSettings', '{not json']);
		db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['connectionAssignments', '[also broken']);

		expect(() => db.exec(ASSISTANT_CLEANUP.sql)).not.toThrow();

		expect(db.query('SELECT value FROM settings WHERE key = ?').get('generalSettings')).toEqual({
			value: '{not json'
		});
		expect(db.query('SELECT value FROM settings WHERE key = ?').get('connectionAssignments')).toEqual({
			value: '[also broken'
		});
	});

	test('a fresh database finishes without Assistant tables', () => {
		const fresh = new Database(':memory:');
		try {
			fresh.exec('PRAGMA foreign_keys = ON');
			for (const migration of [...MIGRATIONS_FOR_TESTS].sort((a, b) => a.version - b.version)) {
				fresh.exec(migration.sql);
			}
			const tables = fresh
				.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'assistant_%' ORDER BY name")
				.all();
			expect(tables).toEqual([]);
		} finally {
			fresh.close();
		}
	});
});
