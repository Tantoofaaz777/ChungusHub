/**
 * Synced settings primitive.
 *
 * The app's cross-device spine is the server `settings` key-value table: writing a
 * value broadcasts a coarse `{t:'sync', scope:'settings'}` hint, and every other
 * device re-reads. These helpers let any store ride that spine instead of leaking
 * to per-device localStorage: read/write a JSON value by key, and register a
 * reload that fires on every incoming `settings` broadcast.
 */
import { db } from '$lib/services/database';
import { toastStore } from '$lib/stores/toast.svelte';
import { settingsSync } from './settings-sync';
import { flushOnHide } from '$lib/utils/flush-on-hide';

/** Publish related settings together only while this read still owns their state. */
export function reloadSettings<T>(keys: string[], read: () => Promise<T>, apply: (value: T) => void): Promise<void> {
	return settingsSync.reload(keys, read, apply);
}

const reloaders = new Set<() => Promise<void>>();

/** Register a store's reload; invoked on every incoming `settings` sync broadcast.
 *  Returns a disposer: boot-time stores ignore it, a component that mounts and unmounts
 *  must call it or its dead closure keeps reloading. */
export function registerSettingsReload(fn: () => Promise<void>): () => void {
	reloaders.add(fn);
	return () => {
		reloaders.delete(fn);
	};
}

/** Re-read every registered synced setting. Called from sync.ts on `settings` scope. */
export async function reloadAllSyncedSettings(): Promise<void> {
	const results = await Promise.allSettled([...reloaders].map((fn) => Promise.resolve().then(fn)));
	const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
	if (errors.length) throw new AggregateError(errors, 'Some settings could not be refreshed');
}

/** Read a JSON-encoded setting, falling back on missing or corrupt values. */
export async function readSetting<T>(key: string, fallback: T): Promise<T> {
	const raw = await db.getSetting(key);
	if (raw == null) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

/** Persist a setting as JSON. This is the write that triggers the `settings` broadcast. */
export function writeSetting(key: string, value: unknown): Promise<void> {
	return db.setSetting(key, JSON.stringify(value)).catch((error) => {
		// The store already moved, so a silent failure means this device shows a value no
		// other device (and not the next boot) will ever agree with. Say it out loud.
		console.error(`[settings] write failed for "${key}":`, error);
		toastStore.error(`Couldn't save "${key}". The change is on screen but not stored.`);
	});
}

/**
 * One settings key, written at most once per burst.
 *
 * Every write is an HTTP round trip AND a broadcast that every other device answers by
 * re-reading every synced setting it holds, so a slider firing an input event per pointer
 * move costs far more than the value it carries. Nothing waits on this: the store's own
 * state is what the screen reads, so the drag stays live either way.
 *
 * For a knob whose every value is worth keeping, write straight through instead. This is
 * for one where only where the finger stops matters.
 */
export class BurstSettingWriter<T> {
	private pending: { value: T } | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly key: string,
		private readonly delayMs = 250
	) {
		flushOnHide(() => { void this.flush(); });
	}

	/** True while a write is still owed. A reload landing now would hand the reader back
	 *  a value older than the one they are looking at. */
	get busy(): boolean {
		return this.pending !== null;
	}

	write(value: T): void {
		settingsSync.changed(this.key);
		this.pending = { value };
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), this.delayMs);
	}

	private async flush(): Promise<void> {
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		const write = this.pending;
		if (!write) return;
		await writeSetting(this.key, write.value);
		// Only drop what actually went out: a drag that carried on during the round trip
		// left a newer value here, and clearing it would lose the end of the drag.
		if (this.pending === write) this.pending = null;
	}
}
