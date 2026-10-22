<script lang="ts">
	/**
	 * One row of the chats panel. Presentation only: every mutation is a callback the
	 * panel owns, so this file never touches a store.
	 *
	 * The message count follows the active path, matching the transcript.
	 * Swipes and alternate greetings aren't additional turns in that conversation.
	 */
	import { untrack } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import ChatAvatars from './ChatAvatars.svelte';
	import type { Chat, ChatListStats } from '$lib/types/chat';
	import type { ChatCastMember } from '$lib/stores/chatCast.svelte';
	import { formatRelativeTime } from '$lib/utils/date';

	interface Props {
		chat: Chat;
		position: number;
		total: number;
		stats: ChatListStats | null;
		/** The face this row wears: the bound character globally, the chat's persona
		 *  inside one character's list (where every row is the same character). */
		member: ChatCastMember | null;
		isActive: boolean;
		isSelected: boolean;
		/** How many chats share this one's content (0 = unique, 2+ = one of a twin set). */
		twinCount: number;
		twinHighlighted: boolean;
		/** Context around a message-search hit, already flattened and self-ref-expanded by
		 *  the panel (the only side that knows the chat's character and persona names).
		 *  Empty unless this row matched on message text: browsing rows carry a time, not
		 *  a preview line. */
		snippet: string;
		renaming: boolean;
		menuOpen: boolean;
		/** While the panel is picking chats the row is a checkbox, not a door: the whole of
		 *  it toggles, and its per-row menu goes rather than sitting there inert. */
		selecting: boolean;
		checked: boolean;
		onToggleSelect: () => void;
		onOpen: () => void;
		onHover: () => void;
		onMenu: (anchor: DOMRect) => void;
		onRenameCommit: (title: string) => void;
		onRenameCancel: () => void;
		onTwinHover: (on: boolean) => void;
	}

	let {
		chat,
		position,
		total,
		stats,
		member,
		isActive,
		isSelected,
		twinCount,
		twinHighlighted,
		snippet,
		renaming,
		menuOpen,
		selecting,
		checked,
		onToggleSelect,
		onOpen,
		onHover,
		onMenu,
		onRenameCommit,
		onRenameCancel,
		onTwinHover
	}: Props = $props();

	let menuButtonEl: HTMLButtonElement | null = $state(null);
	let renameInputEl: HTMLInputElement | null = $state(null);
	let renameDraft = $state('');

	// Seed the draft when the editor opens, and ONLY then: the title is read untracked
	// so a sync or a favorite toggle refreshing this row mid-rename can't overwrite what
	// the user is typing.
	$effect(() => {
		if (!renaming) return;
		renameDraft = untrack(() => chat.title);
		requestAnimationFrame(() => renameInputEl?.select());
	});

	let pathCount = $derived(stats?.path ?? 0);
	let timeLabel = $derived(formatRelativeTime(stats?.lastAt ?? chat.updatedAt));

	function commitRename() {
		const next = renameDraft.trim();
		if (!next || next === chat.title) onRenameCancel();
		else onRenameCommit(next);
	}

	function handleRenameKeydown(e: KeyboardEvent) {
		// The panel's window handler drives the list with these keys; while the editor is
		// open they belong to the field, so stop them here.
		e.stopPropagation();
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onRenameCancel();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="chat-row"
	class:is-active={isActive}
	class:is-selected={isSelected}
	class:is-twin-lit={twinHighlighted}
	class:menu-open={menuOpen}
	role="option"
	aria-selected={isSelected}
	aria-posinset={position}
	aria-setsize={total}
	tabindex="-1"
	id="chat-option-{chat.id}"
	onmouseenter={onHover}
>
	<button
		type="button"
		class="chat-row-open"
		tabindex="-1"
		onclick={selecting ? onToggleSelect : onOpen}
		disabled={renaming}
		aria-pressed={selecting ? checked : undefined}
		aria-label={selecting ? `Select ${chat.title}` : `Open ${chat.title}`}
	>
		{#if selecting}
			<span class="chat-row-check" class:is-checked={checked} aria-hidden="true">
				{#if checked}
					<Icon name="check" class="w-3 h-3" />
				{/if}
			</span>
		{/if}
		<div class="chat-row-face">
			{#if member}
				<ChatAvatars members={[member]} size={34} max={1} />
			{:else}
				<div class="chat-row-orb"><Icon name="chat" class="w-4 h-4" /></div>
			{/if}
			{#if isActive}
				<span class="chat-row-live" title="Open right now"></span>
			{/if}
		</div>

		<div class="chat-row-main">
			<div class="chat-row-titleline">
				{#if renaming}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:this={renameInputEl}
						bind:value={renameDraft}
						class="chat-row-rename input-base"
						type="text"
						autofocus
						aria-label="Chat title"
						onkeydown={handleRenameKeydown}
						onblur={commitRename}
						onclick={(e) => e.stopPropagation()}
					/>
				{:else}
					<span class="chat-row-title">{chat.title}</span>
					{#if twinCount > 1}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span
							class="chat-row-twin"
							title="{twinCount} chats have identical content. Hover to see which"
							onmouseenter={() => onTwinHover(true)}
							onmouseleave={() => onTwinHover(false)}
						>
							<Icon name="copy" class="w-3 h-3" />
							{twinCount}
						</span>
					{/if}
				{/if}
			</div>

			<p class="chat-row-sub">
				<span class="chat-row-time">{timeLabel}</span>
				{#if snippet}
					<!-- Only a message-search hit puts text here, and only so the row can say
					     why it matched. Browsing rows stay a title and a time. -->
					<span class="chat-row-hit">{snippet}</span>
				{/if}
			</p>
		</div>

		<div class="chat-row-meta">
			<span class="chat-row-count" title="{pathCount} message{pathCount === 1 ? '' : 's'} in this chat">
				<Icon name="chat" class="w-3 h-3" />
				{pathCount}
			</span>
		</div>
	</button>

	<div class="chat-row-actions">
		{#if !selecting}
		{#if chat.isFavorite}
			<span class="chat-row-star" title="Favorite">
				<Icon name="heart" class="w-3.5 h-3.5 fill-current" />
			</span>
		{/if}
		<button
			bind:this={menuButtonEl}
			type="button"
			class="chat-row-action"
			tabindex="-1"
			title="More actions"
			aria-label="More actions for {chat.title}"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={() => menuButtonEl && onMenu(menuButtonEl.getBoundingClientRect())}
		>
			<Icon name="dotsVertical" class="w-4 h-4" />
		</button>
		{/if}
	</div>
</div>

<style>
	.chat-row {
		position: relative;
		display: flex;
		align-items: stretch;
		border-radius: var(--radius-lg);
		transition: background-color 120ms ease, box-shadow 120ms ease;
	}

	.chat-row:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
	}

	/* The keyboard's selection, which the mouse never sets, so nothing stays lit
	   after the cursor leaves the list. */
	.chat-row.is-selected {
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
	}

	.chat-row.is-active {
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
	}

	/* Hovering a twin chip lights up every chat with the same content. */
	.chat-row.is-twin-lit {
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 55%, transparent);
	}

	.chat-row-open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.55rem 0.6rem;
		border: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
		border-radius: inherit;
	}

	.chat-row-open:disabled {
		cursor: default;
	}

	/* Drawn rather than a real checkbox: the whole row is already the control, and a second
	   focusable box inside a button is a tab stop that leads nowhere. */
	.chat-row-check {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1rem;
		height: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-on-accent);
		transition: background-color 120ms ease, border-color 120ms ease;
	}
	.chat-row-check.is-checked {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	.chat-row-face {
		position: relative;
		flex-shrink: 0;
		line-height: 0;
	}

	/* Avatar-less stand-in: a character-less orphan chat, or a deleted persona. */
	.chat-row-orb {
		width: 34px;
		height: 34px;
		border-radius: var(--radius-full);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-bg-tertiary) 88%, transparent);
	}

	/* The one chat that's open behind this panel. */
	.chat-row-live {
		position: absolute;
		right: -1px;
		bottom: -1px;
		width: 10px;
		height: 10px;
		border-radius: var(--radius-full);
		background: var(--color-accent);
		border: 2px solid var(--color-bg-primary);
	}

	.chat-row-main {
		flex: 1;
		min-width: 0;
	}

	.chat-row-titleline {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
	}

	.chat-row-title {
		min-width: 0;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chat-row-rename {
		width: 100%;
		padding: 0.15rem 0.4rem;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text-primary);
		outline: none;
	}

	.chat-row-twin {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		flex-shrink: 0;
		padding: 0.05rem 0.3rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		color: var(--color-accent);
		font-family: var(--font-ui);
		font-size: 0.65rem;
		font-weight: 700;
		cursor: help;
	}

	.chat-row-sub {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
		margin-top: 0.1rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.35;
		color: var(--color-text-muted);
		min-width: 0;
	}

	.chat-row-time {
		flex-shrink: 0;
		white-space: nowrap;
	}

	.chat-row-hit {
		min-width: 0;
		color: var(--color-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The number of turns in the conversation currently selected for this chat. */
	.chat-row-meta {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.chat-row-count {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}

	.chat-row-actions {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		padding-right: 0.35rem;
	}

	/* State, not a control: the action itself lives in the row menu. */
	.chat-row-star {
		display: inline-flex;
		align-items: center;
		color: var(--color-accent);
	}

	.chat-row-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.85rem;
		height: 1.85rem;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease, background-color 120ms ease, opacity 120ms ease;
	}

	.chat-row-action:hover {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 90%, transparent);
	}

	/* Always visible, on every device: an action you have to hover to discover is an
	   action touch users don't have. It sits muted until the row is under the cursor. */
	.chat-row:hover .chat-row-action,
	.chat-row.is-selected .chat-row-action,
	.chat-row.menu-open .chat-row-action {
		color: var(--color-text-secondary);
	}
</style>
