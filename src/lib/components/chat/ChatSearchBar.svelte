<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { chatSearch } from '#lib/stores/chatSearch.svelte.ts';
	import { chatCursor } from '#lib/stores/chatCursor.svelte.ts';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { chatDisplay } from '#lib/stores/chat-display.svelte.ts';
	import { responseVersionsStore } from '#lib/stores/responseVersions.svelte.ts';
	import { inactiveResponseVersions } from '#lib/utils/response-versions.ts';
	import {
		buildSearchRegex,
		findVersionHits,
		findMatchRanges,
		searchTextSegments,
		MAX_VERSION_HITS,
		MAX_MATCHES
	} from '#lib/utils/chat-search.ts';
	import { renderMarkdown } from '#lib/utils/markdown.ts';
	import type { Message } from '#lib/types/chat.ts';

	interface Props {
		container: HTMLElement | undefined;
		messages: Message[];
		shown: Message[];
		showTurn: (index: number) => void;
		streamingTurnOffset: number;
	}

	interface Hit {
		id: string;
		index: number;
		occurrence: number;
	}

	let { container, messages, shown, showTurn, streamingTurnOffset }: Props = $props();

	const HL_ALL = 'chat-find';
	const HL_CURRENT = 'chat-find-current';
	const canHighlight = typeof CSS !== 'undefined' && !!CSS.highlights;

	let matches = $state.raw<Hit[]>([]);
	let current = $state(-1);
	let pending = $state(false);
	let inputEl = $state<HTMLInputElement | undefined>(undefined);
	let versionListOpen = $state(false);
	let markedMessageId: string | null = null;
	let completedKey = '';
	let revealNonce = 0;
	const textCache = new Map<string, { text: string; segments: string[] }>();

	const regex = $derived(buildSearchRegex(chatSearch.query, {
		matchCase: chatSearch.matchCase,
		wholeWord: chatSearch.wholeWord
	}));
	const searchKey = $derived(`${chatSearch.matchCase ? 'C' : 'c'}${chatSearch.wholeWord ? 'W' : 'w'}${chatSearch.query}`);
	const versionHits = $derived.by(() => {
		if (!regex) return [];
		const versions = inactiveResponseVersions(messages).map(version => ({
			messageId: version.message.id, variantId: version.variantId!, ordinal: version.ordinal, versionIndex: version.index,
			text: chatDisplay.expand(version.message.content)
		}));
		return findVersionHits(versions, regex, MAX_VERSION_HITS);
	});
	const countLabel = $derived.by(() => {
		if (!chatSearch.query) return '';
		if (pending) return 'Searching…';
		if (matches.length) return `${current + 1} / ${matches.length}${matches.length >= MAX_MATCHES ? '+' : ''}`;
		return versionHits.length ? 'None in selected versions' : 'No matches';
	});

	// Use the same display rules and markdown as the transcript. Off-screen turns are
	// searched in a reusable detached element. Only the plain text segments are cached.
	$effect(() => {
		const pattern = regex;
		const key = searchKey;
		const ticket = ++revealNonce;
		if (!pattern) {
			matches = [];
			current = -1;
			pending = false;
			completedKey = '';
			clearSearchMark();
			return;
		}

		const path = messages.map((message, index) => ({
			id: message.id,
			text: chatDisplay.text(message.content, message.role, messages.length - 1 - index + streamingTurnOffset)
		}));
		const ids = new Set(path.map(turn => turn.id));
		for (const id of textCache.keys()) {
			if (!ids.has(id)) textCache.delete(id);
		}

		pending = true;
		const scratch = document.createElement('div');
		const found: Hit[] = [];
		let index = 0;
		let timer = setTimeout(scanBatch, 160);

		function scanBatch() {
			const deadline = performance.now() + 8;
			while (index < path.length && found.length < MAX_MATCHES) {
				const { id, text } = path[index];
				let cached = textCache.get(id);
				if (!cached || cached.text !== text) {
					scratch.innerHTML = renderMarkdown(text);
					cached = { text, segments: searchTextSegments(scratch) };
					textCache.set(id, cached);
				}
				let occurrence = 0;
				for (const segment of cached.segments) {
					for (const _ of segment.matchAll(pattern!)) {
						found.push({ id, index, occurrence: occurrence++ });
						if (found.length >= MAX_MATCHES) break;
					}
					if (found.length >= MAX_MATCHES) break;
				}
				index++;
				if (performance.now() >= deadline) break;
			}
			scratch.replaceChildren();
			if (index < path.length && found.length < MAX_MATCHES) {
				timer = setTimeout(scanBatch, 0);
				return;
			}
			if (ticket !== revealNonce) return;
			const previous = matches[current];
			const kept = key === completedKey && previous
				? found.findIndex(hit => hit.id === previous.id && hit.occurrence === previous.occurrence)
				: -1;
			completedKey = key;
			matches = found;
			current = kept >= 0 ? kept : found.length ? 0 : -1;
			pending = false;
			if (kept < 0 && found.length) void revealHit(found[0]);
			else if (!found.length) clearSearchMark();
		}
		return () => clearTimeout(timer);
	});

	function rowOf(id: string) {
		return document.getElementById(`msg-${id}`);
	}

	$effect(() => {
		const pattern = regex;
		const active = matches[current];
		if (!canHighlight || !pattern || pending || !container) return;
		const ranges: Range[] = [];
		let currentRange: Range | undefined;
		for (const message of shown) {
			const body = rowOf(message.id)?.querySelector('[data-search-text]');
			if (!body) continue;
			const hits = findMatchRanges(body, pattern, MAX_MATCHES - ranges.length);
			if (active?.id === message.id) currentRange = hits[active.occurrence];
			ranges.push(...hits);
			if (ranges.length >= MAX_MATCHES) break;
		}
		if (ranges.length) CSS.highlights.set(HL_ALL, new Highlight(...ranges));
		if (currentRange) {
			const one = new Highlight(currentRange);
			one.priority = 1;
			CSS.highlights.set(HL_CURRENT, one);
		}
		return () => {
			CSS.highlights.delete(HL_ALL);
			CSS.highlights.delete(HL_CURRENT);
		};
	});

	function clearSearchMark(): void {
		untrack(() => {
			if (markedMessageId && chatCursor.id === markedMessageId) chatCursor.clear();
			markedMessageId = null;
		});
	}
	onDestroy(() => { revealNonce++; clearSearchMark(); });

	async function revealHit(hit: Hit) {
		const pattern = regex;
		if (!pattern) return;
		const ticket = ++revealNonce;
		const wasMounted = !!rowOf(hit.id);
		showTurn(hit.index);
		await tick();
		if (ticket !== revealNonce || !container) return;
		const row = rowOf(hit.id);
		if (!row) return;
		const body = row.querySelector('[data-search-text]');
		const range = body && findMatchRanges(body, pattern, hit.occurrence + 1)[hit.occurrence];
		const behavior = wasMounted ? 'smooth' : 'instant';
		markedMessageId = hit.id;
		chatCursor.mark(hit.id);
		if (range) reveal(range, behavior);
		else row.scrollIntoView({ block: 'center', behavior });
	}

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

	/** Scroll a mounted match below the search bar. A newly loaded window lands instantly. */
	function reveal(range: Range, behavior: ScrollBehavior) {
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
		if (pending || !matches.length) return;
		current = (current + direction + matches.length) % matches.length;
		void revealHit(matches[current]);
		// The buttons never take the caret: Enter has to keep cycling after a click, and a
		// click that quietly disarmed the keyboard would be the worse surprise.
		inputEl?.focus({ preventScroll: true });
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
				!pending &&
				!matches.length &&
				!versionHits.length}
			aria-live="polite"
		>
			{countLabel}
		</span>
		<button
			type="button"
			class="find-btn"
			disabled={pending || !matches.length}
			aria-label="Previous match"
			title="Previous match (Shift+Enter)"
			onclick={() => go(-1)}
		>
			<Icon name="chevronUp" class="w-4 h-4" />
		</button>
		<button
			type="button"
			class="find-btn"
			disabled={pending || !matches.length}
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
