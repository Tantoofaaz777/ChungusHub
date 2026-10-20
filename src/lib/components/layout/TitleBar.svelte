<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { shortcutLabel } from '$lib/components/ui/ShortcutsSheet.svelte';
	import MemoryNavStatus from '$lib/components/memory/MemoryNavStatus.svelte';
	import { uiStore, type OverlayType } from '$lib/stores/ui.svelte';
	import { lorebookStore } from '$lib/lorebook/store.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { memoryStore } from '$lib/memory/scene-store.svelte';
	import { promptTokensStore } from '$lib/stores/promptTokens.svelte';

	let activeOverlay = $derived(uiStore.activeOverlay);
	let settingsOpen = $derived(uiStore.settingsOpen);
	let settingsLocked = $derived(uiStore.settingsLocked);
	let libraryOpen = $derived(uiStore.libraryOpen);
	let libraryLocked = $derived(uiStore.libraryLocked);
	// Pinning only matters for a side dock; below the dock width both panels are
	// centered overlays, so the pin is hidden and does nothing on mobile/narrow.
	let canDock = $derived(viewport.canDockSettings);

	const flush = () => lorebookStore.flush();

	const shortcut = shortcutLabel;

	function handleToggleOverlay(overlay: OverlayType) {
		// Toggle: clicking the active button again closes the panel.
		uiStore.toggleOverlay(overlay, flush);
	}

	// The centred navigation cluster: each opens a chat-area overlay. Characters, Personas
	// and Lorebooks all moved into the merged Library dock (the right pill, which reopens on
	// the shelf you left it on); Chats is reached from the composer's hamburger menu.
	type NavItem = {
		overlay: OverlayType;
		icon: 'sliders' | 'brain' | 'threads';
		title: string;
	};

	const NAV: NavItem[] = [
		{ overlay: 'presetControls', icon: 'sliders', title: 'Preset Controls' },
		{ overlay: 'memory', icon: 'brain', title: 'Memory' },
		{ overlay: 'threads', icon: 'threads', title: 'Threads' }
	];

	const nav = NAV;

	// Requested generation and summaries needing review share the panel's status.
	let memoryStanding = $derived(memoryStore.standing);
	function titleFor(item: NavItem): string {
		if (item.overlay !== 'memory' || memoryStanding.kind === 'idle') return item.title;
		return `${item.title} · ${memoryStanding.label}`;
	}
</script>

