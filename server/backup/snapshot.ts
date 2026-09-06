/**
 * Taking a snapshot of the data dir while the app is running.
 *
 * Three properties hold it together. The database is copied with `VACUUM INTO`, which is
 * transactional over the live file and picks up whatever the WAL is still holding, so
 * nothing has to be stopped or locked. Files unchanged since the previous snapshot are
 * HARDLINKED from it rather than copied, which is what makes keeping a year of history
 * affordable. And the whole thing is built where it will live behind a `.building` marker
 * that is deleted last, so a snapshot that is listed is a snapshot that is whole. Deleting
 * one small file is the commit, because Windows will not reliably rename a directory that
 * has just had thousands of files written into it.
 *
 * This module runs in the job child process (see `job.ts`) and must never reach for
 * `serverDb`: the live handle belongs to the server, and the questions asked here are asked
 * of the copy that was just written.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { resolveBackupDir, resolveDataDir, resolveDbPath } from '../config';
import { ensurePrivacyMarkers } from '../privacy-notice';
import { APP_VERSION } from '../version';
import type { SnapshotKind, SnapshotManifest } from '../../shared/backups';
import {
	referencedImagePaths,
	referencedImagePathsInText,
	summarize
} from './inventory';
import { thumbnailFor } from '../files';
import { type SnapshotIndex, listSnapshots, writeIndex, writeManifest, readIndex } from './manifest';
import { BUILDING_MARKER, SNAPSHOT_DATA_DIR, SNAPSHOT_ENTRIES, uniqueSnapshotId } from './paths';

const DB_FILE = 'chungushub.db';
/** Enough parallel file operations to keep the disk busy without drowning it in handles. */
const COPY_CONCURRENCY = 16;

export interface SnapshotProgress {
	phase: string;
	filesDone: number;
	filesTotal: number;
}

export interface SnapshotOptions {
	kind: SnapshotKind;
	label?: string | null;
	onProgress?: (p: SnapshotProgress) => void;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			await fn(items[i]);
		}
	});
	await Promise.all(workers);
}

/** Every file under `root`, as paths relative to it, with forward slashes throughout so an
 *  index written on Windows still matches on the machine that reads it. */
async function walk(root: string, base = root): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const entry of entries) {
		const abs = join(root, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(abs, base)));
		else if (entry.isFile()) out.push(relative(base, abs).split(sep).join('/'));
	}
	return out;
}

/** Errors that say this filesystem cannot share files at all, as opposed to this one file
 *  failing. The first switches the whole job to copying and is reported on the row. */
function isLinkUnsupported(error: unknown): boolean {
	const code = (error as { code?: string }).code;
	return code === 'EXDEV' || code === 'EPERM' || code === 'ENOSYS' || code === 'EOPNOTSUPP';
}

