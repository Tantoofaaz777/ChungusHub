/**
 * Reading and writing what a snapshot says about itself.
 *
 * Two documents sit beside the mirrored data. `manifest.json` is small, describes the
 * snapshot and is what the settings page lists. `index.json` is the size-and-mtime record
 * of every file the snapshot holds, and exists so the NEXT snapshot can tell an unchanged
 * file from a replaced one. It stays on disk and never rides the API, because a large
 * library puts tens of thousands of entries in it.
 */
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBackupDir } from '../config';
import type { SnapshotManifest } from '../../shared/backups';
import { BUILDING_MARKER, MANIFEST_FILE, manifestPath, snapshotPath } from './paths';

export interface IndexEntry {
	size: number;
	mtimeMs: number;
}
/** Relative path inside the snapshot's `data/` to the stats of the file it was taken from. */
export type SnapshotIndex = Record<string, IndexEntry>;

const INDEX_FILE = 'index.json';

/**
 * Written straight out, no temp-and-rename, and that is safe rather than sloppy: both of
 * these are written while the folder still carries its `.building` marker, so a torn one is
 * swept whole at the next boot and never listed. A rename here would buy nothing and cost
 * the one operation Windows is least willing to complete on a folder full of files that
 * were written a second ago (see `BUILDING_MARKER`).
 */
export function writeManifest(dirAbs: string, manifest: SnapshotManifest): void {
	writeFileSync(join(dirAbs, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
}

export function writeIndex(dirAbs: string, index: SnapshotIndex): void {
	writeFileSync(join(dirAbs, INDEX_FILE), JSON.stringify(index, null, 2));
}

export function readIndex(id: string): SnapshotIndex | null {
	const path = join(snapshotPath(id), INDEX_FILE);
	if (!existsSync(path)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parsed as SnapshotIndex;
	} catch {
		// Only costs this snapshot its sharing: everything gets copied instead of linked.
		return null;
	}
}

/**
 * Type-check what came off disk rather than trusting it. A manifest is not a state file the
 * server runs on, so a bad one is not fatal. But it must not become a row either, because
 * every field here ends up in a sentence about what restoring will destroy.
 */
function parseManifest(raw: unknown, id: string): SnapshotManifest | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const m = raw as Record<string, unknown>;
	const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
	const createdAt = num(m.createdAt);
	const schemaVersion = num(m.schemaVersion);
	if (createdAt === null || schemaVersion === null) return null;
	if (!['manual', 'scheduled', 'preUpgrade', 'preRestore', 'imported'].includes(String(m.kind))) return null;
	const sourceKind = ['manual', 'scheduled', 'preUpgrade', 'preRestore'].includes(String(m.sourceKind))
		? (m.sourceKind as SnapshotManifest['sourceKind'])
		: undefined;
	const bytes = (m.bytes ?? {}) as Record<string, unknown>;
	const summary = (m.summary ?? {}) as Record<string, unknown>;
	const n = (v: unknown): number => num(v) ?? 0;
	return {
		// The folder is the identity. A manifest carrying someone else's id would put a
		// restore on the wrong data, so the name on disk always wins.
		id,
		createdAt,
		kind: m.kind as SnapshotManifest['kind'],
		label: typeof m.label === 'string' ? m.label : null,
		pinned: m.pinned === true,
		appVersion: typeof m.appVersion === 'string' ? m.appVersion : 'unknown',
		schemaVersion,
		summary: {
			chats: n(summary.chats),
			messages: n(summary.messages),
			characters: n(summary.characters),
			personas: n(summary.personas),
			lorebooks: n(summary.lorebooks),
			presets: n(summary.presets),
			images: n(summary.images)
		},
		bytes: { logical: n(bytes.logical), onDisk: n(bytes.onDisk) },
		fileCount: n(m.fileCount),
		linked: m.linked === true,
		warnings: Array.isArray(m.warnings) ? m.warnings.filter((w): w is string => typeof w === 'string') : [],
		...(sourceKind ? { sourceKind } : {})
	};
}

export function readManifest(id: string): SnapshotManifest | null {
	const path = manifestPath(id);
	if (!existsSync(path)) return null;
	try {
		return parseManifest(JSON.parse(readFileSync(path, 'utf8')), id);
	} catch {
		return null;
	}
}

export interface SnapshotListing {
	snapshots: SnapshotManifest[];
	/** Folders in the store that are not readable snapshots. Counted rather than hidden:
	 *  something occupying the disk under the backup folder has to be accounted for. */
	unreadable: number;
}

/** Newest first, which for these names is also reverse lexical order. */
export function listSnapshots(): SnapshotListing {
	const root = resolveBackupDir();
	if (!existsSync(root)) return { snapshots: [], unreadable: 0 };
	const snapshots: SnapshotManifest[] = [];
	let unreadable = 0;
	for (const name of readdirSync(root)) {
		let isDir = false;
		try {
			isDir = statSync(join(root, name)).isDirectory();
		} catch {
			continue;
		}
		if (!isDir) continue;
		// Still being written, or abandoned by a process that died. Not a snapshot yet and
		// not a fault either, so it is neither listed nor counted against anything.
		if (existsSync(join(root, name, BUILDING_MARKER))) continue;
		const manifest = readManifest(name);
		if (manifest) snapshots.push(manifest);
		else unreadable++;
	}
	snapshots.sort((a, b) => b.createdAt - a.createdAt);
	return { snapshots, unreadable };
}

/**
 * Rewrite one field of a stored manifest (pinning is the only caller). This one DOES go
 * through a temp and a rename, unlike the build-time writes above: it edits a snapshot that
 * is already committed and already listed, where a torn write would make a complete
 * snapshot unreadable and nothing would ever sweep it.
 */
export function patchManifest(id: string, patch: Partial<SnapshotManifest>): SnapshotManifest {
	const current = readManifest(id);
	if (!current) throw new Error(`No readable snapshot named "${id}".`);
	const next = { ...current, ...patch, id: current.id };
	const path = manifestPath(id);
	const temp = `${path}.tmp`;
	writeFileSync(temp, JSON.stringify(next, null, 2));
	renameSync(temp, path);
	return next;
}
