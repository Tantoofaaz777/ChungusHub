<script lang="ts" module>
	export interface ChatRowMenuTarget {
		chatId: string;
		anchor: DOMRect;
	}
</script>

<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte';
	import { holdMsForBlast } from '#lib/components/ui/HoldToConfirmButton.svelte';
	import { panelActivity } from '#lib/components/ui/panelActivity.ts';
	import { db } from '#lib/services/database.ts';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import { duplicateAsksAboutMemory, type Chat, type ChatListStats, type ChatMemoryFootprint } from '#lib/types/chat.ts';
	import DuplicateChatDialog from './DuplicateChatDialog.svelte';

	interface Props {
		menu: ChatRowMenuTarget | null;
		chats: Chat[];
		stats: Record<string, ChatListStats>;
		onClose: () => void;
		onOpen: (chatId: string) => void;
		onRename: (chat: Chat) => void;
	}

	let { menu, chats, stats, onClose, onOpen, onRename }: Props = $props();
	const panelActive = panelActivity();
	const EDGE = 8;
	let chat = $derived(menu ? chats.find(c => c.id === menu?.chatId) : undefined);
	let menuEl = $state<HTMLElement | null>(null);

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	$effect(() => {
		if (menu && (!chat || !panelActive())) onClose();
	});

	$effect(() => {
		const el = menuEl;
		const anchor = menu?.anchor;
		if (!el || !anchor) return;
		const { offsetWidth: width, offsetHeight: height } = el;
		const desiredLeft = anchor.width ? anchor.right - width : anchor.left;
		const left = Math.max(EDGE, Math.min(desiredLeft, window.innerWidth - width - EDGE));
		const below = anchor.bottom + 6;
		const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, anchor.top - height - 6);
		Object.assign(el.style, { left: `${left}px`, top: `${top}px`, visibility: 'visible' });

		const focusedBeforeOpen = document.activeElement;
		const items = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
		items[0]?.focus({ preventScroll: true });
		function handleKeys(event: KeyboardEvent) {
			if (event.key === 'Escape' || event.key === 'Tab') {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
				}
				onClose();
				if (focusedBeforeOpen instanceof HTMLElement) focusedBeforeOpen.focus({ preventScroll: true });
				return;
			}
			if (!el?.contains(document.activeElement) || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			const index = items.indexOf(document.activeElement as HTMLButtonElement);
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
				(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
			items[next]?.focus();
		}
		window.addEventListener('keydown', handleKeys, true);
		window.addEventListener('resize', onClose);
		return () => {
			window.removeEventListener('keydown', handleKeys, true);
			window.removeEventListener('resize', onClose);
		};
	});

	function run(target: Chat, action: (target: Chat) => void) {
		onClose();
		action(target);
	}

	async function toggleFavorite(target: Chat) {
		try {
			await chatStore.toggleChatFavorite(target.id);
		} catch (error) {
			toastStore.failed(`update favorites for "${target.title}"`, error);
		}
	}

	let deleteTarget = $state<Chat | null>(null);
	let deleteStats = $derived(deleteTarget ? (stats[deleteTarget.id] ?? null) : null);
	let deleteMessage = $derived.by(() => {
		if (!deleteTarget) return '';
		const name = `"${deleteTarget.title}"`;
		if (!deleteStats) return `Delete ${name} and every message in it? This cannot be undone.`;
		const n = deleteStats.total;
		const versions = deleteStats.versions;
		return `Delete ${name} and its ${n} turn${n === 1 ? '' : 's'}${versions === undefined ? '' : ` (${versions} saved version${versions === 1 ? '' : 's'})`}? This cannot be undone.`;
	});

	function confirmDelete() {
		const target = deleteTarget;
		deleteTarget = null;
		if (target) void chatStore.deleteChat(target.id);
	}

	let duplicateTarget = $state<{ chat: Chat; footprint: ChatMemoryFootprint } | null>(null);
	let duplicating = $state(false);

	function reportDuplicateFailure(target: Chat, error: unknown) {
		console.error('Duplicate failed:', error);
		if (error instanceof Error && error.message.includes('mem-copy-stale')) {
			toastStore.error(`"${target.title}" has memory pointing at deleted messages. Open the chat once to let it repair itself, or duplicate the story on its own.`);
		} else {
			toastStore.failed(`duplicate "${target.title}"`, error);
		}
	}

	async function requestDuplicate(target: Chat) {
		if (duplicating) return;
		duplicating = true;
		try {
			const footprint = await db.getChatMemoryFootprint(target.id);
			if (duplicateAsksAboutMemory(footprint)) duplicateTarget = { chat: target, footprint };
			else await duplicate(target, false);
		} catch (error) {
			reportDuplicateFailure(target, error);
		} finally {
			duplicating = false;
		}
	}

	async function duplicate(target: Chat, includeMemory: boolean) {
		duplicating = true;
		try {
			await chatStore.duplicateChat(target.id, { includeMemory });
			toastStore.success(includeMemory ? 'Chat duplicated with its memory' : 'Chat duplicated');
			duplicateTarget = null;
		} catch (error) {
			reportDuplicateFailure(target, error);
		} finally {
			duplicating = false;
		}
	}
