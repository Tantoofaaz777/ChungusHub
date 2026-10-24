/**
 * Putting a snapshot back.
 *
 * **A restore happens at boot, never in a running server, and that is a hard constraint
 * rather than a preference.** `bun:sqlite` does not release the database file once
 * `db.transaction()` has been used on the handle: `close()` leaves a connection SQLite
 * still owns, and on Windows that blocks deleting the file AND renaming it (`close(true)`
 * says "database is locked" outright). Migrations run inside a transaction, so every live
 * server has an unreleasable handle from its first boot. A restore therefore writes a
 * JOURNAL, hands the process over, and the swap runs early in the next boot, before
 * anything has opened a database.
 *
 * That constraint buys the property the operation most needs anyway: the swap is many
 * destructive steps, and the journal makes every one of them resumable. After a crash, a
 * power cut or a killed process, the next launch finds the marker, finishes the job and
 * carries on booting. There is no state in which the data folder is half one install and
 * half another with nothing admitting it.
 *
 * The swap is per ENTRY, never a rename of the data dir itself: two `fs.watch` handles stay
 * open on that directory for the life of the process (watch-file.ts), and Windows refuses to
 * rename a directory anything has open.
 */
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { ensureDirs, resolveDataDir } from '../config';
import { BASELINE_SCHEMA_VERSION, LATEST_SCHEMA_VERSION } from '../db';
import { APP_VERSION } from '../version';
import { restoreBlockedReason } from '../../shared/backups';
import { readManifest } from './manifest';
import { SNAPSHOT_ENTRIES, BUILDING_MARKER, assertBackupDirUsable, journalPath, snapshotDataPath, snapshotPath, validSnapshotId } from './paths';
import { mapLimit } from './copy-batch';

const COPY_CONCURRENCY = 16;

export interface RestoreJournal {
	snapshotId: string;
	startedAt: number;
	appVersion: string;
}

export function readJournal(): RestoreJournal | null {
	const path = journalPath();
	if (!existsSync(path)) return null;
	try {
		const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid restore journal');
		const j = raw as Record<string, unknown>;
		if (typeof j.snapshotId !== 'string' || !validSnapshotId(j.snapshotId)) throw new Error('Invalid restore journal');
		return {
			snapshotId: j.snapshotId,
			startedAt: typeof j.startedAt === 'number' ? j.startedAt : 0,
			appVersion: typeof j.appVersion === 'string' ? j.appVersion : 'unknown'
		};
	} catch {
		// A marker that will not parse still means a restore was under way, and the safe
		// reading of "something was mid-swap" is never "carry on as if it was not". Naming
		// the snapshot is what makes it resumable, so an unreadable one has to be fatal.
		throw new Error(
			`${path} says a restore was interrupted but cannot be read. Delete it only if you are sure the data folder is intact.`
		);
	}
}

function clearJournal(): void {
	rmSync(journalPath(), { force: true });
}

/**
 * Withdraw a claimed restore before any relaunch has run it. Only the journal goes; the
 * safety snapshot it triggered stays in the list like any other. Safe at any point before
 * the swap, because claiming destroys nothing: the claim IS the one small file.
 */
export function cancelPendingRestore(): void {
	clearJournal();
}

/**
 * Claim the next boot for a restore. Nothing is destroyed here: this writes one small file
 * and validates that the snapshot can be read by this build at all.
 */
export function beginRestore(snapshotId: string): void {
	validateRestoreSource(snapshotId);
	const path = journalPath();
	const temp = `${path}.tmp`;
	const journal: RestoreJournal = {
		snapshotId,
		startedAt: Date.now(),
		appVersion: APP_VERSION
	};
	writeFileSync(temp, JSON.stringify(journal, null, 2));
	renameSync(temp, path);
}

/** Validate before claiming AND immediately before any live entry can be removed. */
function validateRestoreSource(snapshotId: string): string {
	assertBackupDirUsable();
	const manifest = readManifest(snapshotId);
	if (!manifest) throw new Error(`No readable snapshot named "${snapshotId}".`);
	const blocked = restoreBlockedReason(manifest, LATEST_SCHEMA_VERSION);
	if (blocked) throw new Error(blocked);
	const root = snapshotPath(snapshotId), source = snapshotDataPath(snapshotId);
	if (existsSync(join(root, BUILDING_MARKER))) throw new Error('This snapshot has not finished being written.');
	if (!existsSync(source)) {
		throw new Error(`Snapshot "${snapshotId}" has no data folder to restore from.`);
	}
	if (lstatSync(root).isSymbolicLink() || lstatSync(source).isSymbolicLink() || !lstatSync(source).isDirectory()) {
		throw new Error('The snapshot data must be a real directory inside the backup store.');
	}
	if (!realpathSync(source).startsWith(realpathSync(dirname(root)) + sep)) throw new Error('The snapshot is outside the backup store.');
	const database = join(source, 'chungushub.db');
	if (!existsSync(database) || !lstatSync(database).isFile() || lstatSync(database).isSymbolicLink()) {
		throw new Error('The snapshot database is missing or is not a regular file.');
	}
	const db = new Database(database, { readonly: true });
	try {
		const integrity = db.query('PRAGMA integrity_check').all() as Record<string, unknown>[];
		if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('The snapshot database is damaged.');
		const row = db.query('SELECT MAX(version) AS version FROM _migrations').get() as { version: number | null };
		if (!Number.isSafeInteger(row.version) || row.version! < BASELINE_SCHEMA_VERSION) throw new Error('The snapshot database format is not supported.');
		const actualBlocked = restoreBlockedReason({ ...manifest, schemaVersion: row.version! }, LATEST_SCHEMA_VERSION);
		if (actualBlocked) throw new Error(actualBlocked);
	} finally { db.close(); }
	return source;
}

