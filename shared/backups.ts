/**
 * The backup vocabulary, shared by the server that writes snapshots and the settings page
 * that reads them. Dependency-free like everything else in `shared/`: no DOM, no Bun.
 */

/**
 * Why a snapshot exists. It decides the retention class it falls into and the words its
 * row uses, and it is stamped once at creation. Nothing ever reclassifies a snapshot.
 */
export type SnapshotKind = 'manual' | 'scheduled' | 'preUpgrade' | 'preRestore' | 'imported';

/** The kinds an imported portable archive may have had on its source installation. */
export type SourceSnapshotKind = Exclude<SnapshotKind, 'imported'>;

/** What the snapshot holds, counted while it is taken so no listing has to open a database. */
export interface SnapshotSummary {
	chats: number;
	messages: number;
	characters: number;
	personas: number;
	lorebooks: number;
	presets: number;
	images: number;
}

export interface SnapshotBytes {
	/** What the snapshot's contents weigh, counting every file at full size. */
	logical: number;
	/** What it actually added to the disk: hardlinked files cost nothing here. */
	onDisk: number;
}

export interface SnapshotManifest {
	/** The folder name, which is also its sort key: lexical order is chronological. */
	id: string;
	createdAt: number;
	kind: SnapshotKind;
	/** A note the reader typed when taking it by hand. */
	label: string | null;
	/** Pinned snapshots are never pruned, whatever their kind. */
	pinned: boolean;
	/** The build that wrote it, so a snapshot found on disk says which app produced it. */
	appVersion: string;
	/**
	 * The database schema this snapshot holds. Restoring one NEWER than the running app
	 * is refused: migrations only run forward, so the app cannot read its own future.
	 */
	schemaVersion: number;
	summary: SnapshotSummary;
	bytes: SnapshotBytes;
	fileCount: number;
	/**
	 * False when the store could not share unchanged files with the previous snapshot
	 * (a filesystem without hardlinks: exFAT, most network shares). The snapshot is
	 * complete either way, it just cost its full size, and the page says so.
	 */
	linked: boolean;
	/** Anything the snapshot could not guarantee, stated on its row rather than swallowed. */
	warnings: string[];
	/** Present only after a portable archive is imported. Kept for provenance while `kind`
	 *  becomes `imported`, so it cannot affect this installation's backup schedule. */
	sourceKind?: SourceSnapshotKind;
}

/** How often unattended snapshots are taken. Hours, so the timer needs no calendar. */
export const BACKUP_INTERVALS = [6, 24, 168] as const;
export type BackupInterval = (typeof BACKUP_INTERVALS)[number];

export interface BackupSettings {
	/** Whether the schedule runs at all. Manual snapshots work regardless. */
	automatic: boolean;
	intervalHours: BackupInterval;
	/** Recent scheduled snapshots kept whole before thinning starts. */
	keepScheduled: number;
	/** Before-upgrade snapshots kept. Older ones are pruned unless pinned. */
	keepUpgrade: number;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
	automatic: true,
	intervalHours: 24,
	keepScheduled: 10,
	keepUpgrade: 5
};

export const KEEP_SCHEDULED_RANGE = { min: 3, max: 50 } as const;
export const KEEP_UPGRADE_RANGE = { min: 1, max: 20 } as const;

/**
 * Thinning past `keepScheduled`, in fixed steps rather than knobs: one snapshot a week for
 * the first stretch, one a month after that, nothing beyond the last. Those two numbers
 * are what makes a year of history affordable, and they are not worth a control apiece.
 */
export const THIN_WEEKLY_WEEKS = 8;
export const THIN_MONTHLY_MONTHS = 12;

/** What a job is doing right now. One job runs at a time, server-wide. */
export interface BackupJobState {
	kind: 'snapshot' | 'restore' | 'export' | 'import';
	/** The snapshot being written, or the one being restored from. */
	snapshotId: string;
	/** One short sentence for the row: what is happening now. */
	phase: string;
	filesDone: number;
	filesTotal: number;
	startedAt: number;
}

/** Stable wrapper stored at the root of a portable backup ZIP. */
export interface PortableBackupEnvelope {
	format: 'chungushub-backup';
	formatVersion: 1;
	exportedAt: number;
	snapshot: SnapshotManifest;
}

export const PORTABLE_BACKUP_FORMAT = 'chungushub-backup' as const;
export const PORTABLE_BACKUP_VERSION = 1 as const;

export interface BackupsPayload {
	snapshots: SnapshotManifest[];
	job: BackupJobState | null;
	/** The folder snapshots are written to, shown so the reader can find them. */
	location: string;
	/** Sum of what the snapshots actually occupy, sharing counted once. */
	totalBytes: number;
	/**
	 * The last job failure, held until the next job starts. A failed backup is a condition
	 * rather than an event: the page has to keep saying so after the toast has gone.
	 */
	lastError: string | null;
}

/** Restore refuses a snapshot the running app is too old to read. */
export function restoreBlockedReason(
	manifest: SnapshotManifest,
	appSchemaVersion: number
): string | null {
	if (manifest.schemaVersion > appSchemaVersion) {
		return `This snapshot was written by a newer version of ChungusHub (database format ${manifest.schemaVersion}, this app reads up to ${appSchemaVersion}). Update the app, then restore it.`;
	}
	return null;
}