<header class="title-bar">
	<div class="title-bar-inner">
		<div class="nav-group nav-group-start">
			<div class="overlay-split" class:is-open={settingsOpen}>
				<button
					type="button"
					class="overlay-split-main"
					class:is-open={settingsOpen}
					aria-label={settingsOpen ? `Close Settings (${shortcut(',')})` : `Settings (${shortcut(',')})`}
					title={settingsOpen ? `Close Settings (${shortcut(',')})` : `Settings (${shortcut(',')})`}
					onclick={() => uiStore.toggleSettings(flush)}
				>
					<Icon name="settings" class="w-3.5 h-3.5" />
				</button>
				{#if canDock}
					<button
						type="button"
						class="overlay-split-lock"
						class:is-locked={settingsLocked}
						aria-pressed={settingsLocked}
						title={settingsLocked ? 'Pinned open. Click to unpin' : 'Pin open (ignores click-away and other panels)'}
						onclick={() => uiStore.toggleSettingsLock()}
					>
						<Icon name="pin" class="w-4 h-4" />
					</button>
				{/if}
			</div>
		</div>

		<div class="nav-cluster">
			{#each nav as item (item.overlay)}
				<button
					type="button"
					class="overlay-btn"
					class:is-active-tint={activeOverlay === item.overlay}
					title={titleFor(item)}
					aria-label={titleFor(item)}
					onclick={() => handleToggleOverlay(item.overlay)}
				>
					{#if item.overlay === 'memory'}
						<MemoryNavStatus icon={item.icon} />
					{:else}
						<Icon name={item.icon} class="w-3.5 h-3.5" />
					{/if}
				</button>
			{/each}
		</div>

		<div class="nav-group nav-group-end">
			<button
				type="button"
				class="overlay-btn"
				class:is-active-tint={uiStore.debugPanelOpen}
				class:has-warning={!!promptTokensStore.warning}
				title={promptTokensStore.warning ? `Prompt Debug · ${promptTokensStore.warning}` : 'Prompt Debug'}
				aria-label={promptTokensStore.warning ? `Prompt Debug · ${promptTokensStore.warning}` : 'Prompt Debug'}
				aria-expanded={uiStore.debugPanelOpen}
				onclick={() => uiStore.toggleDebugPanel(flush)}
			>
				<Icon name="wrench" class="w-3.5 h-3.5" />
				{#if promptTokensStore.warning}<span class="prompt-warning"><Icon name="warning" class="w-2.5 h-2.5" /></span>{/if}
			</button>
			<div class="overlay-split" class:is-open={libraryOpen}>
				{#if canDock}
					<button
						type="button"
						class="overlay-split-lock"
						class:is-locked={libraryLocked}
						aria-pressed={libraryLocked}
						title={libraryLocked ? 'Pinned open. Click to unpin' : 'Pin open (ignores click-away and other panels)'}
						onclick={() => uiStore.toggleLibraryLock()}
					>
						<Icon name="pin" class="w-4 h-4" />
					</button>
				{/if}
				<button
					type="button"
					class="overlay-split-main"
					class:is-open={libraryOpen}
					aria-label={libraryOpen ? `Close Library (${shortcut('L')})` : `Library (${shortcut('L')})`}
					title={libraryOpen ? `Close Library (${shortcut('L')})` : `Library (${shortcut('L')})`}
					onclick={() => uiStore.toggleLibrary(flush)}
				>
					<Icon name="bookOpen" class="w-3.5 h-3.5" />
				</button>
			</div>
		</div>
	</div>
</header>

<style>
	.title-bar {
		position: relative;
		/* Grow by the notch/status-bar inset; the content row stays 2.5rem. */
		height: calc(2.5rem + env(safe-area-inset-top, 0px));
		padding-top: env(safe-area-inset-top, 0px);
		flex-shrink: 0;
		background: color-mix(in srgb, var(--color-bg-secondary) 87%, transparent);
		border-bottom: 1px solid var(--color-border-subtle);
		isolation: isolate;
		overflow: visible;
		z-index: 80;
	}

	.title-bar-inner {
		/* Capped at the chat column so the end buttons follow the dock edges. */
		height: 100%;
		max-width: var(--chat-col-max);
		margin: 0 auto;
		padding: 0 0.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		-webkit-app-region: no-drag;
	}

	.nav-group {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		flex-shrink: 0;
	}

	/* The centered navigation cluster uses icons at every viewport width. */
	.nav-cluster {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.overlay-btn {
		/* Anchors the Memory button's status indicator, which is absolutely positioned so the
		   cluster's geometry never depends on what memory is doing. */
		position: relative;
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-text-secondary);
		height: 1.8rem;
		border-radius: var(--radius-md);
		padding: 0 0.5rem;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
		-webkit-app-region: no-drag;
	}

	.overlay-btn:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
		color: var(--color-text-primary);
	}

	/* Scoped active tint: the canonical .is-active-tint recipe is in a cascade layer,
	   so this unlayered scoped base would otherwise override it. Placed after :hover so
	   the open overlay's button stays tinted while hovered. */
	.overlay-btn.is-active-tint {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 33%, transparent);
	}

	.overlay-btn.has-warning { color: var(--color-warning); }
	.prompt-warning { position: absolute; top: -2px; right: -2px; display: inline-flex; color: var(--color-warning); }

	/* Settings and Library are split pills: each has a main toggle plus a lock segment
	   that pins the panel open. */
	.overlay-split {
		display: inline-flex;
		align-items: stretch;
		height: 1.8rem;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		overflow: hidden;
		color: var(--color-text-secondary);
		transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
		-webkit-app-region: no-drag;
	}

	.overlay-split.is-open {
		border-color: color-mix(in srgb, var(--color-accent) 32%, transparent);
	}

	.overlay-split-main.is-open {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-accent);
	}

	.overlay-split-main,
	.overlay-split-lock {
		border: 0;
		background: transparent;
		color: inherit;
		display: inline-flex;
		align-items: center;
		cursor: pointer;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 600;
		white-space: nowrap;
		transition: background-color 140ms ease, color 140ms ease;
		-webkit-app-region: no-drag;
	}

	.overlay-split-main {
		gap: 0.35rem;
		padding: 0 0.5rem;
	}

	.overlay-split-lock {
		padding: 0 0.42rem;
		color: var(--color-text-muted);
	}

	.overlay-split-lock:last-child {
		border-left: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
	}

	.overlay-split-lock:first-child {
		border-right: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
	}

	.overlay-split-main:hover,
	.overlay-split-lock:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
		color: var(--color-text-primary);
	}

	.overlay-split-lock.is-locked {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	/* The pill clips its own rounded corners, and the app's focus ring is drawn OUTSIDE the
	   element it belongs to, so a ring on either half is cut down to the one sliver falling in
	   the seam between them: a bare vertical bar that says nothing about which button has the
	   keyboard. The ring goes on the PILL instead, which nothing clips and whose corners it
	   follows, and the half holding the keyboard says so with a wash of the same accent. Any
	   other control sitting tight inside a clipping box owes itself the same pair.

	   Last in the block, and both halves of that is deliberate: the wash has to beat the open
	   and pinned tints above it, and it touches only `background`, so a pinned pin keeps the
	   accent it says that with. */
	.overlay-split:has(:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.overlay-split-main:focus-visible,
	.overlay-split-lock:focus-visible {
		outline: none;
		background: color-mix(in srgb, var(--color-accent) 26%, transparent);
	}

</style>