</script>

{#if panelActive() && menu && chat}
	{@const target = chat}
	<button use:portal class="menu-scrim" type="button" tabindex="-1" aria-label="Close menu" onclick={onClose}></button>
	<div bind:this={menuEl} use:portal class="row-menu surface-float" role="menu" aria-label="Chat actions">
		<button type="button" role="menuitem" onclick={() => run(target, chat => onOpen(chat.id))}>
			<Icon name="chat" class="w-4 h-4" /><span>Open</span>
		</button>
		<button type="button" role="menuitem" onclick={() => run(target, onRename)}>
			<Icon name="pencil" class="w-4 h-4" /><span>Rename</span>
		</button>
		<button type="button" role="menuitem" onclick={() => run(target, requestDuplicate)}>
			<Icon name="copy" class="w-4 h-4" /><span>Duplicate…</span>
		</button>
		<button type="button" role="menuitem" onclick={() => run(target, toggleFavorite)}>
			<Icon name="heart" class="w-4 h-4 {target.isFavorite ? 'fill-current' : ''}" />
			<span>{target.isFavorite ? 'Remove from favorites' : 'Add to favorites'}</span>
		</button>
		<div class="menu-separator" role="separator"></div>
		<button type="button" role="menuitem" class="is-danger" onclick={() => run(target, chat => (deleteTarget = chat))}>
			<Icon name="trash" class="w-4 h-4" /><span>Delete</span>
		</button>
	</div>
{/if}

<ConfirmDialog
	open={deleteTarget !== null}
	title="Delete chat"
	message={deleteMessage}
	confirmLabel="Delete"
	variant="danger"
	destructive
	holdMs={holdMsForBlast(deleteStats?.versions ?? deleteStats?.total ?? 0)}
	onConfirm={confirmDelete}
	onCancel={() => (deleteTarget = null)}
/>

{#if duplicateTarget}
	<DuplicateChatDialog
		open={true}
		title={duplicateTarget.chat.title}
		footprint={duplicateTarget.footprint}
		busy={duplicating}
		onConfirm={(includeMemory) => duplicateTarget && duplicate(duplicateTarget.chat, includeMemory)}
		onCancel={() => { if (!duplicating) duplicateTarget = null; }}
	/>
{/if}

<style>
	.menu-scrim {
		position: fixed;
		inset: 0;
		z-index: 1000;
		border: 0;
		background: transparent;
	}
	.row-menu {
		position: fixed;
		z-index: 1001;
		width: min(190px, calc(100vw - 16px));
		max-height: calc(100dvh - 16px);
		overflow: auto;
		visibility: hidden;
		padding: 0.3rem;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}
	.row-menu button {
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
	.row-menu button span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-menu button:is(:hover, :focus-visible) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}
	.row-menu button.is-danger:is(:hover, :focus-visible) {
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
		color: var(--color-error);
	}
	.menu-separator {
		height: 1px;
		margin: 0.25rem 0.3rem;
		background: var(--color-border-subtle);
	}
</style>
