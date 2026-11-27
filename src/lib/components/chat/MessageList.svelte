<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import SceneSelectionBar from '#lib/components/memory/SceneSelectionBar.svelte';
	import type { Message } from '#lib/types/chat.ts';
	import MessageComponent, { type MessageEditDraft } from './Message.svelte';
	import StreamingIndicator from './StreamingIndicator.svelte';
	import OpeningScenePopover from './OpeningScenePopover.svelte';
	import ChatSearchBar from './ChatSearchBar.svelte';
	import { chatSearch } from '#lib/stores/chatSearch.svelte.ts';
	import { chatCursor } from '#lib/stores/chatCursor.svelte.ts';
	import { messageStore } from '#lib/stores/messages.svelte.ts';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { memoryStore } from '#lib/memory/scene-store.svelte.ts';
	import { featurePromptsStore } from '#lib/stores/featurePrompts.svelte.ts';
	import { generalSettingsStore } from '#lib/stores/general-settings.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import Icon from '#lib/components/ui/Icon.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { reducedMotion } from '#lib/components/ui/surface-motion.ts';
	import { transcriptChange } from '#lib/utils/response-versions.ts';

	interface Props {
		messages: Message[];
		allMessages: Message[];
		isStreaming?: boolean;
		streamingContent?: string;
		streamingThinking?: string;
		/** Set while a continue streams into an existing turn: that bubble renders the
		 *  live tail and the streaming-indicator bubble stays out of the list. */
		continuingMessageId?: string | null;
		replacingMessageId?: string | null;
		/** Set while an opening scene streams: the path stays off screen and the streaming
		 *  bubble stands alone, since a new beginning is not a turn after the ones there. */
		openingSceneStream?: boolean;
		// Exposed so the parent can forward wheel from the empty margins beside the
		// centered column into this scroller (compiler-checked, so a rename can't
		// silently break the forwarding).
		scrollEl?: HTMLDivElement;
		/** Scroll offset change caused by shifting the window while holding the reading position. */
		onContentShift?: (delta: number) => void;
	}

	let {
		messages,
		allMessages,
		isStreaming = false,
		streamingContent = '',
		streamingThinking = '',
		continuingMessageId = null,
		replacingMessageId = null,
		openingSceneStream = false,
		scrollEl = $bindable(),
		onContentShift
	}: Props = $props();

	// Scene summaries can cover any range; their original messages keep the dim treatment.
	let archivedIds = $derived(memoryStore.archivedMessageIds);
	let selectedIds = $derived(new Set(memoryStore.selectedMessages.map((m) => m.id)));

	let openingDialogOpen = $state(false);

	// The store toasts its own generation failures; what reaches here is the guards it throws
	// on before the try (engine off, no chat), which the trigger already prevents. Catching
	// keeps one of those from surfacing as an unhandled rejection instead of a message.
	async function handleGenerateOpeningScene(direction: string) {
		try {
			await messageStore.generateOpeningScene(direction);
		} catch (error) {
			toastStore.failed('generate the opening scene', error);
		}
	}

	// $state, not a plain let: the scroller is handed down to ChatSearchBar as a prop, so
	// the binding landing has to be a reactive change, not a silent one-way write.
	let listElement = $state<HTMLDivElement | undefined>(undefined);
	// Hand the scroller to the parent so it can forward margin wheel into it.
	$effect(() => {
		scrollEl = listElement;
	});
	let prevLastMessageId: string | null = null;
	let prevLastVariantId: string | null = null;
	let prevChatId: string | null = null;
	let prevIsStreaming = false;
	const editorDrafts = new SvelteMap<string, MessageEditDraft>();

	// A reply landing in its own bubble is a turn the stored rows don't have yet, so while
	// it streams every one of them sits one turn further back than its index says. Depth is
	// what a depth-bounded regex rule measures against (architecture/prompt-pipeline.md), and
	// without this the newest reply would flip between turn 0 and turn 1 as a stream starts
	// and settles. A continue writes into a row that already exists, so it adds no turn.
	let streamingTurnOffset = $derived(isStreaming && !continuingMessageId && !replacingMessageId ? 1 : 0);

	// Auto-pinning follows the stream only while the user is near the bottom;
	// scrolling up to read hands them the reins until they come back (or jump).
	const NEAR_BOTTOM_PX = 120;
	let nearBottom = $state(true);
	let hasUnseen = $state(false);
	// Button visibility measures the edges exactly; the wider pin band only controls streaming.
	let awayFromTop = $state(false);
	let awayFromBottom = $state(false);
	let lastScrollTop = 0;
	let navigationNonce = 0;
	// Set right before a programmatic snap so the resulting scroll event isn't mistaken for
	// the user scrolling. Otherwise our own auto-follow reads as intent and releases the pin.
	let programmaticScroll = false;

	function updateScrollBounds(): void {
		if (!listElement) return;
		awayFromTop = listElement.scrollTop > 1;
		awayFromBottom = listElement.scrollHeight - listElement.clientHeight - listElement.scrollTop > 1;
	}

	/** Images, reasoning panels and viewport changes can move an edge without a scroll event. */
	function observeScrollBounds(node: HTMLElement) {
		const observer = new ResizeObserver(() => {
			updateScrollBounds();
			fitWindow();
		});
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	/** `smooth` is for a deliberate travel (the jump-to-latest pill). The auto-follow uses
	 *  `instant`, the only value that overrides this scroller's CSS `scroll-behavior: smooth`
	 *  (`auto` defers to that CSS, and so does a plain `scrollTop` write): an animated snap
	 *  fires a whole run of scroll events and the guard below only covers the first, so the
	 *  rest would be read as the user scrolling mid-glide. */
	function snapToBottom(behavior: ScrollBehavior = 'instant') {
		if (!listElement) return;
		// Clamped: a transcript shorter than the viewport has a negative overflow, and a write
		// the browser clamps back to 0 is exactly the no-op the guard must not be armed for.
		if (laterCount > 0) return;
		const top = Math.max(0, listElement.scrollHeight - listElement.clientHeight);
		// Already there, and a write that moves nothing fires no scroll event, so arming the
		// guard for it leaves it armed. It then swallows the user's first real scroll-up, the
		// pin stays set, and the next token drags them back down.
		if (Math.abs(listElement.scrollTop - top) < 1) return;
		programmaticScroll = true;
		listElement.scrollTo({ top, behavior });
		// Read back rather than assuming `top`: a smooth scroll has not moved yet, and the
		// glide's own events must read as downward, not as a jump backwards.
		lastScrollTop = listElement.scrollTop;
	}

	function updateNearBottom() {
		const el = listElement;
		if (!el) return;
		updateScrollBounds();
		const top = el.scrollTop;
		const distance = el.scrollHeight - top - el.clientHeight;
		const direction = Math.sign(top - lastScrollTop);
		lastScrollTop = top;
		if (loadPending) return;
		if (programmaticScroll) {
			programmaticScroll = false;
		} else {
			nearBottom = laterCount === 0 && direction >= 0 && distance <= NEAR_BOTTOM_PX;
		}
		if (nearBottom) {
			topAnchor = null;
			hasUnseen = false;
		} else if (!topAnchor && paging && messages.length) {
			setWindowStart(windowStart);
		}
		if (manualLoad) return;
		if (direction < 0 && top < LOAD_EDGE_PX) void shiftWindow(-1);
		if (direction > 0 && distance < LOAD_EDGE_PX) void shiftWindow(1);
	}

	async function jumpToLatest() {
		const el = listElement;
		if (!el) return;
		const changed = laterCount > 0;
		const navigation = ++navigationNonce;
		const chatId = pathChatId;
		loadPending = false;
		nearBottom = true;
		hasUnseen = false;
		topAnchor = null;
		await tick();
		if (navigation !== navigationNonce || el !== listElement || chatId !== pathChatId) return;
		snapToBottom(changed || reducedMotion(el) ? 'instant' : 'smooth');
		updateScrollBounds();
	}

	async function jumpToFirst() {
		const el = listElement;
		if (!el || !messages.length) return;
		const changed = windowStart > 0;
		const navigation = ++navigationNonce;
		const chatId = pathChatId;
		loadPending = false;
		nearBottom = false;
		programmaticScroll = false;
		setWindowStart(0);
		await tick();
		if (navigation !== navigationNonce || el !== listElement || chatId !== pathChatId) return;
		el.scrollTo({ top: 0, behavior: changed || reducedMotion(el) ? 'instant' : 'smooth' });
		lastScrollTop = el.scrollTop;
		updateScrollBounds();
	}

	// Paging bounds the mounted rows; the path used by prompts, Memory and search stays intact.
	const LOAD_EDGE_PX = 240;
	let paging = $derived(generalSettingsStore.transcriptPaging);
	let pageSize = $derived(generalSettingsStore.transcriptPageSize);
	let manualLoad = $derived(generalSettingsStore.transcriptLoadMode === 'button');
	let pathChatId = $derived(chatStore.currentChatState?.chat.id ?? null);
	let viewportFit = $state<{ chatId: string | null; pageSize: number; size: number } | null>(null);
	let windowSize = $derived(viewportFit?.chatId === pathChatId && viewportFit.pageSize === pageSize
		? viewportFit.size : pageSize);

	// A null anchor follows the newest turns. While reading back, the first row's ID
	// keeps the window in place through appends and edits to the path above it.
	let topAnchor = $state<{ chatId: string | null; messageId: string; index: number } | null>(null);
	let latestStart = $derived(paging ? Math.max(0, messages.length - windowSize) : 0);
	let windowStart = $derived.by(() => {
		if (!paging || !topAnchor || topAnchor.chatId !== pathChatId) return latestStart;
		const index = messages.findIndex(message => message.id === topAnchor?.messageId);
		return Math.min(index < 0 ? topAnchor.index : index, latestStart);
	});
	let windowEnd = $derived(paging ? Math.min(messages.length, windowStart + windowSize) : messages.length);
	let laterCount = $derived(messages.length - windowEnd);
	let shown = $derived(messages.slice(windowStart, windowEnd));
	let shiftSize = $derived(Math.max(1, Math.floor(windowSize / 4)));
	let showJumpToFirst = $derived(!openingSceneStream && (awayFromBottom || laterCount > 0) && (windowStart > 0 || awayFromTop));
	let showJumpToLatest = $derived(!openingSceneStream && (laterCount > 0 || awayFromBottom));
	let loadPending = false;

	function setWindowStart(index: number) {
		const message = paging ? messages[index] : undefined;
		topAnchor = message ? { chatId: pathChatId, messageId: message.id, index } : null;
	}

	function rowAt(index: number) {
		const message = messages[index];
		return message ? document.getElementById(`msg-${message.id}`) : null;
	}

	function showTurn(index: number) {
		if (!paging || index < 0 || index >= messages.length || (index >= windowStart && index < windowEnd)) return;
		navigationNonce++;
		loadPending = false;
		nearBottom = false;
		programmaticScroll = false;
		setWindowStart(Math.min(latestStart, Math.max(0, index - Math.floor(windowSize / 2))));
	}

	/** Move the window with an overlap and keep a retained row at its previous screen position.
	 *  Measuring the row also accounts for scroll anchoring and content changing during the move. */
	async function shiftWindow(direction: -1 | 1) {
		const el = listElement;
		let start = Math.min(latestStart, Math.max(0, windowStart + direction * shiftSize));
		if (loadPending || !el || start === windowStart) return;
		// On small windows with short turns, reduce the step if the far edge would
		// remove visible rows. Always allow one turn so a full viewport can advance.
		const viewport = el.getBoundingClientRect();
		while (Math.abs(start - windowStart) > 1) {
			const end = start + windowSize - 1;
			const retainedEdge = rowAt(direction > 0 ? start : end)?.getBoundingClientRect();
			if (!retainedEdge) return;
			const clipsVisibleRows = direction > 0 ? retainedEdge.top > viewport.top : retainedEdge.bottom < viewport.bottom;
			if (!clipsVisibleRows) break;
			start -= direction;
		}
		const held = rowAt(Math.max(start, windowStart));
		if (!held) return;
		const heldTop = held.getBoundingClientRect().top;
		const scrollBefore = el.scrollTop;
		const navigation = navigationNonce;
		loadPending = true;
		nearBottom = false;
		setWindowStart(start);
		await tick();
		if (navigation !== navigationNonce) return;
		loadPending = false;
		if (!held.isConnected || el !== listElement) return;
		const shift = held.getBoundingClientRect().top - heldTop;
		if (shift) el.scrollTo({ top: el.scrollTop + shift, behavior: 'instant' });
		lastScrollTop = el.scrollTop;
		const travelled = el.scrollTop - scrollBefore;
		if (travelled) onContentShift?.(travelled);
		updateScrollBounds();
	}

	// Tiny turns on a tall screen may not provide any scrollable space. Grow only enough
	// to make the adjacent history reachable, then use that size for the moving window.
	function fitWindow() {
		const el = listElement;
		if (!paging || manualLoad || openingSceneStream || !el?.clientHeight ||
			windowSize >= messages.length || el.scrollHeight > el.clientHeight) return;
		viewportFit = { chatId: pathChatId, pageSize, size: Math.min(messages.length, windowSize + pageSize) };
		if (nearBottom) {
			const navigation = navigationNonce;
			void tick().then(() => {
				if (navigation === navigationNonce && nearBottom) snapToBottom();
			});
		}
	}

	$effect(() => {
		// The path's own chat, not the store's active id: that id names the chat being opened
		// a flush before its path arrives, so keyed to it this reads the swap as a chat change
		// against the PREVIOUS story's rows, and then reads the new story's rows as a version
		// switch, which is the one case that deliberately does not scroll. Opening a chat would
		// land wherever the last one's scroll offset happened to survive the swap.
		const chatId = pathChatId;
		const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
		const lastVariantId = messages.at(-1)?.selectedVariantId ?? null;
		const change = transcriptChange({ id: prevLastMessageId, variantId: prevLastVariantId }, messages);
		const isNewMessage = change !== 'same';
		// An appended turn EXTENDS the previous path, so the old leaf is still on it. A
		// A swipe changes the selected version; deletion replaces the tail.
		// Extensions follow the existing pin; replacements preserve the reading position.
		const isExtension = change === 'append';
		// Track the stream so pinning follows tokens, not just message inserts.
		void streamingContent;
		void streamingThinking;
		// The settled turn replaces the streaming bubble in place, so nobody needs moving for
		// it: a pinned reader is already at the bottom, and one who scrolled up to read must
		// not be thrown to the end by the last frame of a reply they already left behind.
		const streamSettled = chatId === prevChatId && prevIsStreaming && !isStreaming;

		if (listElement) {
			if (chatId !== prevChatId) {
				navigationNonce++;
				loadPending = false;
				topAnchor = null;
				viewportFit = null;
				editorDrafts.clear();
				snapToBottom();
				nearBottom = true;
				hasUnseen = false;
			} else if (isNewMessage && !isExtension) {
				// Version change or deleted tail. The pin as it stood BEFORE the swap is part of the reading
				// position, and this effect still sees it: it runs before any scroll event the
				// swap itself fires. A reader at the bottom is reading the newest turn, which is
				// exactly the turn a swipe replaces, and the control they pressed sits at that
				// turn's bottom. Holding their offset instead measures a longer alternative as
				// far from the bottom and strands them mid-message with the controls below it.
				if (nearBottom) {
					snapToBottom();
				} else {
					// Scrolled up: keep the reading position, and re-baseline the pin from real
					// geometry, because the content under the viewport just changed wholesale, so
					// the stale nearBottom from the previous version must not let the next stream
					// token yank the view down.
					const dist = listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight;
					nearBottom = laterCount === 0 && dist <= NEAR_BOTTOM_PX;
				}
				// Written on both paths: the swap can shrink the content and let the browser clamp
				// `scrollTop` by itself, and a clamp measured against a stale value reads as the
				// user scrolling up, which drops the pin a frame later.
				lastScrollTop = listElement.scrollTop;
				hasUnseen = false;
			} else if (isExtension && laterCount > 0 && messages[windowEnd - 1]?.id === prevLastMessageId) {
				// The window reached the old end. Include the next turn if the reader is
				// still on that last row, holding it in place as older rows leave the window.
				if (nearBottom) {
					void jumpToLatest();
				} else {
					hasUnseen = true;
					const previousTail = rowAt(windowEnd - 1)?.getBoundingClientRect();
					const viewport = listElement.getBoundingClientRect();
					if (previousTail && previousTail.bottom > viewport.top && previousTail.top < viewport.bottom) {
						void shiftWindow(1);
					}
				}
			} else if ((isNewMessage || isStreaming) && nearBottom && !streamSettled) {
				snapToBottom();
			} else if (isNewMessage) {
				hasUnseen = true;
			}
		}

		prevChatId = chatId;
		prevLastMessageId = lastMessageId;
		prevLastVariantId = lastVariantId;
		prevIsStreaming = isStreaming;
	});

	$effect(() => {
		const id = messageStore.branchTargetId;
		if (id && laterCount > 0 && messages.at(-1)?.id === id) void jumpToLatest();
	});

	// ===== The message cursor =====
	// Where the keyboard is in the story (architecture/chat-sessions.md, "The message cursor").
	// A turn behind the window is loaded back in, and only then does the keyboard
	// move to it.
	//
	// Marking and taking are separate on purpose. `takeNonce` is what says the keyboard should
	// MOVE; find in chat marks its live hit while the reader is still typing in that field, and
	// a mark that also took focus would empty the box on the first match.
	let takenNonce = 0;
	$effect(() => {
		const id = chatCursor.id;
		const nonce = chatCursor.takeNonce;
		// The path, so a cursor named before its branch rendered still lands, and the window,
		// so this re-runs once the turn below has been loaded back into it.
		void messages;
		if (!id) {
			takenNonce = nonce;
			return;
		}
		if (nonce === takenNonce || openingSceneStream) return;
		const index = messages.findIndex((m) => m.id === id);
		// Not on the visible path: a stale mark from a branch that moved under it. Nothing to
		// land on, and nothing to clean up either, since the ring reads off the same id.
		if (index < 0) return;
		if (index < windowStart || index >= windowEnd) {
			showTurn(index);
			return;
		}
		const row = rowAt(index);
		if (!row) return;
		takenNonce = nonce;
		navigationNonce++;
		loadPending = false;
		nearBottom = false;
		programmaticScroll = false;
		// `instant`, the one value that overrides this scroller's CSS glide: a step between two
		// turns has to land, and stepping through a stretch of story would otherwise queue one
		// animation per press. Deliberately NOT armed with `programmaticScroll`, exactly like
		// the arrival mark: landing mid-history SHOULD release the bottom pin.
		row.scrollIntoView({ block: chatCursor.scrollBlock, behavior: 'instant' });
		row.focus({ preventScroll: true });
	});

</script>

{#snippet windowEdge(count: number, direction: -1 | 1)}
	{#if count > 0}
		{@const side = direction < 0 ? 'earlier' : 'later'}
		{@const label = `${count} ${side} ${count === 1 ? 'turn' : 'turns'}`}
		{@const icon = direction < 0 ? 'chevronUp' : 'chevronDown'}
		<div class="window-edge">
			<span class="window-edge-line"></span>
			{#if manualLoad}
				<button type="button" class="window-edge-btn" title={label} onclick={() => shiftWindow(direction)}>
					<Icon name={icon} class="w-3 h-3" />
					Load {side} turns
				</button>
			{:else}
				<span class="window-edge-label">
					<Icon name={icon} class="w-3 h-3" />
					{label}
				</span>
			{/if}
			<span class="window-edge-line"></span>
		</div>
	{/if}
{/snippet}

<div class="message-list-wrap">
<SceneSelectionBar />
<div
	bind:this={listElement}
	use:observeScrollBounds
	class="message-list panel-scroll"
	role="log"
	aria-label="Chat messages"
	aria-live="polite"
	onscroll={updateNearBottom}
>
	{#if openingSceneStream}
		<!-- The scene arriving is a new beginning, so it is the only thing on screen while it
		     writes: leaving the path up would read as a reply to the turns above it. This is
		     also what gives an opening a visible stream and a reachable Stop at last. -->
		<div class="message-list-content" use:observeScrollBounds>
			<StreamingIndicator content={streamingContent} thinking={streamingThinking} />
		</div>
	{:else if messages.length === 0}
		<div class="message-empty-wrap" use:observeScrollBounds>
			<div class="message-empty-card card-elevated">
				<div class="message-empty-icon">
					<Icon name="bookOpen" class="w-8 h-8 text-accent" strokeWidth={1.5} />
				</div>
				<h3 class="message-empty-title">Begin your story</h3>
				<p class="message-empty-copy">
					{#if featurePromptsStore.openingSceneEnabled}
						Write your first action or let the AI set the scene
					{:else}
						Write your first action to begin
					{/if}
				</p>
				{#if featurePromptsStore.openingSceneEnabled}
					<div class="message-empty-action">
						<!-- Asks the app, not this chat: starting a scene while a reply generates
						     elsewhere would run two generations over one abort controller. -->
						<Button
							variant="secondary"
							onclick={() => (openingDialogOpen = true)}
							disabled={messageStore.isStreaming}
							aria-haspopup="dialog"
							aria-expanded={openingDialogOpen}
						>
							<Icon name="bookOpen" class="w-4 h-4" />
							Generate an opening scene
						</Button>
						<OpeningScenePopover
							open={openingDialogOpen}
							onClose={() => (openingDialogOpen = false)}
							onGenerate={handleGenerateOpeningScene}
						/>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="message-list-content" use:observeScrollBounds>
			{@render windowEdge(windowStart, -1)}
			{#each shown as message, offset (message.id)}
				{@const index = windowStart + offset}
				{@const versions = message.variants ?? [message]}
				{@const versionIndex = versions.findIndex(m => m.id === (message.selectedVariantId ?? message.id))}
					<MessageComponent
						{message}
						ordinal={index + 1}
						depth={messages.length - 1 - index + streamingTurnOffset}
						versionCount={versions.length}
						{versionIndex}
						isLast={index === messages.length - 1}
						{allMessages}
						{editorDrafts}
						archived={archivedIds.has(message.id)}
						memorySelected={selectedIds.has(message.id)}
						streamReplacement={replacingMessageId === message.id}
						streamTail={continuingMessageId === message.id || replacingMessageId === message.id ? streamingContent : null}
						streamTailThinking={continuingMessageId === message.id || replacingMessageId === message.id ? streamingThinking : null}
					/>
			{/each}
			{@render windowEdge(laterCount, 1)}
			{#if laterCount === 0 && isStreaming && !continuingMessageId && !replacingMessageId}
				<StreamingIndicator content={streamingContent} thinking={streamingThinking} />
			{/if}
		</div>
	{/if}
</div>

{#if chatSearch.open}
	<ChatSearchBar
		container={listElement}
		{messages}
		{shown}
		{showTurn}
		{streamingTurnOffset}
	/>
{/if}

{#if showJumpToFirst}
	<button type="button" class="scroll-jump scroll-jump-first surface-float shadow-md" onclick={jumpToFirst}
		aria-label="Jump to first message" title="Jump to first message">
		<Icon name="chevronUp" class="w-3.5 h-3.5" />
	</button>
{/if}
{#if showJumpToLatest}
	<button type="button" class="scroll-jump scroll-jump-latest surface-float shadow-md" onclick={jumpToLatest}
		aria-label="Jump to latest message" title="Jump to latest message">
		<Icon name="chevronDown" class="w-3.5 h-3.5" />
		{#if hasUnseen}<span>New</span>{/if}
	</button>
{/if}
</div>

<style>
	.message-list-wrap {
		position: relative;
		flex: 1;
		min-height: 0;
		/* Without min-width:0 a flex child adopts the min-content width of its widest
		   descendant: an expanded thinking block (long tokens/code) then blows the whole
		   column past the viewport and stretches every row. This lets it shrink so the wide
		   content scrolls inside its own panel instead. */
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	/* No padding on the scroll container itself: a scroller's own padding insets
	   the position: sticky constraint rect, which would pin the Portraits-style
	   sticky portrait short of the top edge. The spacing lives on
	   .message-list-content instead. */
	.message-list {
		flex: 1;
		min-height: 0;
		scroll-behavior: smooth;
		overscroll-behavior-y: contain;
	}

	.scroll-jump {
		position: absolute;
		right: 0.85rem;
		z-index: 10;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.15rem;
		min-height: 2.15rem;
		gap: 0.35rem;
		padding: 0.38rem 0.8rem;
		border-radius: var(--radius-full);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.scroll-jump-first { top: 0.85rem; }
	.scroll-jump-latest { bottom: 0.85rem; }
	.scroll-jump:hover { color: var(--color-accent); }
	.scroll-jump:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
	@media (pointer: coarse) {
		.scroll-jump { min-width: 2.75rem; min-height: 2.75rem; }
	}

	/* The transcript's content column: capped and centered inside the chat column,
	   which above the dock breakpoint is a share of the screen rather than a fixed
	   width (--chat-col-max, app.css). The cap lives here and not on the column
	   itself, because the docks key their glue math off the column's width (a
	   column capped to its content hands every surplus pixel to them) and because
	   Portraits and Manuscript rows fill their row, so without this box they would
	   stretch to whatever the share resolves to on a wide screen. */
	.message-list-content {
		max-width: var(--chat-content-max);
		margin-inline: auto;
		padding-top: calc(clamp(0.45rem, 0.28rem + 0.34vw, 0.82rem) + 0.28rem);
		padding-bottom: calc(clamp(1rem, 0.72rem + 0.92vw, 1.68rem) + clamp(0.45rem, 0.28rem + 0.34vw, 0.82rem));
	}

	/* Page boundaries show how much history can be loaded on either side. */
	.window-edge {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0.2rem auto 0.9rem;
		padding: 0 clamp(0.6rem, 0.4rem + 1vw, 1.4rem);
		max-width: calc(var(--reading-measure) * var(--user-chat-width, 1));
	}

	.window-edge-line {
		flex: 1;
		height: 1px;
		background: linear-gradient(
			to right,
			transparent,
			var(--color-border-subtle),
			transparent
		);
	}

	.window-edge-label,
	.window-edge-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--color-text-muted);
	}

	.window-edge-btn {
		padding: 0.22rem 0.65rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-full);
		background: transparent;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.window-edge-btn:hover {
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	/* The line between the memory-folded prefix and the live tail. */



	.message-empty-wrap {
		min-height: 100%;
		display: grid;
		place-items: center;
		padding: 1rem;
	}

	.message-empty-card {
		width: min(100%, 32rem);
		padding: clamp(1.1rem, 0.95rem + 1vw, 1.65rem);
		text-align: center;
	}

	.message-empty-icon {
		width: 3.7rem;
		height: 3.7rem;
		margin: 0 auto 0.75rem;
		border-radius: 1rem;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 24%, transparent);
	}

	.message-empty-title {
		margin: 0;
		font-family: var(--font-ui);
		font-size: clamp(1rem, 0.92rem + 0.4vw, 1.2rem);
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.message-empty-copy {
		margin: 0.42rem auto 0.9rem;
		max-width: 25rem;
		font-family: var(--font-ui);
		font-size: 0.84rem;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.message-empty-action {
		display: inline-block;
	}
</style>
