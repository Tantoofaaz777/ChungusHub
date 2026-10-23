<script lang="ts">
	import ChatBrowserControls from '$lib/components/sidebar/ChatBrowserControls.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { holdMsForBlast } from '$lib/components/ui/HoldToConfirmButton.svelte';
	import { db } from '$lib/services/database';
	import type { ChatListStats } from '$lib/types/chat';
	import { chatTwinCounts, chatActivityAt, filterAndSortChats, type SortKey, type SortDir, type FilterMode } from '$lib/utils/chat-browser';
	import Icon from '$lib/components/ui/Icon.svelte';
	import ChatAvatars from '$lib/components/sidebar/ChatAvatars.svelte';
	import { formatRelativeTime } from '$lib/utils/date';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { chatCastStore } from '$lib/stores/chatCast.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { lorebookStore } from '$lib/lorebook/store.svelte';

	let chats = $derived(chatStore.sortedChats);
	// Only chats that have actually been written in are worth resuming: a fresh
	// blank chat (rootMessageId === null) isn't. Newest first, six until expanded.
	let resumable = $derived(chats.filter((c) => c.rootMessageId !== null));
	const INITIAL_CHAT_COUNT = 6;
	let expanded = $state(false);
	let visibleCount = $state(INITIAL_CHAT_COUNT);
	const CHAT_BATCH_SIZE = 50;
	let browseLimit = $state(CHAT_BATCH_SIZE);
	let welcomeEl = $state<HTMLDivElement | null>(null);
	let searchQuery = $state('');
	let query = $derived(searchQuery.trim());
	let sortKey = $state<SortKey>('activity');
	let sortDir = $state<SortDir>('desc');
	let filterMode = $state<FilterMode>('all');
	let stats = $state<Record<string, ChatListStats>>({});
	let twinGroups = $state<Record<string, string>>({});
	$effect(() => {
		void chats;
		let cancelled = false;
		Promise.all([db.getChatListStats(), db.getChatContentGroups()])
			.then(([nextStats, nextGroups]) => {
				if (cancelled) return;
				stats = nextStats;
				twinGroups = nextGroups;
			})
			.catch((error) => console.error('Failed to load welcome chat stats:', error));
		return () => { cancelled = true; };
	});
	let twinCounts = $derived(chatTwinCounts(chats, twinGroups));
	let twinsInScope = $derived(chats.some((chat) => (twinCounts[chat.id] ?? 0) > 1));
	let selecting = $state(false);
	let selectedIds = $state<Set<string>>(new Set());
	let bulkDeleteOpen = $state(false);
	let browsing = $derived(!!query || filterMode !== 'all' || selecting || sortKey !== 'activity' || sortDir !== 'desc');
	let filteredChats = $derived(filterAndSortChats(browsing ? chats : resumable, {
		query, filter: filterMode, sort: sortKey, direction: sortDir, stats, twins: twinCounts
	}));
	let recent = $derived(filteredChats.slice(0, browsing ? browseLimit : expanded ? visibleCount : INITIAL_CHAT_COUNT));
	// All selects the full filtered set, matching the count in the selection control.
	let selectableChats = $derived(browsing ? filteredChats : recent);
	let hasMoreChats = $derived((browsing || expanded) && recent.length < filteredChats.length);
	$effect(() => {
		void query; void sortKey; void sortDir; void filterMode; void browsing;
		browseLimit = CHAT_BATCH_SIZE;
		if (welcomeEl) welcomeEl.scrollTop = 0;
	});
	function loadMoreChats() {
		if (browsing) browseLimit = Math.min(filteredChats.length, browseLimit + CHAT_BATCH_SIZE);
		else if (expanded) visibleCount = Math.min(filteredChats.length, visibleCount + CHAT_BATCH_SIZE);
	}
	function scrollChats(event: Event) {
		const list = event.currentTarget as HTMLDivElement;
		if (hasMoreChats && list.scrollHeight - list.scrollTop - list.clientHeight < 200) loadMoreChats();
	}
	let selectedChats = $derived(chats.filter((chat) => selectedIds.has(chat.id)));
	let selectedCount = $derived(selectedChats.length);
	let allVisibleSelected = $derived(selectableChats.length > 0 && selectableChats.every((chat) => selectedIds.has(chat.id)));
	let bulkDeleteStats = $derived(selectedChats.reduce((total, chat) => total + (stats[chat.id]?.total ?? 0), 0));
	let bulkDeleteMessage = $derived(
		`Delete ${selectedCount} chat${selectedCount === 1 ? '' : 's'} and ${bulkDeleteStats} message${bulkDeleteStats === 1 ? '' : 's'} in total? This cannot be undone.`
	);
	function toggleSelecting() {
		selecting = !selecting;
		if (!selecting) selectedIds = new Set();
	}
	function toggleSelect(chatId: string) {
		const next = new Set(selectedIds);
		if (!next.delete(chatId)) next.add(chatId);
		selectedIds = next;
	}
	function selectAllVisible() {
		selectedIds = new Set([...selectedIds, ...selectableChats.map((chat) => chat.id)]);
	}
	async function confirmBulkDelete() {
		const ids = selectedChats.map((chat) => chat.id);
		bulkDeleteOpen = false;
		selectedIds = new Set();
		selecting = false;
		await chatStore.deleteChats(ids);
	}

	// Free room under the content, measured off the flexible spacer while collapsed.
	// Expanding fills that room instead of scrolling; ROW_PX ≈ card height + list gap,
	// and RESERVE_PX leaves a little space below the expanded list.
	let spareHeight = $state(0);
	const ROW_PX = 75;
	const RESERVE_PX = 32;

	function toggleExpand() {
		if (expanded) {
			expanded = false;
			return;
		}
		// Always reveal at least two more so the button never no-ops when cramped.
		visibleCount = Math.min(CHAT_BATCH_SIZE, INITIAL_CHAT_COUNT + Math.max(2, Math.floor((spareHeight - RESERVE_PX) / ROW_PX)));
		expanded = true;
	}

	// Opening a chat is what retires the landing, and chatStore handles the dismissal.
	function continueStory(chatId: string) {
		if (selecting) toggleSelect(chatId);
		else chatStore.selectChat(chatId);
	}

	// The two-step New chat flow: the Library opens on Characters, then Personas,
	// then a fresh chat is created for the picked pair (uiStore.startNewChat).
	function newChat() {
		uiStore.startNewChat(() => lorebookStore.flush());
	}

