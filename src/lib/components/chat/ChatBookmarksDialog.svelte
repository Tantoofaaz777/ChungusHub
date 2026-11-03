<script lang="ts">
	import { tick } from 'svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { messageStore } from '#lib/stores/messages.svelte.ts';
	import { chatCursor } from '#lib/stores/chatCursor.svelte.ts';
	import { chatSearch } from '#lib/stores/chatSearch.svelte.ts';
	import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
	import { openChatSetup } from '#lib/stores/openChatSetup.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import { storyRoleName } from '#lib/types/library.ts';
	import type { Message } from '#lib/types/chat.ts';
	import { displaySelfRefs } from '#lib/macros.ts';
	import { stripMarkdown } from '#lib/utils/markdown.ts';
	import { chatBookmarks } from '#lib/utils/chat-bookmarks.ts';
	import { responseVersionsStore } from '#lib/stores/responseVersions.svelte.ts';
	type Bookmark = ReturnType<typeof chatBookmarks<Message>>[number];

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
	async function jump(bookmark: Bookmark) {
		if (navigating || chatStore.activeChatId !== chatId) return;
		navigating = true;
		try {
			chatSearch.close();
			onClose();
			await tick();
			if (chatStore.activeChatId !== chatId) return;
			const turn = chatStore.currentChatState?.activePath.find(turn => turn.id === bookmark.message.id);
			if (!turn) { toastStore.info('This message is no longer available in this conversation.'); return; }
			if (bookmark.variantId && turn.selectedVariantId !== bookmark.variantId) responseVersionsStore.show(chatId, turn.id, bookmark.variantId);
			else chatCursor.goTo(turn.id, 'start');
		} catch (error) { toastStore.failed('open bookmarked message', error); }
		finally { navigating = false; }
	}
	async function remove(bookmark: Bookmark) {
		if (chatStore.activeChatId !== chatId) return;
		removing = [...removing, bookmark.key];
		try {
			if (bookmark.variantId) await messageStore.setVersionBookmarked(bookmark.message.id, bookmark.variantId, false, bookmark.message.revision!);
			else await messageStore.setBookmarked(bookmark.message.id, false);
		} catch (error) { toastStore.failed('remove bookmark', error); }
		finally { removing = removing.filter(id => id !== bookmark.key); }
	}
</script>

<Dialog {open} {onClose} title="Bookmarks" titleAlign="left" size="md" placement="center">
	{#if bookmarks.length}
		<div class="bookmarks-list">
			{#each bookmarks as bookmark (bookmark.key)}
				{@const name = speaker(bookmark.message)}
				{@const snippet = preview(bookmark.message)}
				<div class="bookmark-row">
					<button type="button" class="bookmark-target" disabled={navigating}
						aria-label="{bookmark.onPath ? 'Go to' : 'Inspect'} message #{bookmark.ordinal}: {snippet}" onclick={() => jump(bookmark)}>
						<span class="bookmark-meta">#{bookmark.ordinal} · {name}{#if bookmark.variantId && (bookmark.message.variants?.length ?? 0) > 1}<span class="bookmark-version">Version {bookmark.versionIndex + 1} · {bookmark.onPath ? 'Selected' : 'Other version'}</span>{/if}</span>
						<span class="bookmark-preview">{snippet}</span>
					</button>
					<button type="button" class="bookmark-remove" disabled={navigating || removing.includes(bookmark.key)}
						aria-label="Remove bookmark #{bookmark.ordinal}, version {bookmark.versionIndex + 1}" title="Remove bookmark" onclick={() => remove(bookmark)}>
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
	.bookmark-version { font-size:.65rem; color:var(--color-text-muted); }
	.bookmark-preview { font-size:.82rem; line-height:1.5; color:var(--color-text-primary); display:-webkit-box; -webkit-line-clamp:3; line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:anywhere; }
	.bookmark-remove { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:2.5rem; height:2.5rem; border-radius:var(--radius-md); color:var(--color-accent); cursor:pointer; }
	.bookmark-remove:hover { background:var(--color-bg-tertiary); }
	.bookmarks-empty { padding:.65rem; font-size:.85rem; line-height:1.6; color:var(--color-text-muted); }
	button:disabled { opacity:.5; cursor:default; }
</style>