export async function createSnapshot(options: SnapshotOptions): Promise<SnapshotManifest> {
	const { kind, label = null, onProgress } = options;
	const dataDir = resolveDataDir();
	const dbPath = resolveDbPath();
	if (!existsSync(dbPath)) {
		throw new Error(`There is no database at ${dbPath} to back up.`);
	}

	const backupRoot = resolveBackupDir();
	mkdirSync(backupRoot, { recursive: true });
	// The store carries the same secrets as the data dir, and it is the folder people
	// actually zip up and send when they mean "here is my backup".
	ensurePrivacyMarkers(backupRoot, 'backups');

	// One instant for both the folder name and the manifest's `createdAt`. Stamping the
	// manifest when the job FINISHES puts a different time in each, and worse: the schedule
	// compares a snapshot's stamp against when the data last changed, so a message written
	// during the minutes this takes would read as older than the snapshot that does not hold
	// it, and never earn a copy of its own.
	const startedAt = new Date();
	const id = uniqueSnapshotId(startedAt, kind);
	// Built in its final place with a marker file saying it is not finished, rather than
	// built aside and renamed in: a directory anything has a handle on cannot be renamed on
	// Windows, and from source this store sits inside the repo, where a dev server's or an
	// editor's recursive watcher takes one the moment the folder appears.
	const outDir = join(backupRoot, id);
	const tmpData = join(outDir, SNAPSHOT_DATA_DIR);
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(tmpData, { recursive: true });
	writeFileSync(join(outDir, BUILDING_MARKER), `${Date.now()}\n`);

	// Share against the newest snapshot that is still on disk. If it was pruned, or its
	// index is unreadable, everything is copied: slower, never wrong.
	const previous = listSnapshots().snapshots[0] ?? null;
	const previousIndex = previous ? readIndex(previous.id) : null;
	const previousData = previous ? join(backupRoot, previous.id, SNAPSHOT_DATA_DIR) : null;

	const warnings: string[] = [];
	const index: SnapshotIndex = {};
	let linkingSupported = true;
	/** How many files this job has actually shared, which is what tells a filesystem that
	 *  cannot link at all from a single file something else is holding. */
	let linked = 0;
	let logical = 0;
	let onDisk = 0;
	let done = 0;

	try {
		// ---- 1. The files ----------------------------------------------------------
		const planned: string[] = [];
		for (const entry of SNAPSHOT_ENTRIES) {
			if (entry.kind === 'db') continue;
			const abs = join(dataDir, entry.name);
			if (!existsSync(abs)) continue;
			if (entry.kind === 'dir') {
				for (const rel of await walk(abs)) planned.push(`${entry.name}/${rel}`);
			} else {
				planned.push(entry.name);
			}
		}

		const report = (phase: string, total: number) => onProgress?.({ phase, filesDone: done, filesTotal: total });
		report('Copying files', planned.length);

		const copyOne = async (rel: string): Promise<void> => {
			const src = join(dataDir, rel);
			const dest = join(tmpData, rel);
			let st;
			try {
				st = await stat(src);
			} catch {
				// Deleted between the walk and the copy. The database decides what matters,
				// and the reconcile pass below brings back anything it still names.
				return;
			}
			await mkdir(dirname(dest), { recursive: true });
			index[rel] = { size: st.size, mtimeMs: st.mtimeMs };
			logical += st.size;

			const prev = previousIndex?.[rel];
			const shareable =
				linkingSupported &&
				prev &&
				prev.size === st.size &&
				prev.mtimeMs === st.mtimeMs &&
				previousData &&
				existsSync(join(previousData, rel));
			if (shareable) {
				try {
					await link(join(previousData, rel), dest);
					linked++;
					done++;
					if (done % 250 === 0) report('Copying files', planned.length);
					return;
				} catch (error) {
					// Only before anything has been shared. Windows answers EPERM both for a
					// volume that cannot link at all and for one file a scanner happens to be
					// holding, and taking the second for the first turns the rest of the job
					// into full copies and puts a sentence about the filesystem on the row that
					// is not true of it.
					if (isLinkUnsupported(error) && linked === 0) linkingSupported = false;
				}
			}
			await copyFile(src, dest);
			onDisk += st.size;
			done++;
			if (done % 250 === 0) report('Copying files', planned.length);
		};

		await mapLimit(planned, COPY_CONCURRENCY, copyOne);
		done = planned.length;
		report('Copying the database', planned.length);

		// ---- 2. The database -------------------------------------------------------
		// Opened read-write on purpose: a read-only handle cannot create the `-shm` file a
		// WAL database needs, and at boot (where the pre-upgrade snapshot runs before the
		// server has opened anything) there is no other process holding one.
		const snapshotDbPath = join(tmpData, DB_FILE);
		const source = new Database(dbPath, { readwrite: true, create: false });
		try {
			source.exec(`VACUUM INTO '${snapshotDbPath.replace(/'/g, "''")}'`);
		} finally {
			source.close();
		}
		const dbBytes = statSync(snapshotDbPath).size;
		logical += dbBytes;
		onDisk += dbBytes;
		index[DB_FILE] = { size: dbBytes, mtimeMs: statSync(snapshotDbPath).mtimeMs };

		// ---- 3. Reconcile ----------------------------------------------------------
		// The files were copied first and the database second, so anything uploaded in
		// between exists in the database's world but not in the copy. Ask the snapshot what
		// it claims to own and fetch whatever is missing.
		report('Checking the copy', planned.length);
		const snapshotDb = new Database(snapshotDbPath, { readonly: true });
		let claimed: Set<string>;
		let summary;
		let imageCount = 0;
		let presetCount = 0;
		try {
			claimed = referencedImagePaths(snapshotDb);
			// Preset covers are named inside the preset documents rather than in any table,
			// so they would fall outside a database-only reconcile entirely.
			for (const rel of planned) {
				if (!rel.startsWith('presets/') || !rel.endsWith('.json')) continue;
				const file = join(tmpData, rel);
				if (!existsSync(file)) continue;
				try {
					for (const p of referencedImagePathsInText(await readFile(file, 'utf8'))) claimed.add(p);
				} catch {
					// Handled by the parse check below, which knows what to say about it.
				}
			}
			imageCount = (await walk(join(tmpData, 'images'))).filter((p) => !p.includes('/thumbnails/')).length;
			presetCount = planned.filter((p) => /^presets\/[^/]+\.json$/.test(p)).length;
			summary = summarize(snapshotDb, imageCount, presetCount);
		} finally {
			snapshotDb.close();
		}

		const fetchInto = async (rel: string): Promise<boolean> => {
			const src = join(dataDir, rel);
			// The SOURCE's stats, exactly as copyOne records them: the index is the record of
			// what was on disk, and `copyFile` does not carry mtime, so statting the copy
			// would make every reconciled file look changed to the next snapshot and cost a
			// full copy that hardlinking should have absorbed.
			let st;
			try {
				st = await stat(src);
			} catch {
				return false;
			}
			const dest = join(tmpData, rel);
			await mkdir(dirname(dest), { recursive: true });
			await copyFile(src, dest);
			index[rel] = { size: st.size, mtimeMs: st.mtimeMs };
			logical += st.size;
			onDisk += st.size;
			return true;
		};

		const missing = [...claimed].filter((rel) => !existsSync(join(tmpData, rel)));
		let unrecovered = 0;
		await mapLimit(missing, COPY_CONCURRENCY, async (rel) => {
			if (!(await fetchInto(rel))) {
				// Genuinely gone from disk: the database names a file nothing can produce.
				// That is a pre-existing hole in the live data, not one this snapshot made.
				unrecovered++;
				return;
			}
			// A late original arrives without the thumbnail the galleries draw, and a card
			// whose art is there but whose thumbnail is not reads as data loss. Fetched
			// silently: plenty of images never had one, and the server answers for those
			// with the original anyway (`resolveImageFile`).
			const thumb = thumbnailFor(rel);
			if (!existsSync(join(tmpData, thumb))) await fetchInto(thumb);
		});
		if (unrecovered > 0) {
			warnings.push(
				`${unrecovered} image${unrecovered === 1 ? '' : 's'} named by the database ${unrecovered === 1 ? 'was' : 'were'} already missing from this install and could not be included`
			);
		}

		// ---- 4. Are the documents readable? ----------------------------------------
		// Preset files are written without a temp-and-rename, so a copy taken mid-save can
		// catch half a file. Half a preset makes the whole preset
		// list fail to load after a restore, so the copy is parsed here and retried once.
		const documents = planned.filter((p) => p.endsWith('.json'));
		const torn: string[] = [];
		await mapLimit(documents, COPY_CONCURRENCY, async (rel) => {
			const dest = join(tmpData, rel);
			if (!existsSync(dest)) return;
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					JSON.parse(await readFile(dest, 'utf8'));
					return;
				} catch {
					if (attempt === 0 && existsSync(join(dataDir, rel))) {
						rmSync(dest, { force: true });
						await copyFile(join(dataDir, rel), dest);
					}
				}
			}
			torn.push(rel);
		});
		if (torn.length > 0) {
			warnings.push(
				`${torn.length} file${torn.length === 1 ? '' : 's'} could not be read back as valid JSON: ${torn.slice(0, 3).join(', ')}`
			);
		}
		if (!linkingSupported) {
			warnings.push(
				'This location cannot share unchanged files between snapshots, so each one stores full copies'
			);
		}

		// ---- 5. Seal it ------------------------------------------------------------
		const manifest: SnapshotManifest = {
			id,
			createdAt: startedAt.getTime(),
			kind,
			label: label?.trim() ? label.trim() : null,
			pinned: false,
			appVersion: APP_VERSION,
			schemaVersion: readSchemaVersion(snapshotDbPath),
			summary,
			bytes: { logical, onDisk },
			fileCount: Object.keys(index).length,
			linked: linkingSupported,
			warnings
		};
		writeIndex(outDir, index);
		writeManifest(outDir, manifest);
		// The commit: from here the folder is a snapshot, and one small file going is all it
		// takes to say so.
		rmSync(join(outDir, BUILDING_MARKER), { force: true });
		report('Done', planned.length);
		return manifest;
	} catch (error) {
		// Leave nothing half-built behind: the boot sweep is the net for a process that
		// died, not for a failure this one is standing right next to.
		rmSync(outDir, { recursive: true, force: true });
		throw error;
	}
}

