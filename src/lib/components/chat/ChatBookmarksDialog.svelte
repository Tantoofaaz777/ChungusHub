<script lang="ts">
	import { tick } from 'svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { messageStore } from '$lib/stores/messages.svelte';
	import { chatCursor } from '$lib/stores/chatCursor.svelte';
	import { chatSearch } from '$lib/stores/chatSearch.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { openChatSetup } from '$lib/stores/openChatSetup.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { storyRoleName } from '$lib/types/library';
	import type { Message } from '$lib/types/chat';
	import { displaySelfRefs } from '$lib/macros';
	import { stripMarkdown } from '$lib/utils/markdown';
	import { chatBookmarks } from '$lib/utils/chat-bookmarks';

	let { chatId, open, onClose }: { chatId: string; open: boolean; onClose: () => void } = $props();
	const chatState = $derived(chatStore.currentChatState?.chat.id === chatId ? chatStore.currentChatState : null);
	const bookmarks = $derived(chatBookmarks(chatState?.allMessages ?? [], chatState?.activePath ?? []));
	const character = $derived(characterLibraryStore.entries.find(entry => entry.id === chatState?.chat.characterId));
	const charName = $derived(character ? storyRoleName(character.identity) || 'Character' : 'Character');
	const userName = $derived(openChatSetup.persona ? storyRoleName(openChatSetup.persona.identity) || 'You' : 'You');
	let navigating = $state(false);
	let removing = $state<string[]>([]);

	function speaker(message: Message): string {
		if (message.role === 'assistant') return charName;
		if (message.role === 'system') return 'System';
		const persona = characterLibraryStore.entries.find(entry => entry.id === message.personaId);
		return persona ? storyRoleName(persona.identity) || userName : userName;
	}
	function preview(message: Message): string {
		const text = displaySelfRefs(message.content.slice(0, 5000), charName, userName, openChatSetup.persona?.identity.pronouns);
		return stripMarkdown(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280)
			|| (message.attachments?.length ? 'Image attachment' : 'Empty message');
	}
	async function jump(message: Message, onPath: boolean) {
		if (navigating || chatStore.activeChatId !== chatId) return;
		if (!onPath && messageStore.warnIfBusy()) return;
		navigating = true;
		try {
			if (!onPath) await messageStore.navigateToBranch(message.id);
			if (chatStore.activeChatId !== chatId) return;
			if (!chatStore.currentChatState?.activePath.some(turn => turn.id === message.id)) {
				toastStore.info('This message is no longer available.'); return;
			}
			chatSearch.close();
			onClose();
			// Let the dialog release focus before the transcript loads and focuses its target.
			await tick();
			if (chatStore.activeChatId === chatId) chatCursor.goTo(message.id, 'start');
		} catch (error) { toastStore.failed('open bookmarked message', error); }
		finally { navigating = false; }
	}
	async function remove(message: Message) {
		removing = [...removing, message.id];
		try { await messageStore.setBookmarked(message.id, false); }
		finally { removing = removing.filter(id => id !== message.id); }
	}
</script>

<Dialog {open} {onClose} title="Bookmarks" titleAlign="left" size="md" placement="center">
	{#if bookmarks.length}
		<div class="bookmarks-list">
			{#each bookmarks as bookmark (bookmark.message.id)}
				{@const name = speaker(bookmark.message)}
				{@const snippet = preview(bookmark.message)}
				<div class="bookmark-row">
					<button type="button" class="bookmark-target" disabled={navigating}
						aria-label="Go to message #{bookmark.ordinal}: {snippet}" onclick={() => jump(bookmark.message, bookmark.onPath)}>
						<span class="bookmark-meta">#{bookmark.ordinal} · {name}{#if !bookmark.onPath}<span class="bookmark-branch">Other branch</span>{/if}</span>
						<span class="bookmark-preview">{snippet}</span>
					</button>
					<button type="button" class="bookmark-remove" disabled={navigating || removing.includes(bookmark.message.id)}
						aria-label="Remove bookmark #{bookmark.ordinal}" title="Remove bookmark" onclick={() => remove(bookmark.message)}>
						<Icon name="star" class="w-4 h-4 fill-current" />
					</button>
				</div>
			{/each}
		</div>
	{:else}
		<p class="bookmarks-empty">No bookmarks yet. Use the star on a message to save it here.</p>
	{/if}
</Dialog>

<style>
	.bookmarks-list { display:flex; flex-direction:column; gap:.3rem; }
	.bookmark-row { display:flex; align-items:center; gap:.35rem; border-radius:var(--radius-md); }
	.bookmark-row:hover { background:var(--color-bg-tertiary); }
	.bookmark-target { flex:1; min-width:0; padding:.65rem; display:flex; flex-direction:column; gap:.35rem; text-align:left; cursor:pointer; border-radius:var(--radius-md); }
	.bookmark-meta { display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; font-size:.72rem; color:var(--color-accent); }
	.bookmark-branch { font-size:.65rem; color:var(--color-text-muted); }
	.bookmark-preview { font-size:.82rem; line-height:1.5; color:var(--color-text-primary); display:-webkit-box; -webkit-line-clamp:3; line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
	.bookmark-remove { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:2.5rem; height:2.5rem; border-radius:var(--radius-md); color:var(--color-accent); cursor:pointer; }
	.bookmark-remove:hover { background:var(--color-bg-tertiary); }
	.bookmarks-empty { padding:.65rem; font-size:.85rem; line-height:1.6; color:var(--color-text-muted); }
	button:disabled { opacity:.5; cursor:default; }
</style>
