<script lang="ts" module>
	import type { SettingsPage } from '#lib/config/settings-pages.ts';

	interface NavEntry {
		page: SettingsPage;
		/** Connection id while the entry is the connection editor (null = list view). */
		connectionId: string | null;
		/** Model id while the entry is the in-place Provider Routing sub-view. */
		routing: string | null;
		/** Engine id while the entry is the Engines-page detail view (null = overview). */
		engineId: string | null;
	}

	// Pane history for the back/forward pair, scoped to ONE page: the stack holds
	// only the sub-views of the page currently open (connection list ← editor ←
	// routing, engine list ← detail) and is thrown away the moment another page
	// opens, so the pair can never walk out of the page its header names. Module
	// level so it survives the panel unmounting at root and the dock closing, the
	// same "reopens where it was left" doctrine as settingsPage itself.
	const HISTORY_CAP = 50;
	let entries = $state<NavEntry[]>([]);
	let cursor = $state(-1);
	// Raised while back/forward write nav state, so the recorder effect doesn't
	// re-push the step it is replaying.
	let applying = false;
</script>

<script lang="ts">
	import { panelActivity } from '#lib/components/ui/panelActivity.ts';
	import Icon from '#lib/components/ui/Icon.svelte';
	import SettingsPageView from './SettingsPageView.svelte';
	import { uiStore } from '#lib/stores/ui.svelte.ts';
	import { SETTINGS_GROUPS } from '#lib/config/settings-pages.ts';
	import { connectionStore } from '#lib/stores/connections.svelte.ts';
	import { ENGINES } from '#lib/engines/registry.ts';

	const panelActive = panelActivity();
	// The split-view page surface: the Settings dock keeps the root list while the
	// selected page opens here, wide and centered over the chat, the Library entry
	// editor's pattern. Workspace mounts this only while the dock is in split view
	// and a page is selected (uiStore.settingsPage !== 'root').
	const page = $derived(uiStore.settingsPage as SettingsPage);
	const connectionId = $derived(uiStore.settingsConnectionId);
	const routing = $derived(uiStore.settingsRoutingModel);
	const engineId = $derived(uiStore.settingsEngineId);

	const info = $derived.by(() => {
		if (routing) return { group: 'Connection', label: 'Provider routing' };
		if (connectionId) return { group: 'Connections', label: connectionStore.get(connectionId)?.name ?? 'Connection' };
		if (engineId) return { group: 'Engines', label: ENGINES.find((e) => e.id === engineId)?.name ?? 'Engine' };
		for (const group of SETTINGS_GROUPS) {
			const row = group.rows.find((r) => r.page === page);
			if (row) return { group: group.label, label: row.label };
		}
		return null;
	});

	// Record every pane this panel lands on (row clicks, deep links, the connection
	// editor, the routing sub-view), except the steps back/forward themselves replay.
	$effect(() => {
		// Never record 'root': the panel is being dismissed and unmounts with it.
		if (!panelActive() || uiStore.settingsPage === 'root') return;
		const entry: NavEntry = { page, connectionId, routing, engineId };
		if (applying) {
			applying = false;
			return;
		}
		const current = entries[cursor];
		if (
			current &&
			current.page === entry.page &&
			current.connectionId === entry.connectionId &&
			current.routing === entry.routing &&
			current.engineId === entry.engineId
		)
			return;
		// A different page is a fresh stack, never an appended step: this is what
		// keeps the pair inside one page, and it drops the forward half of the page
		// being left behind with it.
		if (!current || current.page !== entry.page) {
			entries = [entry];
			cursor = 0;
			return;
		}
		const start = Math.max(0, cursor + 1 - (HISTORY_CAP - 1));
		entries = [...entries.slice(start, cursor + 1), entry];
		cursor = entries.length - 1;
	});

	const canBack = $derived(cursor > 0);
	const canForward = $derived(cursor < entries.length - 1);

	function applyEntry(entry: NavEntry): void {
		applying = true;
		// Bare writes on purpose: replaying an entry restores ALL FOUR fields;
		// gotoSettingsPage would wipe the editor/routing/engine halves of an entry.
		uiStore.settingsPage = entry.page;
		uiStore.settingsConnectionId = entry.connectionId;
		uiStore.settingsRoutingModel = entry.routing;
		uiStore.settingsEngineId = entry.engineId ?? null;
	}

	function goBack(): void {
		if (!canBack) return;
		cursor -= 1;
		applyEntry(entries[cursor]);
	}

	function goForward(): void {
		if (!canForward) return;
		cursor += 1;
		applyEntry(entries[cursor]);
	}

	/** The same exit Escape's step-back reaches: close this panel, keep the dock. */
	function close(): void {
		uiStore.gotoSettingsPage('root');
	}