function readSchemaVersion(dbPath: string): number {
	const db = new Database(dbPath, { readonly: true });
	try {
		const row = db.query('SELECT MAX(version) AS v FROM _migrations').get() as {
			v: number | null;
		} | null;
		return row?.v ?? 0;
	} finally {
		db.close();
	}
}

/**
 * Put the privacy markers in the backup store if it is already there. The store is created
 * by the first snapshot, and this runs at boot, so an install that has been backing up for
 * months gets them without waiting for its next job. It never creates the folder: an install
 * that never backs up grows no empty store.
 */
export function ensureBackupStoreMarkers(): void {
	const root = resolveBackupDir();
	if (existsSync(root)) ensurePrivacyMarkers(root, 'backups');
}

/**
 * Remove snapshots a process died in the middle of. Boot-time only, where nothing else can
 * be writing one. Keyed on the marker rather than on a missing manifest, so a folder
 * somebody put here by hand is left exactly where they put it.
 */
export function sweepAbandonedSnapshots(): number {
	const root = resolveBackupDir();
	if (!existsSync(root)) return 0;
	let removed = 0;
	for (const name of readdirSync(root)) {
		if (!existsSync(join(root, name, BUILDING_MARKER))) continue;
		rmSync(join(root, name), { recursive: true, force: true });
		removed++;
	}
	return removed;
}
