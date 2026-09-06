<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { promptLogStore } from '$lib/debug/promptLog.svelte';
	import {
		entryImages,
		formatDuration,
		formatPreciseTime,
		formatTime,
		messagesSize,
		promptSize,
		requestChips,
		sourceColor,
		statusColor,
		statusLabel
	} from '$lib/debug/format';
	import type { PromptLogEntry } from '$lib/debug/types';
	import CopyButton from './CopyButton.svelte';
	import PromptMessageCard from './PromptMessageCard.svelte';
	import PromptCompareView from './PromptCompareView.svelte';

	// Set by the /debug window, which IS the panel: nothing to pop out (it already is)
	// and nothing to close to. Closing the window is the way out.
	let { standalone = false }: { standalone?: boolean } = $props();

	let entries = $derived(promptLogStore.entries);
	let selected = $derived(promptLogStore.selected);
	let compareIds = $derived(promptLogStore.compareIds);

	let comparePair = $derived.by<[PromptLogEntry, PromptLogEntry] | null>(() => {
		if (compareIds.length !== 2) return null;
		const a = entries.find((e) => e.id === compareIds[0]);
		const b = entries.find((e) => e.id === compareIds[1]);
		return a && b ? [a, b] : null;
	});

	// One pane at a time on a phone: the list by default, the detail once an entry is
	// selected or a compare pair is complete. Picking the SECOND compare entry keeps
	// the list visible: that's where the pick happens.
	let mobileDetail = $derived(viewport.isMobile && (comparePair !== null || (compareIds.length !== 1 && selected !== null)));

	let rawView = $state(false);
	/** Position in `images` open in the full-size viewer; the panel owns the single instance.
	 *  The set is this request's own attachments, so paging never leaves the entry on screen. */
	let viewerIndex = $state<number | null>(null);

	/**
	 * Cards the user has toggled AWAY from their default: messages open by default. Scoped to the
	 * entry the keys belong to and re-derived when the selection moves, so switching entries
	 * can never carry another entry's state, and the fold-all control and each card's own
	 * chevron read the same one source.
	 */
	let foldStore = $state<{ id: string | null; keys: string[] }>({ id: null, keys: [] });
	let fold = $derived(
		foldStore.id === (selected?.id ?? null) ? foldStore : { id: selected?.id ?? null, keys: [] }
	);

	function toggled(key: string): boolean {
		return fold.keys.includes(key);
	}

	function toggleCard(key: string): void {
		foldStore = { ...fold, keys: fold.keys.includes(key) ? fold.keys.filter((k) => k !== key) : [...fold.keys, key] };
	}

	/** Fold or unfold every request message at once. */
	function foldMessages(folded: boolean): void {
		foldStore = { ...fold, keys: folded ? [...messageKeys] : [] };
	}

	// ===== Derived views of the selected entry =====

	let images = $derived(selected ? entryImages(selected) : []);
	let size = $derived(selected ? promptSize(selected) : { tokens: 0, reported: false });
	let messageSize = $derived(selected ? messagesSize(selected) : 0);

	let messageKeys = $derived(selected ? selected.messages.map((_, i) => `m${i}`) : []);
	let allMessagesFolded = $derived(messageKeys.length > 0 && messageKeys.every((k) => fold.keys.includes(k)));

	let hasResponse = $derived(!!selected && !!(selected.responseContent || selected.responseThinking));

	/** Why the response section is empty, said plainly. A settled request with no body is a
	 *  real outcome the panel must state, not a section it quietly omits. */
	let emptyResponseNote = $derived.by(() => {
		if (!selected) return '';
		if (selected.status === 'pending') return 'Still in flight: the provider has not answered yet.';
		if (selected.status === 'error') return 'Nothing was received; the request failed (see the error above).';
		if (selected.status === 'cancelled') return 'Stopped before the provider sent anything.';
		return 'The provider returned an empty response body.';
	});

	function responseText(entry: PromptLogEntry): string {
		return [entry.responseThinking, entry.responseContent].filter(Boolean).join('\n\n');
	}

	/** The complete captured record, verbatim. Hand-picking fields here is exactly the
	 *  omission the Pretty view is not allowed to make either. */
	function rawPayload(entry: PromptLogEntry): string {
		return JSON.stringify(entry, null, 2);
	}

	function backToList(): void {
		if (comparePair) promptLogStore.clearCompare();
		promptLogStore.deselect();
		viewerIndex = null;
	}

	function pick(id: string): void {
		promptLogStore.select(id);
		viewerIndex = null;
	}

	/** The cards hand back a path; the viewer pages positions. Both read the same `images`
	 *  list, so a path that isn't in it means the two have drifted. Say so, don't no-op. */
	function viewImage(path: string): void {
		const at = images.indexOf(path);
		if (at < 0) throw new Error(`${path} is not among this request's images`);
		viewerIndex = at;
	}

	/** Move the panel onto its own window (a second screen, typically). The log is
	 *  server-side and shared, so the new window needs nothing from this one: it
	 *  announces itself to the feed and backfills. Named, so a second click raises the
	 *  window that is already out instead of opening a duplicate. */
	function popOut(): void {
		const win = window.open('/debug', 'chungushub-debug', 'popup,width=1100,height=820');
		if (!win) {
			toastStore.error('The debug window was blocked. Allow pop-ups for this site.');
			return;
		}
		win.focus();
		// Hand off rather than mirror: two live views of one shared log is just clutter.
		uiStore.closeDebugPanel();
	}

	function onKeydown(e: KeyboardEvent): void {
		// The image viewer is the top-most surface and owns its own Escape. This handler runs
		// first (the viewer is a child), so without standing down here one press would close
		// the viewer AND the panel behind it.
		if (viewerIndex !== null) return;
		if (e.key === 'Escape' && uiStore.debugPanelOpen) {
			// preventDefault also tells the workspace's global Esc to stand down.
			e.preventDefault();
			e.stopPropagation();
			uiStore.closeDebugPanel();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="panel">
	<header class="panel-head">
		<div class="title-wrap">
			<Icon name="wrench" class="w-4 h-4" strokeWidth={1.75} />
			<h2 class="title">Prompt Debug</h2>
			<span class="count-chip">{entries.length}</span>
		</div>
		<div class="head-actions">
			<!-- Phones have no second screen to move the panel to, and a named pop-up window is
			     either blocked or lands as a tab that replaces the app. -->
			{#if !standalone && !viewport.isMobile}
				<button class="head-btn" type="button" onclick={popOut} title="Move the panel to its own window">
					<Icon name="restore" class="w-3.5 h-3.5" strokeWidth={1.75} />
					Pop out
				</button>
			{/if}
			<button class="head-btn danger" type="button" onclick={() => promptLogStore.clear()} disabled={entries.length === 0}>
				<Icon name="trash" class="w-3.5 h-3.5" strokeWidth={1.75} />
				Clear
			</button>
			{#if !standalone}
				<button class="head-btn" type="button" onclick={() => uiStore.closeDebugPanel()} aria-label="Close">
					<Icon name="x" class="w-4 h-4" strokeWidth={1.75} />
				</button>
			{/if}
		</div>
	</header>

	{#if promptLogStore.error}
		<div class="banner error">Couldn't load the shared log: {promptLogStore.error}</div>
	{/if}
	{#if promptLogStore.large}
		<div class="banner warn">The log is large ({entries.length} entries). Consider Clear to keep things snappy. Nothing is dropped automatically.</div>
	{/if}

	<div class="panel-body" class:mobile-detail={mobileDetail}>
		<aside class="list panel-scroll">
			{#if entries.length === 0}
				<p class="empty">No prompts logged yet. Send a message and it will appear here.</p>
			{:else}
				{#each entries as entry (entry.id)}
					{@const rowSize = promptSize(entry)}
					{@const rowImages = entryImages(entry).length}
					<div
						class="row"
						class:selected={selected?.id === entry.id}
						role="button"
						tabindex="0"
						onclick={() => pick(entry.id)}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && pick(entry.id)}
					>
						<div class="row-top">
							<span class="status-dot" style={`background:${statusColor(entry.status)}`} title={statusLabel(entry.status)}></span>
							<span class="src-badge" style={`color:${sourceColor(entry.source)}; background:color-mix(in srgb, ${sourceColor(entry.source)} 15%, transparent)`}>
								{entry.source}
							</span>
							<span class="row-time">{formatTime(entry.startedAt)}</span>
							<button
								class="cmp-btn"
								class:on={compareIds.includes(entry.id)}
								type="button"
								title="Add to compare"
								onclick={(e) => {
									e.stopPropagation();
									promptLogStore.toggleCompare(entry.id);
								}}
							>⇄</button>
						</div>
						<div class="row-model" title={entry.model}>{entry.model || '(no model)'}</div>
						<div class="row-meta">
							<span>{entry.provider}</span>
							<span class="sep">·</span>
							<span>{entry.messages.length} msg</span>
							{#if rowImages}
								<span class="sep">·</span>
								<span class="img-count">{rowImages} img</span>
							{/if}
							<span class="sep">·</span>
							<span
								class="tok"
								class:reported={rowSize.reported}
								title={rowSize.reported ? 'Prompt tokens reported by the provider' : 'Our estimate; the provider has not reported prompt usage for this request'}
							>{rowSize.reported ? '' : '~'}{rowSize.tokens.toLocaleString()} tok</span>
							{#if formatDuration(entry.startedAt, entry.endedAt)}
								<span class="sep">·</span>
								<span>{formatDuration(entry.startedAt, entry.endedAt)}</span>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</aside>

		<section class="detail">
			{#if comparePair}
				<div class="compare-bar">
					<span>Comparing two prompts</span>
					<button class="head-btn" type="button" onclick={() => (viewport.isMobile ? backToList() : promptLogStore.clearCompare())}>Exit compare</button>
				</div>
				<div class="compare-host">
					<PromptCompareView a={comparePair[0]} b={comparePair[1]} />
				</div>
			{:else if compareIds.length === 1}
				<div class="hint">Pick a second prompt (⇄) to compare against the one you selected.</div>
			{:else if selected}
				{@const entry = selected}
				<div class="detail-head" style={`--st:${statusColor(entry.status)}`}>
					<div class="dh-line">
						{#if viewport.isMobile}
							<button class="back-btn" type="button" onclick={backToList} aria-label="Back to the list">
								<Icon name="chevronLeft" class="w-4 h-4" strokeWidth={2} />
							</button>
						{/if}
						<span class="src-badge big" style={`color:${sourceColor(entry.source)}; background:color-mix(in srgb, ${sourceColor(entry.source)} 15%, transparent)`}>
							{entry.source}
						</span>
						<span class="dh-model" title={entry.model}>{entry.model}</span>
						{#if entry.resultModel && entry.resultModel !== entry.model}
							<span class="dh-resolved" title="The model the provider reported serving">→ {entry.resultModel}</span>
						{/if}
						<span class="dh-provider">{entry.resultProvider ?? entry.provider}</span>
						<span class="spacer"></span>
						<!-- Grouped so the phone can drop the pair onto its own line whole: sharing the
						     identity line there squeezes the view switch down to unreadable stubs. -->
						<div class="dh-tools">
							<div class="seg">
								<button class="seg-btn" class:on={!rawView} type="button" onclick={() => (rawView = false)}>Pretty</button>
								<button class="seg-btn" class:on={rawView} type="button" onclick={() => (rawView = true)}>Raw</button>
							</div>
							<CopyButton
								label={viewport.isMobile ? undefined : 'Copy all'}
								text={() => rawPayload(entry)}
								title="Copy the whole captured record as JSON"
							/>
						</div>
					</div>

					<div class="stats">
						<div class="stat">
							<span class="k">status</span>
							<span class="v st">{statusLabel(entry.status)}</span>
						</div>
						<div class="stat">
							<span class="k">prompt · {size.reported ? 'reported' : 'estimated'}</span>
							<span class="v" class:est={!size.reported}>{size.reported ? '' : '~'}{size.tokens.toLocaleString()}</span>
						</div>
						{#if entry.usage}
							<div class="stat">
								<span class="k">completion</span>
								<span class="v">{entry.usage.completionTokens.toLocaleString()}</span>
							</div>
							{#if entry.usage.cachedTokens}
								<div class="stat">
									<span class="k">cached</span>
									<span class="v cached">{entry.usage.cachedTokens.toLocaleString()}</span>
								</div>
							{/if}
							<div class="stat">
								<span class="k">total</span>
								<span class="v">{entry.usage.totalTokens.toLocaleString()}</span>
							</div>
						{/if}
						<div class="stat">
							<span class="k">started</span>
							<span class="v">{formatPreciseTime(entry.startedAt)}</span>
						</div>
						{#if formatDuration(entry.startedAt, entry.endedAt)}
							<div class="stat">
								<span class="k">duration</span>
								<span class="v">{formatDuration(entry.startedAt, entry.endedAt)}</span>
							</div>
						{/if}
						{#if entry.finishReason}
							<div class="stat">
								<span class="k">finish</span>
								<span class="v">{entry.finishReason}</span>
							</div>
						{/if}
					</div>

					{#if !size.reported && images.length}
						<p class="note">
							The estimate covers text only. The {images.length} image attachment{images.length === 1 ? '' : 's'}
							below also cost tokens, priced by the provider from dimensions we don't have.
						</p>
					{/if}
					{#if entry.error}
						<p class="err-line">{entry.error}</p>
					{/if}
				</div>

				<div class="body panel-scroll">
					{#if rawView}
						<pre class="raw">{rawPayload(entry)}</pre>
					{:else}
						<section class="section">
							<div class="sec-head">
								<span class="sec-title">Request fields</span>
								<span class="sec-meta">everything sent alongside the messages</span>
							</div>
							<div class="chips">
								{#each requestChips(entry) as chip}
									<span class="chip" title={chip}>{chip}</span>
								{/each}
							</div>
						</section>

						<section class="section">
							<div class="sec-head">
								<span class="sec-title">Messages</span>
								<span class="sec-count">{entry.messages.length}</span>
								<span
									class="sec-meta"
									title={images.length ? 'Image attachments are logged from the wire payload, so a picture listed here did ride this request' : undefined}
								>~{messageSize.toLocaleString()} tok{images.length ? ` · ${images.length} image${images.length === 1 ? '' : 's'} attached` : ''}</span>
								<span class="spacer"></span>
								<button
									class="sec-btn"
									type="button"
									onclick={() => foldMessages(!allMessagesFolded)}
								>{allMessagesFolded ? 'Unfold all' : 'Fold all'}</button>
								<CopyButton text={() => JSON.stringify(entry.messages, null, 2)} title="Copy the whole message array as JSON" />
							</div>
							<div class="transcript">
								{#each entry.messages as msg, i (i)}
									<PromptMessageCard
										message={msg}
										index={i}
										model={entry.model}
										collapsed={toggled(`m${i}`)}
										onToggle={() => toggleCard(`m${i}`)}
										onViewImage={viewImage}
									/>
								{/each}
							</div>
						</section>

						<section class="section">
							<div class="sec-head">
								<span class="sec-title">Response</span>
								{#if entry.finishReason}<span class="sec-count">{entry.finishReason}</span>{/if}
								<span class="spacer"></span>
								{#if hasResponse}
									<CopyButton text={() => responseText(entry)} title="Copy the response text" />
								{/if}
							</div>
							{#if hasResponse}
								<div class="transcript">
									{#if entry.responseThinking}
										<PromptMessageCard
											message={{ role: 'thinking', content: entry.responseThinking }}
											model={entry.model}
											collapsed={toggled('r-thinking')}
											onToggle={() => toggleCard('r-thinking')}
											onViewImage={viewImage}
										/>
									{/if}
									<PromptMessageCard
									message={{ role: 'assistant', content: entry.responseContent ?? '' }}
										model={entry.model}
										collapsed={toggled('r-content')}
										onToggle={() => toggleCard('r-content')}
										onViewImage={viewImage}
									/>
								</div>
							{:else}
								<p class="sec-note">{emptyResponseNote}</p>
							{/if}
						</section>
					{/if}
				</div>
			{:else}
				<div class="hint">Select a prompt on the left to inspect exactly what was sent.</div>
			{/if}
		</section>
	</div>
</div>

<!-- One viewer for the whole panel. Mounted unconditionally: `index` is what opens and
     closes it (see ImageLightbox), so gating the component on the same condition would
     re-run the portal effect against a node that has already been orphaned. -->
<ImageLightbox
	{images}
	bind:index={viewerIndex}
	alt="Attachment sent with this request"
	onClose={() => (viewerIndex = null)}
/>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.6rem 0.8rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.title-wrap {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-primary);
	}

	.title {
		margin: 0;
		font-family: var(--font-ui);
		font-weight: 600;
		font-size: 0.92rem;
	}

	.count-chip {
		font-family: var(--font-mono, monospace);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-bg-tertiary) 60%, transparent);
		border-radius: 999px;
		padding: 0.05rem 0.45rem;
	}

	.head-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.head-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.76rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.head-btn:hover:not(:disabled) {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
	}

	.head-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.head-btn.danger:hover:not(:disabled) {
		color: var(--color-error);
		border-color: color-mix(in srgb, var(--color-error) 40%, transparent);
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
	}

	.banner {
		padding: 0.45rem 0.8rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
	}

	.banner.error {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
	}

	.banner.warn {
		color: var(--color-warning);
		background: color-mix(in srgb, var(--color-warning) 14%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent);
	}

	.panel-body {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	/* The panel is chat-width in the app and a wide window when popped out, so the list
	   takes a share rather than a fixed slab: a fixed 19rem eats a narrow panel's detail. */
	.list {
		width: clamp(12.5rem, 32%, 19rem);
		flex-shrink: 0;
		border-right: 1px solid var(--color-border-subtle);
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.empty,
	.hint {
		margin: 0;
		padding: 1.2rem 1rem;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-text-muted);
		text-align: center;
	}

	.hint {
		margin: auto;
		max-width: 24rem;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.5rem 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: color-mix(in srgb, var(--color-bg-secondary) 60%, transparent);
		cursor: pointer;
		transition: border-color 120ms ease, background-color 120ms ease;
	}

	.row:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
	}

	.row.selected {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.row-top {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.status-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.src-badge {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-sm);
		white-space: nowrap;
	}

	.src-badge.big {
		flex-shrink: 0;
		font-size: 0.74rem;
	}

	.row-time {
		margin-left: auto;
		font-family: var(--font-mono, monospace);
		font-size: 0.66rem;
		color: var(--color-text-muted);
	}

	.cmp-btn {
		display: inline-grid;
		place-items: center;
		width: 1.3rem;
		height: 1.3rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border-subtle);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		line-height: 1;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.cmp-btn:hover {
		color: var(--color-text-primary);
	}

	.cmp-btn.on {
		color: var(--color-accent);
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	.row-model {
		font-family: var(--font-mono, monospace);
		font-size: 0.74rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.row-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.66rem;
		color: var(--color-text-muted);
	}

	.row-meta .sep {
		opacity: 0.5;
	}

	.img-count {
		color: var(--color-text-secondary);
	}

	/* One number per request: accent when the provider reported it, muted and ~-prefixed
	   when it is our estimate. Never both. */
	.tok.reported {
		color: var(--color-accent);
	}

	.detail {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.detail-head {
		padding: 0.6rem 0.8rem;
		border-bottom: 1px solid var(--color-border-subtle);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.dh-line {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}

	.dh-model {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono, monospace);
		font-size: 0.8rem;
		color: var(--color-text-primary);
	}

	.dh-resolved {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono, monospace);
		font-size: 0.74rem;
		color: var(--color-accent);
	}

	.dh-provider {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-text-muted);
	}

	.spacer {
		flex: 1;
	}

	.dh-tools {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.seg {
		flex-shrink: 0;
		display: inline-flex;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		overflow: hidden;
	}

	.seg-btn {
		padding: 0.28rem 0.5rem;
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.seg-btn:hover {
		color: var(--color-text-primary);
	}

	.seg-btn.on {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
	}

	/* The ring goes on the group and the focused segment washes accent, the same pair the title
	   bar's split pill uses and for the same reason: this one clips its own corners, and the
	   app's ring is drawn outside the element it belongs to, so a ring on a segment would
	   survive only as the sliver in a seam. Last in the block, so the wash beats `.on`. */
	.seg:has(:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.seg-btn:focus-visible {
		outline: none;
		background: color-mix(in srgb, var(--color-accent) 32%, transparent);
	}

	/* A row of small labelled figures rather than one run-on line: the numbers line up,
	   and each wraps as a unit so a narrow panel never splits a value from its label. */
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 1rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.stat .k {
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.stat .v {
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--font-mono, monospace);
		font-size: 0.78rem;
		color: var(--color-text-primary);
		white-space: nowrap;
	}

	.stat .v.st {
		color: var(--st);
		text-transform: uppercase;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.03em;
	}

	.stat .v.est {
		color: var(--color-text-secondary);
	}

	.stat .v.cached {
		color: var(--color-success);
	}

	.note {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	.err-line {
		margin: 0;
		max-height: 6rem;
		overflow-y: auto;
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-sm);
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		line-height: 1.45;
		overflow-wrap: anywhere;
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
	}

	.body {
		flex: 1;
		min-height: 0;
		padding: 0.6rem 0.8rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.sec-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.sec-title {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.66rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--color-text-secondary);
	}

	.sec-count {
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.66rem;
		color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-bg-tertiary) 60%, transparent);
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
	}

	.sec-meta {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono, monospace);
		font-size: 0.66rem;
		color: var(--color-text-muted);
	}

	.sec-btn {
		flex-shrink: 0;
		padding: 0.18rem 0.4rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border-subtle);
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.sec-btn:hover {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
	}

	.sec-note {
		margin: 0;
		padding: 0.5rem 0.6rem;
		border: 1px dashed var(--color-border-subtle);
		border-radius: var(--radius-md);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-text-muted);
	}

	.transcript {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: color-mix(in srgb, var(--color-bg-secondary) 45%, transparent);
	}

	.transcript :global(.msg:last-child),
	.transcript :global(.tool-def:last-child) {
		border-bottom: 0;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.chip {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono, monospace);
		font-size: 0.68rem;
		color: var(--color-text-secondary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		padding: 0.05rem 0.4rem;
	}

	.raw {
		margin: 0;
		padding: 0.7rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-family: var(--font-mono, monospace);
		font-size: 0.76rem;
		line-height: 1.5;
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
	}

	.compare-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.45rem 0.8rem;
		border-bottom: 1px solid var(--color-border-subtle);
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-secondary);
	}

	.compare-host {
		flex: 1;
		min-height: 0;
	}

	.back-btn {
		display: inline-grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		flex-shrink: 0;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	/* Phone: the side-by-side panes can't fit, so show one at a time. Either the list, or
	   (once .mobile-detail is set) the inspected entry / compare view full-width. */
	@media (max-width: 640px) {
		.list {
			width: 100%;
			border-right: 0;
		}

		.panel-body.mobile-detail .list {
			display: none;
		}

		.panel-body:not(.mobile-detail) .detail {
			display: none;
		}

		.dh-line {
			flex-wrap: wrap;
		}

		/* Its own full-width line under the identity, still ending where it does on a wide
		   panel: the model name is what shrinks, never the controls. */
		.dh-tools {
			flex-basis: 100%;
			justify-content: flex-end;
		}

		.stats {
			gap: 0.15rem 0.75rem;
		}
	}
</style>