</script>

<div class="content-root">
	<header class="overlay-header">
		<!-- Always visible; both halves sit grayed on a page with no sub-views. -->
		<div class="nav-pair">
			<button
				type="button"
				class="icon-btn"
				disabled={!canBack}
				onclick={goBack}
				aria-label="Back"
				title="Back"
			>
				<Icon name="chevronLeft" class="w-4 h-4" strokeWidth={2} />
			</button>
			<button
				type="button"
				class="icon-btn"
				disabled={!canForward}
				onclick={goForward}
				aria-label="Forward"
				title="Forward"
			>
				<Icon name="chevronRight" class="w-4 h-4" strokeWidth={2} />
			</button>
		</div>
		<div class="overlay-crumb">
			{#if info}
				<span class="overlay-crumb-label">{info.group}</span>
				<span class="overlay-crumb-sep" aria-hidden="true">/</span>
			{/if}
			<h2 class="overlay-subject">{info?.label ?? ''}</h2>
		</div>
		<div class="overlay-actions">
			<button type="button" class="icon-btn" onclick={close} aria-label="Close" title="Close">
				<Icon name="x" class="w-4 h-4" strokeWidth={2} />
			</button>
		</div>
	</header>

	<!-- Keyed so switching rows (or entering/leaving the editor / routing / engine
	     detail) remounts the page fresh: scroll to top, remount semantics identical
	     to the drill-down's. -->
	{#key `${page}:${connectionId ?? ''}:${routing ?? ''}:${engineId ?? ''}`}
		<div class="content-scroll panel-scroll">
			<div class="content-body">
				<SettingsPageView {page} />
			</div>
		</div>
	{/key}
</div>

<style>
	.content-root {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	/* Pill track around the pair so it reads as one control instead of two stray
	   icons floating in the header. */
	.nav-pair {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
	}

	/* Inside the pill the buttons follow its shape (the .icon-btn recipe is a
	   2.15rem radius-md square, too chunky for a track this tight). */
	.nav-pair .icon-btn {
		width: 1.7rem;
		height: 1.7rem;
		border-radius: var(--radius-full);
	}

	/* The pair is a fixture: always rendered, grayed at the ends of the history
	   (the .icon-btn recipe carries no disabled state of its own). */
	.icon-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.icon-btn:disabled:hover {
		color: var(--color-text-muted);
		background: transparent;
	}

	/* .panel-scroll in markup owns the overflow and the reserved gutter. */
	.content-scroll {
		flex: 1;
		min-height: 0;
		overscroll-behavior: contain;
		padding: clamp(0.65rem, 0.5rem + 0.75vw, 1rem);
	}

	/* The same cap the drill-down panel gives its content: settings pages are column
	   forms and would stretch gracelessly across the whole chat column. One measure
	   so a page reads identically either way. Like .settings-content, this is a
	   measure only. The surfaces are this overlay panel and the page's own cards;
	   nothing in between (see SettingsPanel.svelte for why). */
	.content-body {
		max-width: var(--settings-measure);
		margin: 0 auto;
	}
</style>
