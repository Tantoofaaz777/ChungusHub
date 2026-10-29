<script lang="ts">
	import { menuMotion } from '#lib/components/ui/menu-motion.ts';
	import type { Snippet } from 'svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { SORT_OPTIONS, type SortKey, type SortDir, type FilterMode } from '#lib/utils/chat-browser.ts';

	let {
		searchQuery = $bindable(''),
		searchInMessages = $bindable(false),
		sortKey = $bindable<SortKey>('activity'),
		sortDir = $bindable<SortDir>('desc'),
		sortMenuOpen = $bindable(false),
		filterMode = $bindable<FilterMode>('all'),
		searchInputEl = $bindable<HTMLInputElement | null>(null),
		selecting = false,
		toggleSelecting,
		twinsInScope = false,
		searchingMessages = false,
		selectedCount = 0,
		visibleCount = 0,
		allVisibleSelected = false,
		selectAllVisible,
		clearSelection,
		requestDelete,
		allowMessageSearch = true,
		showSearch = true,
		mobileActions = false,
		iconSort = false,
		mobileSearchRow = false,
		listboxId,
		activeDescendant,
		leading,
		compact = false
	}: {
		searchQuery?: string;
		searchInMessages?: boolean;
		sortKey?: SortKey;
		sortDir?: SortDir;
		sortMenuOpen?: boolean;
		filterMode?: FilterMode;
		searchInputEl?: HTMLInputElement | null;
		selecting?: boolean;
		toggleSelecting: () => void;
		twinsInScope?: boolean;
		searchingMessages?: boolean;
		selectedCount?: number;
		visibleCount?: number;
		allVisibleSelected?: boolean;
		selectAllVisible: () => void;
		clearSelection: () => void;
		requestDelete: () => void;
		allowMessageSearch?: boolean;
		showSearch?: boolean;
		mobileActions?: boolean;
		iconSort?: boolean;
		/** Keep search on its own line and all action buttons below it on phones. */
		mobileSearchRow?: boolean;
		listboxId?: string;
		activeDescendant?: string;
		leading?: Snippet;
		compact?: boolean;
	} = $props();
	let moreMenuOpen = $state(false);
	let moreButton = $state<HTMLButtonElement>();
	let sortButton = $state<HTMLButtonElement>();
	let sortRoot = $state<HTMLDivElement>();
	let moreRoot = $state<HTMLDivElement>();

	$effect(() => {
		if (!sortMenuOpen && !moreMenuOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node;
			if (sortMenuOpen && !sortRoot?.contains(target)) sortMenuOpen = false;
			if (moreMenuOpen && !moreRoot?.contains(target)) moreMenuOpen = false;
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	});

	function closeMenus(event: KeyboardEvent) {
		if (event.key !== 'Escape' || (!moreMenuOpen && !sortMenuOpen)) return;
		event.preventDefault();
		event.stopPropagation();
		if (moreMenuOpen) moreButton?.focus();
		else sortButton?.focus();
		moreMenuOpen = false;
		sortMenuOpen = false;
	}

	function sortLabel(key: SortKey) {
		return SORT_OPTIONS.find((option) => option.key === key)!.label;
	}

	function chooseSort(key: SortKey) {
		if (key === sortKey) toggleSortDir();
		else {
			sortKey = key;
			sortDir = SORT_OPTIONS.find((option) => option.key === key)!.defaultDir;
		}
		sortMenuOpen = false;
	}

	function toggleSortDir() {
		sortDir = sortDir === 'asc' ? 'desc' : 'asc';
	}

	function setFilter(mode: FilterMode) {
		filterMode = filterMode === mode ? 'all' : mode;
	}
</script>

<div class="chats-controls" class:compact class:mobile-search-row={mobileSearchRow}>
	{#if leading}{@render leading()}{/if}
	{#if showSearch}
	<div class="chats-search input-base">
		<Icon name="search" class="w-4 h-4 chats-search-icon" />
		<!-- The field keeps focus while the arrows drive the list below it, so the
		     pair is a combobox: focus stays here and aria-activedescendant names the
		     row the selection is on. -->
		<input
			bind:this={searchInputEl}
			type="text"
			placeholder={searchInMessages ? 'Search titles and messages…' : 'Search chats…'}
			bind:value={searchQuery}
			class="chats-search-input"
			role={listboxId ? 'combobox' : 'searchbox'}
			aria-label="Search chats"
			onkeydown={(event) => {
				if (!listboxId && event.key === 'Escape') {
					if (sortMenuOpen || moreMenuOpen) closeMenus(event);
					else searchQuery = '';
				}
			}}
			aria-expanded={listboxId ? true : undefined}
			aria-controls={listboxId}
			aria-autocomplete={listboxId ? 'list' : undefined}
			aria-activedescendant={activeDescendant}
		/>
		{#if searchingMessages}
			<span class="chats-search-spinner" aria-hidden="true"></span>
		{/if}
		{#if searchQuery}
			<button
				type="button"
				class="chats-search-btn"
				onclick={() => (searchQuery = '')}
				aria-label="Clear search"
			>
				<Icon name="close" class="w-3.5 h-3.5" />
			</button>
		{/if}
		{#if allowMessageSearch}
		<button
			type="button"
			class="chats-search-btn chats-search-deep"
			class:is-on={searchInMessages}
			aria-pressed={searchInMessages}
			title={searchInMessages
				? 'Searching message text too (the branch each chat is on)'
				: 'Search inside messages as well'}
			aria-label="Search inside messages"
			onclick={() => (searchInMessages = !searchInMessages)}
		>
			<Icon name="annotation" class="w-4 h-4" />
		</button>
		{/if}
	</div>
	{/if}

	<!-- Icon toggles remain directly accessible; the caller may give the search its
	     own line on phones so the complete action row fits below it. -->
	<button
		type="button"
		class="chats-toggle"
		class:is-on={filterMode === 'favorites'}
		aria-pressed={filterMode === 'favorites'}
		title="Show favorites only"
		aria-label="Show favorites only"
		onclick={() => setFilter('favorites')}
	>
		<Icon name="heart" class="w-4 h-4 {filterMode === 'favorites' ? 'fill-current' : ''}" />
	</button>
	<!-- Kept on screen while its own filter is on, even once the scope holds no
	     twins: a flip of the switch would otherwise take the only control that
	     can turn it back off away with it. -->
	{#if twinsInScope || filterMode === 'duplicates'}
		<button
			type="button"
			class="chats-toggle"
			class:mobile-secondary={!mobileActions}
			class:is-on={filterMode === 'duplicates'}
			aria-pressed={filterMode === 'duplicates'}
			title="Show only chats whose content is identical to another chat's"
			aria-label="Show identical chats only"
			onclick={() => setFilter('duplicates')}
		>
			<Icon name="copy" class="w-4 h-4" />
		</button>
	{/if}

	<button
		type="button"
		class="chats-toggle"
		class:mobile-secondary={!mobileActions}
		class:is-on={selecting}
		aria-pressed={selecting}
		title="Pick several chats"
		aria-label="Pick several chats"
		onclick={toggleSelecting}
	>
		<Icon name="checkCircle" class="w-4 h-4" />
	</button>

	<div class="chats-sort" bind:this={sortRoot}>
		<button
			bind:this={sortButton}
			onkeydown={closeMenus}
			type="button"
			class="chats-sort-btn"
			class:chats-sort-icon={iconSort}
			aria-label={iconSort ? 'Sort chats' : undefined}
			title={iconSort ? `Sort by ${sortLabel(sortKey)}` : undefined}
			aria-haspopup="menu"
			aria-expanded={sortMenuOpen}
			onclick={() => { moreMenuOpen = false; sortMenuOpen = !sortMenuOpen; }}
		>
			{#if iconSort}
				<Icon name="filter" class="w-4 h-4" />
			{:else}
				<span class="chats-sort-caption">Sort</span>
				<span>{sortLabel(sortKey)}</span>
				<Icon name="chevronDown" class="w-3.5 h-3.5 text-text-muted" />
			{/if}
		</button>
		<button
			type="button"
			class="chats-sort-dir mobile-secondary"
			onclick={toggleSortDir}
			title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
			aria-label="Toggle sort direction"
		>
			<Icon name={sortDir === 'asc' ? 'chevronUp' : 'chevronDown'} class="w-4 h-4" />
		</button>

		{#if sortMenuOpen}
			<div transition:menuMotion class="chats-sort-menu surface-float" role="menu" tabindex="-1" onkeydown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					sortMenuOpen = false;
					(searchInputEl ?? sortButton)?.focus();
				}
			}}>
				{#each SORT_OPTIONS as opt (opt.key)}
					<button
						type="button"
						role="menuitemradio"
						aria-checked={sortKey === opt.key}
						class="chats-menu-item"
						class:is-active={sortKey === opt.key}
						onclick={() => chooseSort(opt.key)}
					>
						<span>{opt.label}</span>
						{#if sortKey === opt.key}
							<Icon name="check" class="w-4 h-4" />
						{/if}
					</button>
				{/each}
				<div class="mobile-sort-directions" role="group" aria-label="Sort direction">
					{#each ['asc', 'desc'] as direction}
						<button
							type="button" role="menuitemradio" aria-checked={sortDir === direction}
							class="chats-menu-item" class:is-active={sortDir === direction}
							onclick={() => { sortDir = direction as SortDir; sortMenuOpen = false; }}
						>
							<Icon name={direction === 'asc' ? 'chevronUp' : 'chevronDown'} class="w-4 h-4" />
							<span>{direction === 'asc' ? 'Ascending' : 'Descending'}</span>
							{#if sortDir === direction}<Icon name="check" class="w-4 h-4" />{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
	{#if !mobileActions}
	<div class="chats-more" bind:this={moreRoot}>
		<button
			bind:this={moreButton}
			onkeydown={closeMenus}
			type="button" class="chats-toggle" class:is-on={selecting || filterMode === 'duplicates'}
			aria-label="More chat options" title="More chat options"
			aria-haspopup="menu" aria-expanded={moreMenuOpen}
			onclick={() => { sortMenuOpen = false; moreMenuOpen = !moreMenuOpen; }}
		>
			<Icon name="dotsVertical" class="w-4 h-4" />
		</button>
		{#if moreMenuOpen}
			<div transition:menuMotion class="chats-sort-menu surface-float" role="menu" aria-label="More chat options" tabindex="-1" onkeydown={closeMenus}>
				{#if twinsInScope || filterMode === 'duplicates'}
					<button type="button" role="menuitemcheckbox" aria-checked={filterMode === 'duplicates'}
						class="chats-menu-item" class:is-active={filterMode === 'duplicates'}
						onclick={() => { setFilter('duplicates'); moreMenuOpen = false; }}>
						<Icon name="copy" class="w-4 h-4" /><span>Identical chats</span>
						{#if filterMode === 'duplicates'}<Icon name="check" class="w-4 h-4" />{/if}
					</button>
				{/if}
				<button type="button" role="menuitemcheckbox" aria-checked={selecting}
					class="chats-menu-item" class:is-active={selecting}
					onclick={() => { toggleSelecting(); moreMenuOpen = false; }}>
					<Icon name="checkCircle" class="w-4 h-4" /><span>{selecting ? 'Exit selection' : 'Select chats'}</span>
					{#if selecting}<Icon name="check" class="w-4 h-4" />{/if}
				</button>
			</div>
		{/if}
	</div>
	{/if}
</div>

<!-- The picking bar: count and scope on the left, the one destructive action on the
     right. It replaces nothing above it, so the search and the filters keep working
     while a selection is being built across several queries. -->
{#if selecting}
	<div class="chats-bulk">
		<span class="chats-bulk-count"><b>{selectedCount}</b> selected</span>
		<button
			type="button"
			class="chats-bulk-link"
			onclick={selectAllVisible}
			disabled={allVisibleSelected}
		>
			All ({visibleCount})
		</button>
		<button
			type="button"
			class="chats-bulk-link"
			onclick={clearSelection}
			disabled={selectedCount === 0}
		>
			None
		</button>
		<div class="chats-bulk-spacer"></div>
		<button
			type="button"
			class="chats-bulk-delete"
			onclick={requestDelete}
			disabled={selectedCount === 0}
		>
			<Icon name="trash" class="w-3.5 h-3.5" />
			Delete {selectedCount}
		</button>
	</div>
{/if}

<style>
	.chats-controls {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}

	/* ===== Search ===== */
	/* .input-base in markup carries the border + focus ring, so the field is visible on
		  every theme instead of only while focused. */
	.chats-search {
		flex: 1 1 8rem;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.5rem 0 0.65rem;
		height: 2.4rem;
	}

	.chats-search :global(.chats-search-icon) {
		flex-shrink: 0;
		color: var(--color-text-muted);
	}

	.chats-search-input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		outline: none;
		font-family: var(--font-ui);
		font-size: 0.85rem;
		color: var(--color-text-primary);
	}

	.chats-search-input::placeholder {
		color: var(--color-text-muted);
	}

	.chats-search-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		flex-shrink: 0;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease, background-color 120ms ease;
	}

	.chats-search-btn:hover {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 85%, transparent);
	}

	.chats-search-deep.is-on {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	.chats-search-spinner {
		width: 0.85rem;
		height: 0.85rem;
		flex-shrink: 0;
		border-radius: var(--radius-full);
		border: 2px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		border-top-color: var(--color-accent);
		animation: chats-spin 700ms linear infinite;
	}

	@keyframes chats-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ===== Sort ===== */
	.chats-sort {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.chats-sort-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.75rem;
		height: 2.4rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background-color 130ms ease, border-color 130ms ease, color 130ms ease;
	}

	.chats-sort-btn:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border);
	}

	.chats-sort-icon { width: 2.4rem; padding: 0; justify-content: center; }

	.chats-sort-caption {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.chats-sort-dir {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-secondary);
		cursor: pointer;
		flex-shrink: 0;
		transition: background-color 130ms ease, border-color 130ms ease, color 130ms ease;
	}

	.chats-sort-dir:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border);
	}

	.chats-sort-menu {
		position: absolute;
		top: calc(100% + 0.4rem);
		right: 0;
		z-index: 20;
		min-width: 12rem;
		padding: 0.3rem;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	/* ===== Filter toggles ===== */
	/* Square, same height as the sort controls they sit beside. */
	.chats-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.4rem;
		height: 2.4rem;
		flex-shrink: 0;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background-color 130ms ease, border-color 130ms ease, color 130ms ease;
	}

	.chats-toggle:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border);
	}

	.chats-toggle.is-on {
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.chats-bulk {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.6rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-accent) 9%, transparent);
		font-family: var(--font-ui);
		font-size: 0.75rem;
	}

	.chats-bulk-count {
		color: var(--color-text-secondary);
	}
	.chats-bulk-count b {
		color: var(--color-text-primary);
		font-weight: 600;
	}

	.chats-bulk-link {
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease;
	}
	.chats-bulk-link:hover:not(:disabled) {
		color: var(--color-text-primary);
	}
	.chats-bulk-link:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.chats-bulk-spacer {
		flex: 1;
	}

	.chats-bulk-delete {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--color-error) 38%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-error) 9%, transparent);
		color: var(--color-error);
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, border-color 120ms ease;
	}
	.chats-bulk-delete:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-error) 60%, transparent);
		background: color-mix(in srgb, var(--color-error) 16%, transparent);
	}
	.chats-bulk-delete:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.chats-menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.chats-menu-item span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chats-menu-item:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.chats-menu-item.is-active {
		color: var(--color-accent);
	}

	.compact .chats-sort-caption { display: none; }
	.compact .chats-search { flex-basis: 6rem; }
	.chats-more { display: none; position: relative; }
	.mobile-sort-directions { display: none; border-top: 1px solid var(--color-border-subtle); margin-top: 0.3rem; padding-top: 0.3rem; }
	@media (max-width: 700px) {
		.chats-controls.mobile-search-row .chats-search { flex: 1 0 100%; order: -1; }
		/* Keep the menu's right edge inside the panel even when only a few icons precede it. */
		.mobile-search-row .chats-sort { margin-left: auto; }
	}
	@media (max-width: 560px) {
		.compact .chats-search { flex-basis: calc(100% - 7rem); }
		.mobile-secondary { display: none; }
		.chats-more, .mobile-sort-directions { display: block; }
	}
	.chats-toggle:focus-visible, .chats-sort-btn:focus-visible, .chats-sort-dir:focus-visible, .chats-search-btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
	@media (pointer: coarse) {
		.chats-search-btn { width: 2.15rem; height: 2.15rem; }
		.chats-search, .chats-sort-btn { height: 2.75rem; }
		.chats-toggle, .chats-sort-dir { width: 2.75rem; height: 2.75rem; }
		.chats-sort-icon { width: 2.75rem; }
	}
</style>