</script>

<div class="welcome panel-scroll" bind:this={welcomeEl} onscroll={scrollChats}>
	<div class="welcome-inner">
		<div class="welcome-top">
			<header class="hero">
				<div class="logo-shell" aria-hidden="true">
					<div class="logo-halo"></div>
					<img class="logo-mark" src="/mark.svg" alt="" />
				</div>

				<div class="brand-copy">
					<h1 class="brand">ChungusHub</h1>
					<p class="tagline">Your stories, your way.</p>
				</div>
			</header>

			<div class="actions">
				<ChatBrowserControls
					bind:searchQuery bind:sortKey bind:sortDir bind:filterMode
					allowMessageSearch={false} mobileActions iconSort mobileSearchRow compact
					{twinsInScope} {selecting} {toggleSelecting} {selectedCount} {allVisibleSelected}
					visibleCount={selectableChats.length} {selectAllVisible}
					clearSelection={() => (selectedIds = new Set())}
					requestDelete={() => (bulkDeleteOpen = true)}
				>
					{#snippet leading()}
						<button type="button" class="action action-primary" aria-label="New chat" title="New chat" onclick={newChat}>
							<Icon name="plus" class="w-4 h-4" />
						</button>
					{/snippet}
				</ChatBrowserControls>
			</div>

			{#if recent.length}
				<section class="recent" aria-label="Recent chats">
					<div class="recent-list">
						{#each recent as chat (chat.id)}
							{@const cast = chatCastStore.charactersForChat(chat.id)}
							{@const persona = chatCastStore.personaForChat(chat.id)}
							{@const pathCount = stats[chat.id]?.path ?? 0}
							<button type="button" class="recent-card" class:is-selected={selecting && selectedIds.has(chat.id)} aria-pressed={selecting ? selectedIds.has(chat.id) : undefined} onclick={() => continueStory(chat.id)}>
								{#if selecting}
									<span class="selection-check" class:is-checked={selectedIds.has(chat.id)} aria-hidden="true">
										{#if selectedIds.has(chat.id)}<Icon name="check" class="w-3.5 h-3.5" />{/if}
									</span>
								{/if}
								<div class="recent-faces">
									{#if cast.length}
										<ChatAvatars members={cast} size={40} max={3} />
									{:else}
										<div class="recent-icon"><Icon name="chat" class="w-5 h-5" /></div>
									{/if}
								</div>
								<div class="recent-text">
									<span class="recent-title">{chat.title}</span>
									<span class="recent-meta">
										{formatRelativeTime(chatActivityAt(chat, stats))}{#if persona}<span class="recent-meta-sep" aria-hidden="true">·</span>as {persona.name}{/if}
									</span>
								</div>
								<span class="recent-count" title="{pathCount} message{pathCount === 1 ? '' : 's'} in this chat">
									<Icon name="chat" class="w-3.5 h-3.5" />
									{pathCount}
								</span>
								{#if chat.isFavorite}<Icon name="heart" class="w-4 h-4 fill-current text-accent shrink-0" />{/if}
								{#if !selecting}<Icon name="arrowRight" class="w-4 h-4 recent-arrow" />{/if}
							</button>
						{/each}
					</div>

					{#if hasMoreChats}
						<button type="button" class="recent-expand" onclick={loadMoreChats}>Load more chats · {recent.length.toLocaleString()} / {filteredChats.length.toLocaleString()}</button>
					{/if}

					{#if !browsing && filteredChats.length > INITIAL_CHAT_COUNT}
						<button type="button" class="recent-expand" onclick={toggleExpand}>
							<Icon name={expanded ? 'chevronUp' : 'chevronDown'} class="w-3.5 h-3.5" />
							<span>{expanded ? 'Show less' : 'Show more'}</span>
						</button>
					{/if}
				</section>
			{:else}
				<section class="empty" aria-label={query ? 'No matching chats' : 'No chats yet'}>
					<p class="empty-text">{query ? 'No chats match your search' : filterMode === 'favorites' ? 'No favorites yet' : filterMode === 'duplicates' ? 'No identical chats' : 'No chats yet'}</p>
				</section>
			{/if}
		</div>

		<!-- Measure the remaining room available for the expanded recent list. -->
		<div class="welcome-grow" bind:clientHeight={spareHeight} aria-hidden="true"></div>
	</div>
</div>

<ConfirmDialog
	open={bulkDeleteOpen}
	title="Delete {selectedCount} chat{selectedCount === 1 ? '' : 's'}"
	message={bulkDeleteMessage}
	confirmLabel="Delete {selectedCount}"
	variant="danger"
	destructive
	holdMs={holdMsForBlast(bulkDeleteStats)}
	onConfirm={confirmBulkDelete}
	onCancel={() => (bulkDeleteOpen = false)}
/>

<style>
	.welcome {
		height: 100%;
		min-height: 0;
		background: transparent;
	}

	/* One content column for the header, actions and recent chats. */
	.welcome-inner {
		min-height: 100%;
		max-width: 44rem;
		margin: 0 auto;
		padding: clamp(2rem, 1.4rem + 2.6vw, 3.4rem) clamp(1.1rem, 0.8rem + 1.6vw, 2.4rem)
			clamp(1.4rem, 1.1rem + 1vw, 2rem);
		display: flex;
		flex-direction: column;
	}

	.welcome-top {
		display: flex;
		flex-direction: column;
		gap: clamp(1.25rem, 1rem + 0.8vw, 1.75rem);
	}

	/* Its measured size is the room the expanded recent list may fill. */
	.welcome-grow {
		flex: 1 1 0;
		min-height: 0;
	}

	/* Staggered entrance: one orchestrated rise on load. */
	.hero,
	.actions,
	.recent,
	.empty {
		animation: welcome-rise 460ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.actions {
		animation-delay: 70ms;
	}

	.recent,
	.empty {
		animation-delay: 140ms;
	}

	@keyframes welcome-rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	/* ===== Hero ===== */
	.hero {
		display: flex;
		align-items: center;
		text-align: left;
		gap: 0.85rem;
	}

	.logo-shell {
		position: relative;
		width: clamp(2.5rem, 2.15rem + 1vw, 3rem);
		height: clamp(2.5rem, 2.15rem + 1vw, 3rem);
		flex-shrink: 0;
		display: grid;
		place-items: center;
	}

	/* A soft blurred glow rather than a hard-edged disc. */
	.logo-halo {
		position: absolute;
		inset: -16%;
		border-radius: var(--radius-full);
		background: radial-gradient(
			circle at 50% 42%,
			color-mix(in srgb, var(--color-accent) 58%, transparent),
			transparent 72%
		);
		filter: blur(16px);
		opacity: 0.5;
	}

	.logo-mark {
		position: relative;
		width: 100%;
		height: 100%;
		object-fit: contain;
		filter: drop-shadow(0 6px 16px color-mix(in srgb, var(--color-accent) 30%, transparent));
	}

	.brand-copy {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.brand {
		margin: 0;
		min-width: 0;
		font-family: var(--font-ui);
		font-size: clamp(1.125rem, 1rem + 0.4vw, 1.25rem);
		font-weight: 740;
		line-height: 1.15;
		letter-spacing: 0.01em;
		overflow-wrap: anywhere;
		color: var(--color-text-primary);
	}

	.tagline {
		margin: 0;
		font-family: var(--font-ui);
		font-size: clamp(0.78rem, 0.74rem + 0.15vw, 0.85rem);
		line-height: 1.4;
		color: var(--color-text-secondary);
	}

	/* ===== Quick actions ===== */
	.actions {
		min-width: 0;
		position: relative;
		z-index: 1;
	}

	.action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 2.4rem;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border-radius: var(--radius-full);
		font-family: var(--font-ui);
		font-size: 0.84rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition: filter 140ms ease, background-color 140ms ease, border-color 140ms ease,
			color 140ms ease, box-shadow 140ms ease;
	}

	.action-primary {
		background: var(--color-accent);
		color: var(--color-on-accent);
		box-shadow: 0 4px 18px color-mix(in srgb, var(--color-accent) 24%, transparent);
	}

	.action-primary:hover {
		filter: brightness(1.08);
	}

	.action:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.recent-card.is-selected {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, var(--color-card-bg));
	}

	.selection-check {
		display: grid;
		place-items: center;
		width: 1.2rem;
		height: 1.2rem;
		flex-shrink: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-full);
	}

	.selection-check.is-checked {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-on-accent);
	}

	/* ===== Recent stories ===== */
	.recent-list {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.recent-card {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		width: 100%;
		text-align: left;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-lg);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-card-bg) 72%, transparent);
		cursor: pointer;
		transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
	}

	.recent-card:hover {
		background: var(--color-card-bg);
		border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
		box-shadow: var(--shadow-sm);
	}

	.recent-faces {
		flex-shrink: 0;
	}

	.recent-icon {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-full);
		display: grid;
		place-items: center;
		color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-bg-tertiary) 88%, transparent);
	}

	.recent-text {
		display: flex;
		flex-direction: column;
		gap: 0.16rem;
		min-width: 0;
		flex: 1;
	}

	.recent-title {
		font-family: var(--font-ui);
		font-size: 0.92rem;
		font-weight: 620;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.recent-meta {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.recent-meta-sep {
		opacity: 0.6;
	}

	.recent-count {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	:global(.recent-arrow) {
		flex-shrink: 0;
		color: var(--color-text-muted);
		opacity: 0.55;
		transition: transform 150ms ease, color 150ms ease, opacity 150ms ease;
	}

	.recent-card:hover :global(.recent-arrow) {
		color: var(--color-accent);
		opacity: 1;
		transform: translateX(3px);
	}

	/* Reads as the quiet action controls above: a resting pill, not a hover-only one. */
	.recent-expand {
		display: flex;
		width: fit-content;
		align-items: center;
		gap: 0.35rem;
		margin: 0.7rem auto 0;
		padding: 0.3rem 0.8rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: color 140ms ease, background-color 140ms ease, border-color 140ms ease;
	}

	.recent-expand:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border);
		background: color-mix(in srgb, var(--color-bg-tertiary) 85%, transparent);
	}

	/* ===== Empty state (no resumable chats yet) ===== */
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		/* Enough air that the line reads as its own zone rather than a caption
		   hanging off the action buttons above it. */
		padding-top: 3.9rem;
		text-align: center;
	}

	.empty-text {
		margin: 0;
		max-width: 26rem;
		font-family: var(--font-body);
		font-style: italic;
		font-size: 0.98rem;
		color: var(--color-text-muted);
	}

	@media (pointer: coarse) {
		.action { width: 2.75rem; height: 2.75rem; flex-basis: 2.75rem; }
	}

	/* ===== Narrow screens ===== */
	@media (max-width: 560px) {
		.recent-card {
			padding: 0.7rem 0.85rem;
			gap: 0.75rem;
		}
	}
</style>
