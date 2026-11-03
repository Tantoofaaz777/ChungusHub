<script lang="ts">
	/**
	 * Find in chat: a floating bar over the message list.
	 *
	 * It replaces the browser's find for this surface, because the browser's can only ever
	 * see what a page happens to be: it can't tell a message from the chrome around it,
	 * can't count hits per turn, can't be reached from the composer, and can't see past the
	 * selected versions that happen to be rendered. This one searches the rendered story text only
	 * (`[data-search-text]` in Message.svelte), so the meta rows, token readouts and toolbars
	 * never produce phantom hits. Matches in inactive versions open an inspector without changing the conversation.
	 *
	 * The transcript window is a rendering budget, not a scope: a query loads back through its
	 * oldest match (see "Reaching past the transcript window" below), so everything the
	 * counter and the ∧/∨ cycle say is about the whole conversation.
	 *
	 * Matches are DOM Ranges painted through the CSS Custom Highlight API. See
	 * utils/chat-search.ts for why nothing here touches the message markup, and app.css
	 * ("Find in chat") for the two ::highlight() rules.
	 */
	import { onDestroy, untrack } from 'svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { chatSearch } from '#lib/stores/chatSearch.svelte.ts';
	import { chatCursor } from '#lib/stores/chatCursor.svelte.ts';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { responseVersionsStore } from '#lib/stores/responseVersions.svelte.ts';
	import { inactiveResponseVersions } from '#lib/utils/response-versions.ts';
	import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
	import { openChatSetup } from '#lib/stores/openChatSetup.svelte.ts';
	import { displaySelfRefs } from '#lib/macros.ts';
	import {
		buildSearchRegex,
		findVersionHits,
		findMatchRanges,
		MAX_VERSION_HITS,
		MAX_MATCHES
	} from '#lib/utils/chat-search.ts';
	import type { Message } from '#lib/types/chat.ts';
	import { storyRoleName } from '#lib/types/library.ts';

	interface Props {
		/** The message-list scroller: both the search root and what we scroll to a hit. */
		container: HTMLElement | undefined;
		/** The rendered transcript. Read as a change signal only: an edit, a version change
		 *  or a new turn replaces the array, which re-runs the match pass against the DOM
		 *  Svelte has just updated. */
		messages: Message[];
		/** How many turns at the START of the path the transcript window is holding back.
		 *  0 = the whole conversation is rendered and nothing below applies. */
		windowStart: number;
		/** Load earlier turns until the turn at this path index is rendered. */
		loadThrough: (index: number) => void;
	}

	let { container, messages, windowStart, loadThrough }: Props = $props();

	/** Registry keys, paired with the ::highlight() rules in app.css. */
	const HL_ALL = 'chat-find';
	const HL_CURRENT = 'chat-find-current';
	const canHighlight = typeof CSS !== 'undefined' && !!CSS.highlights;

	let matches = $state<Range[]>([]);
	let current = $state(-1);
	let inputEl = $state<HTMLInputElement | undefined>(undefined);
	let versionListOpen = $state(false);

	// ===== Other response versions =====
	// Same live expansion Message.svelte does, so a greeting's raw identity macros are
	// searchable by the name actually on screen (architecture/chat-sessions.md coupling 6).
	let selfRefChar = $derived.by(() => {
		const entry = characterLibraryStore.entries.find(
			(e) => e.id === chatStore.activeChat?.characterId && e.type === 'character'
		);
		return entry ? storyRoleName(entry.identity) || 'Character' : 'Character';
	});
	let selfRefUser = $derived(
		openChatSetup.persona ? storyRoleName(openChatSetup.persona.identity) || 'You' : 'You'
	);
	let selfRefPronouns = $derived(
		openChatSetup.persona ? openChatSetup.persona.identity.pronouns ?? {} : undefined
	);

	let versionHits = $derived.by(() => {
		const regex = buildSearchRegex(chatSearch.query, {
			matchCase: chatSearch.matchCase,
			wholeWord: chatSearch.wholeWord
		});
		if (!regex) return [];
		const versions = inactiveResponseVersions(messages).map(version => ({
			messageId: version.message.id, variantId: version.variantId!, ordinal: version.ordinal, versionIndex: version.index,
			text: displaySelfRefs(version.message.content, selfRefChar, selfRefUser, selfRefPronouns)
		}));
		return findVersionHits(versions, regex, MAX_VERSION_HITS);
	});

	let capped = $derived(matches.length >= MAX_MATCHES);
	let countLabel = $derived.by(() => {
		if (!chatSearch.query) return '';
		if (matches.length) return `${current + 1} / ${matches.length}${capped ? '+' : ''}`;
		// Until the scan behind the window has come back, any verdict would be a claim about
		// turns the search has not reached yet.
		if (!earlierChecked) return 'Searching…';
		// "No matches" would be a lie while the version list holds some; say where they aren't.
		return versionHits.length ? 'None in selected versions' : 'No matches';
	});

	// ===== Reaching past the transcript window =====
	// The window renders the newest stretch of a long conversation (architecture/chat-sessions.md
	// coupling 14). A search that quietly stopped at its top edge would answer "no matches"
	// about a story that has them, so a query loads back through its OLDEST match and every
	// hit above then becomes an ordinary on-screen one, counted and cycled like the rest.
	//
	// The scan reads the stored rows, since an unrendered turn has no DOM: the same asymmetry
	// the version list lives with, so a hit that exists only once a display regex rule has run
	// is not seen from here. It is debounced because find-as-you-type walks through prefixes
	// ("h", "ha", …) that match far more of the story than the word being typed.
	const EARLIER_SCAN_MS = 250;
	/** False while a scan is owed: the counter must not call a search empty before then. */
	let earlierChecked = $state(true);
	/** Set beside a load this bar asked for, so the pass that sees those turns knows nothing
	 *  else has placed the view. */
	let pendingGrowth = false;

	$effect(() => {
		const hidden = windowStart;
		const path = messages;
		const char = selfRefChar;
		const user = selfRefUser;
		const pronouns = selfRefPronouns;
		const regex = buildSearchRegex(chatSearch.query, {
			matchCase: chatSearch.matchCase,
			wholeWord: chatSearch.wholeWord
		});
		if (!regex || hidden <= 0) {
			earlierChecked = true;
			return;
		}
		earlierChecked = false;
		const timer = setTimeout(() => {
			for (let i = 0; i < hidden; i++) {
				// Global regex: its cursor has to be rewound per turn.
				regex.lastIndex = 0;
				if (regex.test(displaySelfRefs(path[i].content, char, user, pronouns))) {
					pendingGrowth = true;
					loadThrough(i);
					return;
				}
			}
			earlierChecked = true;
		}, EARLIER_SCAN_MS);
		return () => clearTimeout(timer);
	});

	// Both plain lets, not $state: bookkeeping the effect below reads, where reactivity
	// would only buy it a redundant re-run.
	//
	// What the current `matches` were computed for.
	let searchKey = '';

	$effect(() => {
		// Flags first, at fixed width, then the raw query: no separator can be ambiguous
		// because the first two characters are always the flags.
		const key = `${chatSearch.matchCase ? 'C' : 'c'}${chatSearch.wholeWord ? 'W' : 'w'}${chatSearch.query}`;
		const root = container;
		void messages;
		// Earlier turns arriving is a DOM change like any other, and their hits are ours.
		void windowStart;
		// Nothing rendered yet. Leave searchKey alone so the first real pass still counts
		// as a new search and jumps to its first hit.
		if (!root) return;

		// The cursor follows the HIT, not its number: turns loading above prepend ranges, so
		// a cursor kept by index would silently slide onto an older match. The turns already
		// on screen keep their nodes across a load (the each block is keyed and renderedHtml
		// patches in place), so node identity is what survives.
		const anchor = untrack(() => (current >= 0 ? (matches[current] ?? null) : null));

		const regex = buildSearchRegex(chatSearch.query, {
			matchCase: chatSearch.matchCase,
			wholeWord: chatSearch.wholeWord
		});
		const found: Range[] = [];
		if (regex) {
			for (const turn of root.querySelectorAll('[data-search-text]')) {
				found.push(...findMatchRanges(turn, regex, MAX_MATCHES - found.length));
				if (found.length >= MAX_MATCHES) break;
			}
		}

		const isNewSearch = key !== searchKey;
		const anchored = anchor
			? found.findIndex(
					(r) => r.startContainer === anchor.startContainer && r.startOffset === anchor.startOffset
				)
			: -1;
		searchKey = key;
		matches = found;
		// Untracked: the cursor is an OUTPUT of this pass, and reading it as a dependency
		// would make every write re-run the whole DOM walk a second time per keystroke.
		untrack(() => {
			const grown = pendingGrowth;
			pendingGrowth = false;
			if (isNewSearch) {
				// Find-as-you-type: land on the first hit the moment one exists.
				current = found.length ? 0 : -1;
				if (found.length) reveal(found[0], grown ? 'instant' : 'smooth');
				return;
			}
			if (anchored >= 0) current = anchored;
			else if (current < 0 || current >= found.length) {
				// The transcript changed under us; keep a valid cursor without moving the view.
				current = found.length ? Math.min(Math.max(current, 0), found.length - 1) : -1;
			}
			// Park back on the hit the reader is on, instantly: the scroller's CSS glide would
			// otherwise travel the whole stretch that just loaded above it.
			if (grown && current >= 0) reveal(found[current], 'instant');
		});
	});

	$effect(() => {
		if (!canHighlight) return;
		const all = matches;
		const active = current >= 0 ? all[current] : undefined;
		if (all.length) CSS.highlights.set(HL_ALL, new Highlight(...all));
		else CSS.highlights.delete(HL_ALL);
		if (active) {
			const one = new Highlight(active);
			// Explicit, not registration order: the current hit always paints over the wash.
			one.priority = 1;
			CSS.highlights.set(HL_CURRENT, one);
		} else {
			CSS.highlights.delete(HL_CURRENT);
		}
		return () => {
			CSS.highlights.delete(HL_ALL);
			CSS.highlights.delete(HL_CURRENT);
		};
	});

	// A search hit is a temporary mark, never a focus request. Track the mark this bar owns
	// so every way of closing it clears the ring without opening the mobile keyboard.
	let markedMessageId: string | null = null;
	function clearSearchMark(): void {
		untrack(() => {
			if (markedMessageId && chatCursor.id === markedMessageId) chatCursor.clear();
			markedMessageId = null;
		});
	}
	onDestroy(clearSearchMark);
	$effect(() => {
		const active = current >= 0 ? matches[current] : undefined;
		if (!active) { clearSearchMark(); return; }
		const start = active.startContainer;
		const from = start.nodeType === Node.TEXT_NODE ? start.parentElement : (start as Element);
		const host = from?.closest<HTMLElement>('[id^="msg-"]');
		if (host) {
			markedMessageId = host.id.slice('msg-'.length);
			chatCursor.mark(markedMessageId);
		} else clearSearchMark();
	});

	/** Keep the reading position; unmount cleanup releases the temporary search mark. */
	function close(): void {
		chatSearch.close();
	}

	// Every open request focuses the field and selects what's in it, so re-triggering the
	// bar while it is already up behaves like a fresh open instead of doing nothing.
	$effect(() => {
		void chatSearch.openNonce;
		inputEl?.focus();
		inputEl?.select();
	});

	/** Scroll a hit into the reading zone. The scroller carries `scroll-behavior: smooth`, so
	 *  the default glides exactly like the list's own jump-to-latest; `instant` is for the one
	 *  case that must not glide, re-parking after earlier turns have loaded above, and it is
	 *  the only value that overrides that CSS (`auto` defers to it). */
	function reveal(range: Range, behavior: ScrollBehavior = 'smooth') {
		if (!container) return;
		const hit = range.getBoundingClientRect();
		const host = container.getBoundingClientRect();
		// Parked above centre: this bar floats over the top of the list, and reading
		// continues downward from the match.
		const target = container.scrollTop + (hit.top - host.top) - container.clientHeight * 0.38;
		container.scrollTo({
			top: Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight)),
			behavior
		});
	}

	function go(direction: 1 | -1) {
		if (!matches.length) return;
		current = (current + direction + matches.length) % matches.length;
		reveal(matches[current]);
		// The buttons never take the caret: Enter has to keep cycling after a click, and a
		// click that quietly disarmed the keyboard would be the worse surprise.
		inputEl?.focus();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			go(e.shiftKey ? -1 : 1);
		} else if (e.key === 'Escape') {
			// Consume it: the workspace's global Escape would otherwise also close the
			// panel hosting this chat (shell Esc contract, architecture/ui-shell-settings.md).
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}
</script>

