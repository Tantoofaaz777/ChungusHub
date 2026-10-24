/**
 * Live cross-device sync.
 *
 * The server broadcasts a coarse scope hint whenever any device mutates data.
 * Here we translate that hint into a targeted store reload so the change shows up
 * on every other open device within a moment of it happening.
 */
import { onSync, onReconnect } from '$lib/services/transport';
import { chatStore } from '$lib/stores/chat.svelte';
import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
import { lorebookStore } from '$lib/lorebook/store.svelte';
import { steeringStore } from '$lib/stores/steering.svelte';
import { chatCastStore } from '$lib/stores/chatCast.svelte';
import { personaStore } from '$lib/stores/persona.svelte';
import { presetControlsStore } from '$lib/stores/presetControls.svelte';
import { inputDraftStore } from '$lib/stores/inputDraft.svelte';
import { inputHistoryStore } from '$lib/stores/inputHistory.svelte';
import { presetService } from '$lib/services/presets.svelte';
import { reloadAllSyncedSettings } from '$lib/services/syncedSetting';
import { threadsStore } from '$lib/threads/store.svelte';
import { memoryStore } from '$lib/memory/scene-store.svelte';
import { backupStore } from '$lib/stores/backups.svelte';
import type { SyncScope } from '$shared/sync';
import { SyncBatch } from './sync-batch';

let started = false;

export function initSync(): void {
	if (started) return;
	started = true;

	batch.resume();
}

/**
 * What each scope reloads. Typed `Record<SyncScope, …>`, so a scope the server can
 * broadcast (shared/sync.ts) but this device cannot apply is a compile error. The old
 * `switch` just fell through and left the other device stale.
 *
 * Declaration order is the order the batch drains in, so scopes that feed another one
 * come first: `presets` must land the preset that `settings` then activates.
 */
const HANDLERS: Record<SyncScope, () => Promise<void>> = {
	chats: async () => {
		await chatStore.syncReload();
		await chatCastStore.load();
	},
	messages: async () => {
		await chatStore.syncReload();
		// A remote message may have changed which persona a chat was last written
		// with; refresh the index so this device's chat lists stay in step.
		await chatCastStore.load();
	},
	// Characters and personas (including their lorebook links) live here.
	library: () => characterLibraryStore.refresh(),
	lorebooks: () => lorebookStore.refresh(),
	// Another device wrote a steering note. The whole list is small, so refetch it
	// wholesale rather than diffing rows.
	steering: () => steeringStore.refresh(),
	presets: () => presetService.syncReload(),
	settings: async () => {
		// Global active persona + preset-control values are stored as settings.
		// Every store that rides the synced-setting primitive (theme,
		// view prefs, …) re-reads here, so a setting changed on one
		// device shows up live on the others instead of only on next boot.
		const results = await Promise.allSettled([
			personaStore.syncReload(), presetControlsStore.syncReload(), reloadAllSyncedSettings()
		]);
		const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
		if (errors.length) throw new AggregateError(errors, 'Some settings could not be synchronized');
	},
	// A composer draft changed on another device; only the open chat's matters
	// here. The rest are read when their chat opens.
	drafts: () => inputDraftStore.syncReload(chatStore.activeChatId),
	inputHistory: () => inputHistoryStore.reload(),
	// Refresh manual summaries and their coverage on the open path.
	memory: () => memoryStore.syncReload(),
	threads: () => threadsStore.syncReload(),
	// A snapshot finished, was pinned or was deleted. A no-op unless the Backups page
	// has been opened on this device.
	backups: () => backupStore.syncReload()
};

// Listen before boot opens its socket. Applying waits for initSync, so startup changes
// are retained without reloading every scope or racing the initial migration sequence.
const batch = new SyncBatch<SyncScope>(HANDLERS, reportFailure, { messages: 'chats' }, undefined, true);
onSync(scope => batch.enqueue(scope));
onReconnect(() => batch.reconnect());

function reportFailure(scope: string, ...failure: [unknown?]): void {
	if (failure.length === 0) {
		console.error(`[sync] no handler for scope "${scope}", ignoring`);
	} else {
		console.error(`[sync] failed to apply scope "${scope}":`, failure[0]);
	}
}
