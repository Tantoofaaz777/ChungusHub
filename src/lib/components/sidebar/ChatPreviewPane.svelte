<script lang="ts">
	/**
	 * The chats panel's right half: a read-only look at the chat under the pointer.
	 *
	 * Two rules shape it. It opens at the END of the story, because "where did I leave
	 * off" is the only question a preview answers, and it renders that end in windows
	 * of PAGE turns, growing upward as the reader scrolls, so hovering a 900-turn chat
	 * doesn't drop 900 nodes into the DOM. And it counts the ACTIVE branch, out loud, so
	 * this number and the row's can never look like a contradiction.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import ChatAvatars from './ChatAvatars.svelte';
	import type { Chat, ChatListStats, Message } from '$lib/types/chat';
	import type { ChatCastMember } from '$lib/stores/chatCast.svelte';
	import { db } from '$lib/services/database';
	import { imageService } from '$lib/services/imageService';
	import { expandSelfRefs } from '$lib/macros';
	import { findActivePath } from '$lib/utils/message-tree';
	import { portraitFocusStyle } from '$lib/utils/portrait-focus';
	import { formatDate } from '$lib/utils/date';
	import { truncate } from '$lib/utils/markdown';

	interface Props {
		chat: Chat | null;
		stats: ChatListStats | null;
		/** The chat's cast: the bound character, for the header and assistant lines. */
		character: ChatCastMember | null;
		/** The persona the chat's newest user turn was written with. */
		persona: ChatCastMember | null;
		onOpen: () => void;
		onRename: () => void;
		onDuplicate: () => void;
		onToggleFavorite: () => void;
		onDelete: () => void;
	}

	let { chat, stats, character, persona, onOpen, onRename, onDuplicate, onToggleFavorite, onDelete }: Props =
		$props();

	/** Turns rendered per window. One press of the scrollbar shows the next batch. */
	const PAGE = 20;

	let messages = $state<Message[]>([]);
	let loading = $state(false);
	let visibleCount = $state(PAGE);
	let scrollEl: HTMLDivElement | null = $state(null);
	// Path lookups are cached for the panel's lifetime, and the panel is remounted on every
	// open, so the cache can never outlive the data it mirrors.
	let pathCache = new Map<string, Message[]>();

	let chatId = $derived(chat?.id ?? null);
	// Cached per (chat, leaf), which covers what actually changes here: a branch switch
	// made elsewhere while the panel is open. It does NOT catch an in-place edit synced
	// in from another device (same leaf, new text). That stays stale until the panel is
	// reopened, which for a read-only hover preview is a trade worth taking over
	// re-fetching every chat the pointer brushes.
	let leafId = $derived(chat?.activeLeafId ?? null);
	let cacheKey = $derived(chatId ? `${chatId}:${leafId ?? 'root'}` : null);

	$effect(() => {
		const id = chatId;
		const key = cacheKey;
		const leaf = leafId;
		visibleCount = PAGE;
		if (!id || !key) {
			messages = [];
			loading = false;
			return;
		}
		const cached = pathCache.get(key);
		if (cached) {
			messages = cached;
			// Clear it here too: a cancelled load never reaches its own `finally`, so
			// arriving on a cached (possibly empty) chat would inherit a spinner that
			// nothing is left to turn off.
			loading = false;
			scrollToEnd();
			return;
		}
		// The latest hover wins: sweeping the list can leave several loads in flight, and
		// an earlier one landing last would show the wrong chat's story.
		let cancelled = false;
		loading = true;
		void (async () => {
			try {
				const all = await db.getMessagesByChat(id);
				const path = leaf ? findActivePath(all, leaf) : all.filter((m) => !m.parentId).slice(0, 1);
				pathCache.set(key, path);
				if (cancelled) return;
				messages = path;
				scrollToEnd();
			} catch (e) {
				if (!cancelled) messages = [];
				console.error('Failed to load chat preview:', e);
			} finally {
				if (!cancelled) loading = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	let shown = $derived(messages.slice(Math.max(0, messages.length - visibleCount)));
	let hasMore = $derived(messages.length > shown.length);

	function scrollToEnd() {
		requestAnimationFrame(() => {
			if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
		});
	}

	/** Grow the window upward and keep the reader's eye where it was: the pixels added
	 *  above must be added to scrollTop, or the view jumps a screen back in time. */
	function handleScroll() {
		if (!scrollEl || !hasMore || scrollEl.scrollTop > 48) return;
		const before = scrollEl.scrollHeight;
		visibleCount += PAGE;
		requestAnimationFrame(() => {
			if (!scrollEl) return;
			scrollEl.scrollTop += scrollEl.scrollHeight - before;
		});
	}

	// Self-refs resolve live here exactly as they do in the chat itself (coupling #6 in
	// architecture/chat-sessions.md): greetings are stored raw, so a preview that skipped this
	// would show a literal {{user}} where the story shows a name. The persona is the
	// CHAT's, not the app-wide active one: this is a look at someone else's story.
	let selfRefChar = $derived(character?.name?.trim() || 'Story');
	let selfRefUser = $derived(persona?.name?.trim() || 'You');

	let speakerUrls = $state<Record<string, string | null>>({});
	$effect(() => {
		for (const member of [persona, character]) {
			if (!member?.imageUrl || member.libraryEntryId in speakerUrls) continue;
			imageService.getThumbnailUrl(member.imageUrl).then((url) => {
				speakerUrls = { ...speakerUrls, [member.libraryEntryId]: url };
			});
		}
	});

	function speakerFor(message: Message): ChatCastMember | null {
		return message.role === 'user' ? persona : character;
	}

	/** Markdown flattened to one readable paragraph, since the preview is for scanning. */
	function previewText(content: string): string {
		const stripped = content
			.replace(/```[\s\S]*?```/g, '[code block]')
			.replace(/`[^`]+`/g, '[code]')
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/\*([^*]+)\*/g, '$1')
			.replace(/#{1,6}\s/g, '')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/\n+/g, ' ')
			.trim();
		return truncate(
			expandSelfRefs(
				stripped,
				selfRefChar,
				selfRefUser,
				persona ? persona.pronouns ?? {} : undefined
			),
			260
		);
	}

	let pathCount = $derived(stats?.path ?? 0);
	let offPathCount = $derived(Math.max(0, (stats?.total ?? 0) - pathCount));
</script>

{#if chat}
	<div class="preview">
		<header class="preview-head">
			{#if character}
				<ChatAvatars members={[character]} size={38} max={1} />
			{/if}
			<div class="preview-head-text">
				<h3 class="preview-title">{chat.title}</h3>
				<p class="preview-meta">
					<span>{pathCount} message{pathCount === 1 ? '' : 's'} on this branch</span>
					{#if offPathCount > 0}
						<span class="preview-meta-sep">·</span>
						<span class="preview-meta-branch">
							<Icon name="branch" class="w-3 h-3" />
							{offPathCount} off it
						</span>
					{/if}
					<span class="preview-meta-sep">·</span>
					<span>started {formatDate(chat.createdAt)}</span>
				</p>
			</div>
		</header>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div bind:this={scrollEl} class="preview-body chats-scroll panel-scroll" onscroll={handleScroll}>
			{#if loading && messages.length === 0}
				<div class="preview-state">
					<div class="preview-spinner"></div>
				</div>
			{:else if messages.length === 0}
				<div class="preview-state preview-state-empty">
					<Icon name="chat" class="w-6 h-6 mb-2 opacity-50" />
					<p>No messages yet</p>
				</div>
			{:else}
				{#if hasMore}
					<p class="preview-more">Scroll up for {messages.length - shown.length} earlier</p>
				{/if}
				{#each shown as message (message.id)}
					{@const speaker = speakerFor(message)}
					{@const speakerUrl = speaker?.imageUrl ? (speakerUrls[speaker.libraryEntryId] ?? null) : null}
					<div class="preview-turn">
						<div class="preview-face" class:is-user={message.role === 'user'}>
							{#if speakerUrl}
								<img
									src={speakerUrl}
									alt={speaker?.name ?? ''}
									style={portraitFocusStyle(speaker?.portraitFocus)}
								/>
							{:else}
								<Icon name={message.role === 'user' ? 'user' : 'sparkles'} class="w-3.5 h-3.5" />
							{/if}
						</div>
						<div class="preview-turn-body">
							<p class="preview-speaker">
								{speaker?.name?.trim() || (message.role === 'user' ? 'You' : selfRefChar)}
							</p>
							<p class="preview-text">{previewText(message.content)}</p>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<!-- The one tabbable path to a chat's actions: the row's own buttons are pointer
		     targets (the list is arrow-driven), so everything they do also lives here. -->
		<footer class="preview-actions">
			<button type="button" class="preview-action preview-action-primary" onclick={onOpen}>
				<Icon name="chat" class="w-3.5 h-3.5" />
				Open
			</button>
			<button type="button" class="preview-action" onclick={onRename}>
				<Icon name="pencil" class="w-3.5 h-3.5" />
				Rename
			</button>
			<button type="button" class="preview-action" onclick={onDuplicate}>
				<Icon name="copy" class="w-3.5 h-3.5" />
				Duplicate
			</button>
			<button
				type="button"
				class="preview-action"
				class:is-on={chat.isFavorite}
				aria-pressed={chat.isFavorite}
				onclick={onToggleFavorite}
			>
				<Icon name="heart" class="w-3.5 h-3.5 {chat.isFavorite ? 'fill-current' : ''}" />
				{chat.isFavorite ? 'Favorited' : 'Favorite'}
			</button>
			<button type="button" class="preview-action preview-action-danger" onclick={onDelete}>
				<Icon name="trash" class="w-3.5 h-3.5" />
				Delete
			</button>
		</footer>
	</div>
{:else}
	<!-- The opening state: nothing is previewed until the pointer touches a row. From
	     then on the panel holds whichever chat it was last given. -->
	<div class="preview-idle">
		<Icon name="eye" class="w-8 h-8 mb-3 opacity-40" />
		<p>Hover a chat to preview it</p>
	</div>
{/if}

<style>
	.preview,
	.preview-idle {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.preview-idle {
		align-items: center;
		justify-content: center;
		padding: 0 1rem;
		font-family: var(--font-ui);
		font-size: 0.85rem;
		color: var(--color-text-muted);
		text-align: center;
	}

	.preview-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.7rem 0.9rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.preview-head-text {
		min-width: 0;
	}

	.preview-title {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.preview-meta {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-wrap: wrap;
		margin-top: 0.15rem;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.preview-meta-branch {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
	}

	.preview-meta-sep {
		opacity: 0.5;
	}

	.preview-body {
		flex: 1;
		min-height: 0;
		/* The backfill restores scroll position by hand (handleScroll). Chromium's own
		   scroll anchoring would apply a second correction on top of it and throw the
		   view a whole window forward. */
		overflow-anchor: none;
		padding: 0.75rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.preview-more {
		align-self: center;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
		opacity: 0.8;
	}

	.preview-state {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.preview-state-empty {
		flex-direction: column;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.preview-spinner {
		width: 1.25rem;
		height: 1.25rem;
		border-radius: var(--radius-full);
		border: 2px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		border-top-color: var(--color-accent);
		animation: preview-spin 700ms linear infinite;
	}

	@keyframes preview-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.preview-turn {
		display: flex;
		gap: 0.5rem;
	}

	.preview-face {
		flex-shrink: 0;
		width: 1.65rem;
		height: 1.65rem;
		border-radius: var(--radius-full);
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in srgb, var(--color-bg-tertiary) 88%, transparent);
		color: var(--color-text-secondary);
	}

	.preview-face.is-user {
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		color: var(--color-accent);
	}

	.preview-face img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.preview-turn-body {
		min-width: 0;
		flex: 1;
	}

	.preview-speaker {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		margin-bottom: 0.1rem;
	}

	.preview-text {
		font-family: var(--font-prose);
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--color-text-primary);
	}

	.preview-actions {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		padding: 0.55rem 0.6rem;
		border-top: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 40%, transparent);
	}

	.preview-action {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.35rem 0.55rem;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.preview-action:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 85%, transparent);
		color: var(--color-text-primary);
	}

	.preview-action-primary {
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		color: var(--color-accent);
	}

	.preview-action.is-on {
		color: var(--color-accent);
	}

	.preview-action-danger:hover {
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
		color: var(--color-error);
	}
</style>