<div class="find-bar surface-float shadow-md fade-in" role="search" aria-label="Find in chat">
	<div class="find-row">
		<Icon name="search" class="w-4 h-4 shrink-0 text-text-muted" />
		<input
			bind:this={inputEl}
			bind:value={chatSearch.query}
			type="text"
			class="find-input"
			placeholder="Find in this chat…"
			aria-label="Find in this chat"
			autocomplete="off"
			spellcheck="false"
			onkeydown={onKeydown}
		/>
		<span
			class="find-count"
			class:find-count--none={!!chatSearch.query &&
				earlierChecked &&
				!matches.length &&
				!versionHits.length}
			aria-live="polite"
		>
			{countLabel}
		</span>
		<button
			type="button"
			class="find-btn"
			disabled={!matches.length}
			aria-label="Previous match"
			title="Previous match (Shift+Enter)"
			onclick={() => go(-1)}
		>
			<Icon name="chevronUp" class="w-4 h-4" />
		</button>
		<button
			type="button"
			class="find-btn"
			disabled={!matches.length}
			aria-label="Next match"
			title="Next match (Enter)"
			onclick={() => go(1)}
		>
			<Icon name="chevronDown" class="w-4 h-4" />
		</button>
		<button
			type="button"
			class="find-btn"
			aria-label="Close search"
			title="Close (Esc)"
			onclick={close}
		>
			<Icon name="close" class="w-4 h-4" />
		</button>
	</div>

	<div class="find-opts">
		<button
			type="button"
			class="find-pill"
			class:find-pill--on={chatSearch.matchCase}
			aria-pressed={chatSearch.matchCase}
			title="Distinguish upper and lower case"
			onclick={() => (chatSearch.matchCase = !chatSearch.matchCase)}
		>
			Match case
		</button>
		<button
			type="button"
			class="find-pill"
			class:find-pill--on={chatSearch.wholeWord}
			aria-pressed={chatSearch.wholeWord}
			title="Only match complete words"
			onclick={() => (chatSearch.wholeWord = !chatSearch.wholeWord)}
		>
			Whole words
		</button>
		{#if !canHighlight}
			<span class="find-note">Highlighting needs a newer browser. Hits still scroll into view.</span>
		{/if}

		{#if versionHits.length}
			<button
				type="button"
				class="find-version-toggle"
				aria-expanded={versionListOpen}
				title="Inspect matches in other saved versions"
				onclick={() => (versionListOpen = !versionListOpen)}
			>
				<Icon
					name="chevronRight"
					class="w-3 h-3 transition-transform {versionListOpen ? 'rotate-90' : ''}"
				/>
				{versionHits.length}{versionHits.length >= MAX_VERSION_HITS ? '+' : ''} in other versions
			</button>
		{/if}
	</div>

	{#if versionListOpen && versionHits.length}
		<ul class="find-versiones">
			{#each versionHits as hit (`${hit.messageId}:${hit.variantId}`)}
				<li>
					<button type="button" class="find-version-row" title={hit.snippet} onclick={() => responseVersionsStore.show(chatStore.activeChatId!, hit.messageId, hit.variantId)}>
						<span class="find-version-role">#{hit.ordinal} · Version {hit.versionIndex + 1}</span>
						<span class="find-version-snippet">{hit.snippet}</span>
						{#if hit.count > 1}<span class="find-version-count">{hit.count}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	/* Centred by auto margins between pinned edges, NOT left:50% + translateX(-50%): the
	   .fade-in entry animation animates `transform`, which would override the centring
	   translate for its whole duration and slide the bar in from half a width to the
	   right before snapping into place. */
	.find-bar {
		position: absolute;
		top: 0.6rem;
		left: 0;
		right: 0;
		margin-inline: auto;
		z-index: 12;
		width: min(30rem, calc(100% - 1.2rem));
		padding: 0.4rem 0.45rem 0.42rem 0.6rem;
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.find-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.find-input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		color: var(--color-text-primary);
		outline: none;
	}

	.find-input::placeholder {
		color: var(--color-text-muted);
	}

	.find-count {
		flex-shrink: 0;
		padding-right: 0.15rem;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.find-count--none {
		color: var(--color-error);
	}

	.find-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, transform 90ms ease;
	}

	.find-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
		color: var(--color-text-primary);
	}

	/* Cycling to the next hit can be invisible (one match, or a hit already on screen),
	   so the press itself has to answer. Accent tint plus a real depress. */
	.find-btn:active:not(:disabled) {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		color: var(--color-accent);
		transform: scale(0.88);
		transition-duration: 0ms;
	}

	.find-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	@media (pointer: coarse) {
		.find-btn {
			width: 2.3rem;
			height: 2.3rem;
		}
	}

	.find-opts {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem;
		padding-top: 0.32rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.find-pill {
		padding: 0.16rem 0.5rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.find-pill:hover {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
	}

	/* Local copy of the active-tint recipe, declared after :hover so source order wins the
	   tie: a scoped rule always beats the layered global .is-active-tint (see app.css). */
	.find-pill--on {
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		color: var(--color-accent);
	}

	.find-note {
		font-family: var(--font-ui);
		font-size: 0.62rem;
		line-height: 1.3;
		color: var(--color-warning);
	}

	/* ===== Other response versions ===== */

	/* Takes the free end of the options row, so the bar stays two rows tall until the
	   reader actually opens the list. */
	.find-version-toggle {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.22rem;
		padding: 0.16rem 0.4rem 0.16rem 0.28rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 600;
		color: var(--color-accent);
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.find-version-toggle:hover {
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.find-versiones {
		margin: 0;
		padding: 0.28rem 0 0;
		list-style: none;
		border-top: 1px solid var(--color-border-subtle);
		max-height: 11rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.find-version-row {
		width: 100%;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.26rem 0.4rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.find-version-row:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
	}

	.find-version-role {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.find-version-snippet {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-body);
		font-size: 0.74rem;
		color: var(--color-text-secondary);
	}

	.find-version-count {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 600;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
