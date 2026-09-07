/**
 * Snapshots, against the real database and a real directory tree.
 *
 * Both env vars are pinned to throwaway dirs before the first db call: `CHUNGUS_DATA_DIR`
 * for the same reason every other server test does it, and `CHUNGUS_BACKUP_DIR` because the
 * default store is the data dir's SIBLING, which for a mkdtemp dir is the shared system
 * temp folder, so a test setting only the first would scatter snapshots through it.
 *
 * The restore SWAP is not exercised here and cannot be: a swap replaces the database FILE
 * underneath the app, which is why it runs at boot before anything has opened it (see
 * backup/restore.ts). `restore-swap.test.ts` covers it from that process state.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ZipFile as ZipWriter } from 'yazl';
import { LATEST_SCHEMA_VERSION, MIGRATIONS_FOR_TESTS } from '../db';

let dataDir: string;
let backupDir: string;
let snapshotMod: typeof import('./snapshot');
let manifestMod: typeof import('./manifest');
let portableMod: typeof import('./portable');

/**
 * The real schema, applied through a connection this file owns.
 *
 * Deliberately NOT `serverDb`: this suite is the only one that checks WHERE the database
 * ended up, and everything the snapshot code does resolves the data dir per call. It needs a
 * connection whose path this file fixes and closes itself, rather than the shared one every
 * other server test rebinds to its own dir. `serverDb.createdSince` is covered in
 * `server/chatList.test.ts`, which owns that singleton legitimately.
 */
function buildDatabase(): void {
	const db = new Database(join(dataDir, 'chungushub.db'), { create: true });
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec(
		'CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)'
	);
	for (const migration of [...MIGRATIONS_FOR_TESTS].sort((a, b) => a.version - b.version)) {
		db.exec(migration.sql);
		db.run('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)', [
			migration.version,
			migration.name,
			Date.now()
		]);
	}
	db.close();
}

beforeAll(async () => {
	const root = mkdtempSync(join(tmpdir(), 'chungus-backup-'));
	dataDir = join(root, 'user-data');
	backupDir = join(root, 'backups');
	mkdirSync(dataDir, { recursive: true });
	process.env.CHUNGUS_DATA_DIR = dataDir;
	process.env.CHUNGUS_BACKUP_DIR = backupDir;
	snapshotMod = await import('./snapshot');
	manifestMod = await import('./manifest');
	portableMod = await import('./portable');
	buildDatabase();
});

// Re-pinned per test, not just once: `bun test` shares one process across files and the
// backup paths resolve the env on EVERY call (deliberately, so tests can redirect them at
// all). Another suite's `beforeAll` landing between two of these would otherwise send a
// snapshot looking for its database somewhere else entirely.
beforeEach(() => {
	process.env.CHUNGUS_DATA_DIR = dataDir;
	process.env.CHUNGUS_BACKUP_DIR = backupDir;
});

afterAll(() => {
	try {
		rmSync(dirname(dataDir), { recursive: true, force: true });
	} catch {
		/* the database file stays locked for the life of the process; best effort */
	}
});

function writeImage(category: string, name: string, body: string): string {
	const dir = join(dataDir, 'images', category);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), body);
	return `images/${category}/${name}`;
}

/** Rows written through a second connection, exactly as the running server's would be. */
function seedChat(id: string, attachmentPath: string | null): void {
	const db = new Database(join(dataDir, 'chungushub.db'), { readwrite: true, create: false });
	const now = Date.now();
	db.run('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [
		id,
		`Chat ${id}`,
		now,
		now
	]);
	db.run(
		'INSERT INTO messages (id, chat_id, role, content, sibling_index, created_at, attachments_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
		[
			`m-${id}`,
			id,
			'user',
			'hello',
			0,
			now,
			attachmentPath ? JSON.stringify([{ path: attachmentPath }]) : null
		]
	);
	db.close();
}

