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
import { memoryStore } from '$lib/memory/store.svelte';
import { backupStore } from '$lib/stores/backups.svelte';
import type { SyncScope } from '$shared/sync';

let started = false;
let queue: Promise<void> = Promise.resolve();

export function initSync(): void {
	if (started) return;
	started = true;

	// The server emits hints in mutation order and some scopes depend on it (a
	// `presets` hint lands the preset a following `settings` hint activates), so
	// apply them one at a time instead of racing the reloads. handleScope catches
	// its own errors, so the chain never breaks.
	onSync((scope) => {
		queue = queue.then(() => handleScope(scope));
	});

	// Hints are fire-and-forget: the server keeps no per-device queue, so everything
	// broadcast while this device's socket was down is simply gone. A reconnect therefore
	// re-reads everything rather than resuming. Without it a laptop that slept through a
	// batch of changes stays stale until the user reloads the page by hand.
	onReconnect(() => {
		queue = queue.then(resyncAll);
	});
}

/**
 * What each scope reloads. Typed `Record<SyncScope, …>`, so a scope the server can
 * broadcast (shared/sync.ts) but this device cannot apply is a compile error. The old
 * `switch` just fell through and left the other device stale.
 *
 * Declaration order is the order `resyncAll` replays in, so scopes that feed another one
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
		await personaStore.syncReload();
		await presetControlsStore.syncReload();
		// Every store that rides the synced-setting primitive (theme,
		// view prefs, …) re-reads here, so a setting changed on one
		// device shows up live on the others instead of only on next boot.
		await reloadAllSyncedSettings();
	},
	// A composer draft changed on another device; only the open chat's matters
	// here. The rest are read when their chat opens.
	drafts: () => inputDraftStore.syncReload(chatStore.activeChatId),
	inputHistory: () => inputHistoryStore.reload(),
	// Another device folded/rolled back/edited the open chat's memory, so refresh
	// the panel data and ghost boundary.
	memory: () => memoryStore.syncReload(),
	// A snapshot finished, was pinned or was deleted. A no-op unless the Backups page
	// has been opened on this device.
	backups: () => backupStore.syncReload()
};

/** Re-read every scope, in declaration order. The reconnect path: cheaper than a page
 *  reload and it keeps the open chat, drafts and scroll position where they are. */
async function resyncAll(): Promise<void> {
	for (const scope of Object.keys(HANDLERS) as SyncScope[]) {
		await handleScope(scope);
	}
}

async function handleScope(scope: string): Promise<void> {
	const handler = HANDLERS[scope as SyncScope];
	// An unknown scope means the server broadcast something this build has no handler for:
	// a version skew across devices. Say so instead of dropping it silently.
	if (!handler) {
		console.error(`[sync] no handler for scope "${scope}", ignoring`);
		return;
	}
	try {
		await handler();
	} catch (error) {
		console.error(`[sync] failed to apply scope "${scope}":`, error);
	}
}