async function walk(root: string, base = root): Promise<string[]> {
	let entries;
	try {
		if (lstatSync(root).isSymbolicLink()) throw new Error(`The snapshot contains a symbolic link: ${root}.`);
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
	const out: string[] = [];
	for (const entry of entries) {
		const abs = join(root, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(abs, base)));
		else if (entry.isFile()) out.push(relative(base, abs).split(sep).join('/'));
		else throw new Error(`The snapshot contains an unsupported file: ${abs}.`);
	}
	return out;
}

/**
 * Replace the live entries with the snapshot's. Idempotent from any point: every entry is
 * removed and written afresh, so running it twice is the same as running it once. That is
 * what lets a boot resume simply call it again after a crash halfway through.
 *
 * Async throughout because on a large library this is minutes of work, and the console line
 * below it is the only thing a headless install has to look at.
 */
export async function swapEntries(snapshotId: string): Promise<void> {
	const dataDir = resolve(resolveDataDir());
	const sourceRoot = validateRestoreSource(snapshotId);

	const files: string[] = [];
	for (const entry of SNAPSHOT_ENTRIES) {
		const src = join(sourceRoot, entry.name);
		if (!existsSync(src)) continue;
		if (entry.kind === 'dir') {
			for (const rel of await walk(src)) files.push(`${entry.name}/${rel}`);
		} else {
			files.push(entry.name);
		}
	}
	const manifest = readManifest(snapshotId)!;
	if (manifest.fileCount > 0 && files.length !== manifest.fileCount) {
		throw new Error('Files are missing from this snapshot or its inventory has changed.');
	}
	// Presets are loaded independently of SQLite. A readable database cannot make a
	// truncated preset usable, so check those files before removing any live entry too.
	for (const rel of files) {
		if (rel.startsWith('presets/') && rel.endsWith('.json')) {
			try { JSON.parse(await readFile(join(sourceRoot, rel), 'utf8')); }
			catch { throw new Error(`The snapshot contains an unreadable preset: ${rel}.`); }
		}
	}

	// Remove first, all of it, so nothing from the present survives inside a folder the
	// snapshot also has: a character deleted before the snapshot must not come back to life
	// because its file happened to still be there.
	for (const entry of SNAPSHOT_ENTRIES) {
		const target = resolve(dataDir, entry.name);
		if (dirname(target) !== dataDir) throw new Error('Restore target is outside the data directory.');
		await rm(target, { recursive: true, force: true });
		if (entry.kind === 'db') {
			// A live journal paired with a database from another month is unrecoverable, so
			// the sidecars go whether or not the last shutdown was clean.
			await rm(`${target}-wal`, { force: true });
			await rm(`${target}-shm`, { force: true });
		}
	}

	await mapLimit(files, COPY_CONCURRENCY, async (rel) => {
		const dest = join(dataDir, rel);
		await mkdir(dirname(dest), { recursive: true });
		// Copied rather than hardlinked, deliberately. Linking would make this instant, and
		// is safe only while nothing in the app ever rewrites an image in place, an
		// invariant no future author would know they were holding. The day one did, a
		// restore would silently edit the snapshot it restored from.
		await copyFile(join(sourceRoot, rel), dest);
	});
}

/**
 * The boot path. A marker means a restore was claimed or was cut short; either way the swap
 * runs now, while nothing has opened a database and the source snapshot cannot change.
 */
export async function resumeInterruptedRestore(): Promise<string | null> {
	const journal = readJournal();
	if (!journal) return null;
	const manifest = readManifest(journal.snapshotId);
	if (!manifest) {
		throw new Error(
			`A restore of "${journal.snapshotId}" was claimed, but that snapshot is no longer readable. ` +
				'Put it back, or delete ' +
				journalPath() +
				' to start without restoring.'
		);
	}
	console.log('');
	console.log(`  Restoring the backup from ${new Date(manifest.createdAt).toLocaleString()}.`);
	console.log('  On a large library this takes a moment. Do not close the window.');
	await swapEntries(journal.snapshotId);
	// The swap deletes `images/` wholesale, so a snapshot that predates a category leaves
	// that folder missing. Uploads would recreate their own, but anything that only READS a
	// category would find nothing there at all, so the skeleton is put back explicitly.
	ensureDirs();
	clearJournal();
	console.log('  Restored.');
	console.log('');
	return journal.snapshotId;
}