async function zipBytes(entries: Array<[string, string | Uint8Array]>): Promise<Uint8Array> {
	const zip = new ZipWriter();
	for (const [name, body] of entries) zip.addBuffer(Buffer.from(body), name);
	zip.end();
	const chunks: Buffer[] = [];
	for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

describe('snapshot', () => {
	test('captures the database, the files and their counts', async () => {
		writeImage('characters', 'a.png', 'AAAA');
		mkdirSync(join(dataDir, 'images', 'characters', 'thumbnails'), { recursive: true });
		writeFileSync(join(dataDir, 'images', 'characters', 'thumbnails', 'a.jpg'), 'thumb-a');
		mkdirSync(join(dataDir, 'presets'), { recursive: true });
		writeFileSync(join(dataDir, 'presets', 'p1.json'), JSON.stringify({ name: 'One', items: [] }));
		mkdirSync(join(dataDir, 'assistant-files'), { recursive: true });
		writeFileSync(join(dataDir, 'assistant-files', 'legacy.txt'), 'legacy');
		writeFileSync(join(dataDir, 'assistantSkills.json'), JSON.stringify({ skills: [] }));
		seedChat('c1', 'images/characters/a.png');

		const manifest = await snapshotMod.createSnapshot({ kind: 'manual', label: 'first' });

		expect(manifest.kind).toBe('manual');
		expect(manifest.label).toBe('first');
		expect(manifest.summary.chats).toBe(1);
		expect(manifest.summary.messages).toBe(1);
		expect(manifest.summary.presets).toBe(1);
		expect(manifest.summary.images).toBe(1);
		expect(manifest.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
		expect(manifest.warnings).toEqual([]);

		const data = join(backupDir, manifest.id, 'data');
		expect(existsSync(join(data, 'chungushub.db'))).toBe(true);
		expect(existsSync(join(data, 'images', 'characters', 'a.png'))).toBe(true);
		expect(existsSync(join(data, 'images', 'characters', 'thumbnails', 'a.jpg'))).toBe(true);
		expect(existsSync(join(data, 'presets', 'p1.json'))).toBe(true);
		expect(existsSync(join(data, 'assistant-files'))).toBe(false);
		expect(existsSync(join(data, 'assistantSkills.json'))).toBe(false);
	});

	test('the copied database is readable and holds the rows', async () => {
		const manifest = await snapshotMod.createSnapshot({ kind: 'manual' });
		const copy = new Database(join(backupDir, manifest.id, 'data', 'chungushub.db'), {
			readonly: true
		});
		const chats = copy.query('SELECT COUNT(*) AS n FROM chats').get() as { n: number };
		copy.close();
		expect(chats.n).toBe(manifest.summary.chats);
	});

	test('never carries the security state files', async () => {
		writeFileSync(join(dataDir, 'security.json'), '{"passwordHash":"secret"}');
		writeFileSync(join(dataDir, 'allowlist.json'), '["10.0.0.1"]');
		const manifest = await snapshotMod.createSnapshot({ kind: 'manual' });
		const data = join(backupDir, manifest.id, 'data');
		expect(existsSync(join(data, 'security.json'))).toBe(false);
		expect(existsSync(join(data, 'allowlist.json'))).toBe(false);
	});

	test('shares an unchanged file and copies one that was replaced under the same name', async () => {
		// Background art keeps a human filename, so a replaced picture reuses its path. This
		// is the exact case a path-existence check would link to the wrong pixels.
		writeImage('backgrounds', 'sunset.png', 'ORIGINAL');
		const before = await snapshotMod.createSnapshot({ kind: 'manual' });
		writeImage('backgrounds', 'sunset.png', 'REPLACED-ENTIRELY');
		const after = await snapshotMod.createSnapshot({ kind: 'manual' });

		expect(readFileSync(join(backupDir, before.id, 'data', 'images', 'backgrounds', 'sunset.png'), 'utf8')).toBe(
			'ORIGINAL'
		);
		expect(readFileSync(join(backupDir, after.id, 'data', 'images', 'backgrounds', 'sunset.png'), 'utf8')).toBe(
			'REPLACED-ENTIRELY'
		);
		// The untouched one is literally the same file as the previous snapshot's copy.
		expect(statSync(join(backupDir, after.id, 'data', 'images', 'characters', 'a.png')).nlink).toBeGreaterThan(1);
		expect(after.linked).toBe(true);
		// Sharing is the whole point: the second snapshot must not have paid for the first.
		expect(after.bytes.onDisk).toBeLessThan(after.bytes.logical);
	});

	test('brings back an image the database names but the copy pass missed', async () => {
		const path = writeImage('chat', 'late.png', 'LATE');
		seedChat('c-late', path);
		const manifest = await snapshotMod.createSnapshot({ kind: 'manual' });
		expect(existsSync(join(backupDir, manifest.id, 'data', 'images', 'chat', 'late.png'))).toBe(true);
		// A chat attachment has no thumbnail, and that must not read as a failure.
		expect(manifest.warnings).toEqual([]);
	});

	test('says so when the database names an image that is gone', async () => {
		seedChat('c-missing', 'images/chat/vanished.png');
		const manifest = await snapshotMod.createSnapshot({ kind: 'manual' });
		expect(manifest.warnings.join(' ')).toContain('could not be included');
	});

	test('a snapshot is built where it will live, never renamed into place', async () => {
		// The store can sit inside a watched folder, and Windows refuses to rename a
		// directory anything holds a handle on. Nothing here may depend on that working.
		const before = new Set(readdirSync(backupDir));
		const manifest = await snapshotMod.createSnapshot({ kind: 'manual' });
		const added = readdirSync(backupDir).filter((n) => !before.has(n));
		expect(added).toEqual([manifest.id]);
		expect(existsSync(join(backupDir, manifest.id, '.building'))).toBe(false);
	});

	test('a snapshot left mid-build is swept and never listed', async () => {
		const half = join(backupDir, '2020-01-01_00-00-00_manual');
		mkdirSync(join(half, 'data'), { recursive: true });
		writeFileSync(join(half, '.building'), '1');
		const listing = manifestMod.listSnapshots();
		expect(listing.snapshots.some((s) => s.id.startsWith('2020-'))).toBe(false);
		// Not a fault, so it is not counted as one either.
		expect(listing.unreadable).toBe(0);
		expect(snapshotMod.sweepAbandonedSnapshots()).toBe(1);
		expect(existsSync(half)).toBe(false);
	});

	test('a folder somebody else put here is counted, not deleted', async () => {
		mkdirSync(join(backupDir, 'something-else'), { recursive: true });
		expect(manifestMod.listSnapshots().unreadable).toBe(1);
		expect(snapshotMod.sweepAbandonedSnapshots()).toBe(0);
		expect(existsSync(join(backupDir, 'something-else'))).toBe(true);
		rmSync(join(backupDir, 'something-else'), { recursive: true, force: true });
	});

	test('pinning survives a re-read', async () => {
		const manifest = await snapshotMod.createSnapshot({ kind: 'manual' });
		expect(manifest.pinned).toBe(false);
		manifestMod.patchManifest(manifest.id, { pinned: true });
		expect(manifestMod.readManifest(manifest.id)?.pinned).toBe(true);
	});
});

describe('portable backups', () => {
	test('round-trips one snapshot through a streamed ZIP as an imported restore point', async () => {
		writeImage('characters', 'portable.png', 'PORTABLE-IMAGE');
		const source = await snapshotMod.createSnapshot({ kind: 'manual', label: 'take me elsewhere' });
		const prepared = await portableMod.preparePortableExport(source.id);
		const download = portableMod.takePreparedExport(prepared.token);
		expect(download).not.toBeNull();
		const archive = await new Response(download!.body).arrayBuffer();

		const imported = await portableMod.importPortableBackup(new Response(archive).body);
		expect(imported.kind).toBe('imported');
		expect(imported.sourceKind).toBe('manual');
		expect(imported.createdAt).toBe(source.createdAt);
		expect(imported.label).toBe('take me elsewhere');
		expect(imported.summary).toEqual(source.summary);
		expect(manifestMod.readIndex(imported.id)).toEqual({});
		expect(
			readFileSync(join(backupDir, imported.id, 'data', 'images', 'characters', 'portable.png'), 'utf8')
		).toBe('PORTABLE-IMAGE');
		expect(existsSync(join(backupDir, imported.id, '.building'))).toBe(false);
	});

	test('rejects a file that is not a ZIP and leaves no staged snapshot behind', async () => {
		const before = new Set(readdirSync(backupDir));
		await expect(
			portableMod.importPortableBackup(new Response('not an archive').body)
		).rejects.toThrow();
		const after = readdirSync(backupDir).filter((name) => !before.has(name));
		expect(after).toEqual([]);
	});

	test('rejects unexpected and duplicate archive paths before extraction', async () => {
		const unexpected = await zipBytes([
			['backup.json', '{}'],
			['data/chungushub.db', 'not used'],
			['outside.txt', 'no']
		]);
		await expect(portableMod.importPortableBackup(new Response(unexpected).body)).rejects.toThrow(
			'unexpected file'
		);

		const duplicate = await zipBytes([
			['backup.json', '{}'],
			['backup.json', '{}'],
			['data/chungushub.db', 'not used']
		]);
		await expect(portableMod.importPortableBackup(new Response(duplicate).body)).rejects.toThrow(
			'more than once'
		);
	});

	test('rejects an archive with no database', async () => {
		const archive = await zipBytes([['backup.json', '{}']]);
		await expect(portableMod.importPortableBackup(new Response(archive).body)).rejects.toThrow(
			'does not contain its database'
		);
	});

	test('rejects a damaged database and removes the staged restore point', async () => {
		const before = new Set(readdirSync(backupDir));
		const archive = await zipBytes([
			[
				'backup.json',
				JSON.stringify({
					format: 'chungushub-backup',
					formatVersion: 1,
					exportedAt: Date.now(),
					snapshot: {
						id: 'damaged',
						createdAt: Date.now(),
						kind: 'manual',
						schemaVersion: LATEST_SCHEMA_VERSION
					}
				})
			],
			['data/chungushub.db', 'definitely not sqlite']
		]);
		await expect(portableMod.importPortableBackup(new Response(archive).body)).rejects.toThrow();
		const after = readdirSync(backupDir).filter((name) => !before.has(name));
		expect(after).toEqual([]);
	});
});
