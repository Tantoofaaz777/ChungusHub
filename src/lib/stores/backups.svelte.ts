import {
	cancelRestore,
	deleteBackups,
	getBackups,
	importBackupArchive,
	pinBackup,
	prepareBackupExport,
	startBackup,
	startRestore
} from '$lib/services/transport';
import { readSetting, registerSettingsReload, writeSetting } from '$lib/services/syncedSetting';
import {
	BACKUP_INTERVALS,
	DEFAULT_BACKUP_SETTINGS,
	KEEP_SCHEDULED_RANGE,
	KEEP_UPGRADE_RANGE,
	type BackupInterval,
	type BackupJobState,
	type BackupSettings,
	type SnapshotManifest
} from '$shared/backups';

/**
 * The Backups page's state, in two halves that do not mix.
 *
 * The SETTINGS ride the settings spine like every other preference, so the schedule a
 * phone sets is the schedule the desktop keeps. The server reads the same row to run its
 * timer, which is why `normalize` here and the server's copy have to agree on the clamps
 * (architecture/backups.md coupling 2).
 *
 * The LISTING is server state and is fetched, never cached across sessions. It refreshes on
 * the `backups` sync scope so another device's snapshot appears, and polls only while a job
 * is actually running. A snapshot is a few times a day, and a page that polls when nothing
 * is happening is a page that wakes a sleeping phone for nothing.
 */

const SETTINGS_KEY = 'backupSettings';
const POLL_MS = 1500;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

/** A corrupt blob degrades to defaults, as everywhere on the settings spine. */
function normalize(raw: Partial<BackupSettings> | null): BackupSettings {
	return {
		automatic: typeof raw?.automatic === 'boolean' ? raw.automatic : DEFAULT_BACKUP_SETTINGS.automatic,
		intervalHours: BACKUP_INTERVALS.includes(raw?.intervalHours as BackupInterval)
			? (raw!.intervalHours as BackupInterval)
			: DEFAULT_BACKUP_SETTINGS.intervalHours,
		keepScheduled: clamp(
			raw?.keepScheduled,
			KEEP_SCHEDULED_RANGE.min,
			KEEP_SCHEDULED_RANGE.max,
			DEFAULT_BACKUP_SETTINGS.keepScheduled
		),
		keepUpgrade: clamp(
			raw?.keepUpgrade,
			KEEP_UPGRADE_RANGE.min,
			KEEP_UPGRADE_RANGE.max,
			DEFAULT_BACKUP_SETTINGS.keepUpgrade
		)
	};
}

class BackupStore {
	settings = $state<BackupSettings>({ ...DEFAULT_BACKUP_SETTINGS });
	snapshots = $state<SnapshotManifest[]>([]);
	job = $state<BackupJobState | null>(null);
	location = $state('');
	totalBytes = $state(0);
	lastError = $state<string | null>(null);
	/** The snapshot a claimed restore will apply on the next launch, if there is one. */
	restorePending = $state<string | null>(null);
	/** The newest database format this build reads; a snapshot past it cannot be restored. */
	schemaVersion = $state(0);
	/** True once the listing has been fetched at least once, so the page can tell an empty
	 *  store from one it has not looked at yet. */
	loaded = $state(false);

	private poll: ReturnType<typeof setInterval> | null = null;
	private open = false;

	/** Settings only: cheap, and the root row's preview needs them before the page opens. */
	async initialize(): Promise<void> {
		this.settings = normalize(await readSetting<Partial<BackupSettings> | null>(SETTINGS_KEY, null));
		registerSettingsReload(() => this.reloadSettings());
	}

	async reloadSettings(): Promise<void> {
		this.settings = normalize(await readSetting<Partial<BackupSettings> | null>(SETTINGS_KEY, null));
	}

	/** Called when the page mounts. The matching `close()` stops the polling. */
	async load(): Promise<void> {
		this.open = true;
		await this.refresh();
	}

	close(): void {
		this.open = false;
		this.stopPolling();
	}

	/** The `backups` sync scope. A no-op unless the page has been opened. */
	async syncReload(): Promise<void> {
		if (!this.open) return;
		await this.refresh();
	}

	async refresh(): Promise<void> {
		const payload = await getBackups();
		this.snapshots = payload.snapshots;
		this.job = payload.job;
		this.location = payload.location;
		this.totalBytes = payload.totalBytes;
		this.lastError = payload.lastError;
		this.restorePending = payload.restorePending;
		this.schemaVersion = payload.schemaVersion;
		this.loaded = true;
		// Poll only while something is running. The job outlives this page, so the state it
		// is in has to be re-read rather than remembered.
		if (this.job && this.open) this.startPolling();
		else this.stopPolling();
	}

	private startPolling(): void {
		if (this.poll) return;
		this.poll = setInterval(() => {
			void this.refresh().catch(() => {
				// A restore stops answering by design; the standing outage row already says
				// the server is unreachable, and this page has nothing to add to it.
			});
		}, POLL_MS);
	}

	private stopPolling(): void {
		if (!this.poll) return;
		clearInterval(this.poll);
		this.poll = null;
	}

	async snapshotNow(label: string | null): Promise<void> {
		await startBackup(label);
		await this.refresh();
	}

	async restore(id: string): Promise<void> {
		await startRestore(id);
		await this.refresh();
	}

	async exportPortable(id: string): Promise<{ url: string; filename: string }> {
		return prepareBackupExport(id);
	}

	async importPortable(file: File): Promise<SnapshotManifest> {
		const manifest = await importBackupArchive(file);
		await this.refresh();
		return manifest;
	}

	/** Withdraws the claimed restore. Nothing to undo: the claim destroyed nothing yet. */
	async cancelPendingRestore(): Promise<void> {
		await cancelRestore();
		await this.refresh();
	}

	async remove(ids: string[]): Promise<number> {
		const removed = await deleteBackups(ids);
		await this.refresh();
		return removed;
	}

	async setPinned(id: string, pinned: boolean): Promise<void> {
		await pinBackup(id, pinned);
		await this.refresh();
	}

	setAutomatic(on: boolean): void {
		this.settings.automatic = on;
		this.persist();
	}

	setInterval(hours: BackupInterval): void {
		this.settings.intervalHours = hours;
		this.persist();
	}

	setKeepScheduled(count: number): void {
		this.settings.keepScheduled = clamp(
			count,
			KEEP_SCHEDULED_RANGE.min,
			KEEP_SCHEDULED_RANGE.max,
			DEFAULT_BACKUP_SETTINGS.keepScheduled
		);
		this.persist();
	}

	setKeepUpgrade(count: number): void {
		this.settings.keepUpgrade = clamp(
			count,
			KEEP_UPGRADE_RANGE.min,
			KEEP_UPGRADE_RANGE.max,
			DEFAULT_BACKUP_SETTINGS.keepUpgrade
		);
		this.persist();
	}

	private persist(): void {
		writeSetting(SETTINGS_KEY, this.settings);
	}
}

export const backupStore = new BackupStore();
