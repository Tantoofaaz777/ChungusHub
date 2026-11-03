<script lang="ts">
	import { untrack } from 'svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import HoldToConfirmButton, { holdMsForBlast } from '#lib/components/ui/HoldToConfirmButton.svelte';
	import { deleteGuard } from '#lib/stores/delete-guard.svelte.ts';
	import { responseVersionsStore } from '#lib/stores/responseVersions.svelte.ts';
	import { responseVersions } from '#lib/utils/response-versions.ts';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { messageStore } from '#lib/stores/messages.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import { copyText } from '#lib/utils/clipboard.ts';
	import { formatDate } from '#lib/utils/date.ts';
	import ResponsePreview from './ResponsePreview.svelte';

	const target = $derived(responseVersionsStore.target);
	const chat = $derived(chatStore.currentChatState?.chat.id === target?.chatId ? chatStore.currentChatState : null);
	const turn = $derived(chat?.allMessages.find(message => message.id === target?.messageId));
	const versions = $derived(turn ? responseVersions(turn) : []);
	let viewedId = $state<string | null>(null);
	let busy = $state(false);
	let copied = $state(false);
	let confirming = $state<{ variantId: string; revision: number } | null>(null);
	let openingKey = '';
	$effect(() => {
		const key = target ? `${target.chatId}:${target.messageId}:${target.variantId}` : '';
		if (key === openingKey) return;
		openingKey = key;
		viewedId = untrack(() => target?.variantId ?? turn?.selectedVariantId ?? versions[0]?.variantId ?? null);
		confirming = null; copied = false;
	});
	$effect(() => { if (target && target.chatId !== chatStore.activeChatId) responseVersionsStore.close(); });
	const viewed = $derived(versions.find(version => version.variantId === viewedId));
	const ordinal = $derived(chat?.activePath.findIndex(message => message.id === turn?.id) ?? -1);
	const depth = $derived(Math.max(0, (chat?.activePath.length ?? 1) - 1 - ordinal));
	const canSelect = $derived(!!turn && messageStore.canSelectSwipe(turn.id));
	const canDelete = $derived(canSelect && versions.length > 1 && !!viewed?.variantId);

	function inspect(direction: -1 | 1) {
		const next = versions[(viewed?.index ?? -1) + direction];
		if (next) { viewedId = next.variantId; confirming = null; copied = false; }
	}
	async function select() {
		if (!turn || !viewed?.variantId || turn.revision === undefined || busy) return;
		busy = true;
		try { await messageStore.selectSwipe(turn.id, viewed.variantId, turn.revision); }
		catch (error) { toastStore.failed('select the swipe', error); }
		finally { busy = false; }
	}
	async function bookmark() {
		if (!turn || !viewed?.variantId || turn.revision === undefined || busy) return;
		busy = true;
		try { await messageStore.setVersionBookmarked(turn.id, viewed.variantId, !viewed.message.isBookmarked, turn.revision); }
		catch (error) { toastStore.failed('change this version’s bookmark', error); }
		finally { busy = false; }
	}
	async function branch() {
		if (!turn || !viewed || busy || messageStore.warnIfBusy()) return;
		busy = true;
		try { await chatStore.branchChat(turn.chatId, turn.id, viewed.message.content, viewed.variantId ?? undefined); responseVersionsStore.close(); }
		catch (error) { toastStore.failed('branch from this version', error); }
		finally { busy = false; }
	}
	async function copy() {
		if (!viewed) return;
		const id = viewedId;
		try { await copyText(viewed.message.content); if (viewedId === id) copied = true; }
		catch (error) { toastStore.failed('copy this version', error); }
	}
	async function remove() {
		if (!turn || !viewed?.variantId || turn.revision === undefined || busy || !canDelete) return;
		if (deleteGuard.asks && !confirming) { confirming = { variantId: viewed.variantId, revision: turn.revision }; return; }
		const request = confirming ?? { variantId: viewed.variantId, revision: turn.revision };
		const chatId = turn.chatId, messageId = turn.id;
		busy = true;
		try {
			if (await messageStore.deleteSwipe(messageId, request.variantId, request.revision)) {
				if (responseVersionsStore.target?.chatId === chatId && responseVersionsStore.target.messageId === messageId) {
					viewedId = chatStore.currentChatState?.allMessages.find(message => message.id === messageId)?.selectedVariantId ?? null;
					confirming = null;
				}
			}
		} catch (error) { toastStore.failed('delete this swipe', error); }
		finally { busy = false; }
	}
</script>

<Dialog open={target !== null} onClose={() => responseVersionsStore.close()} title="Response versions" titleAlign="left" size="xl" placement="center">
	{#if turn && viewed}
		<div class="version-heading">
			<div><p class="version-number">Turn #{ordinal + 1} · Version {viewed.index + 1} of {versions.length}</p>
				<p class="version-meta">{viewed.selected ? 'Selected in this conversation' : 'Other saved version'} · {formatDate(viewed.message.createdAt)}{#if viewed.message.model} · {viewed.message.model}{/if}</p></div>
			<div class="version-pager" role="group" aria-label="Inspect saved versions">
				<Button variant="ghost" size="sm" disabled={busy || viewed.index === 0} aria-label="Inspect previous version" onclick={() => inspect(-1)}><Icon name="chevronLeft" class="w-4 h-4" /></Button>
				<Button variant="ghost" size="sm" disabled={busy || viewed.index === versions.length - 1} aria-label="Inspect next version" onclick={() => inspect(1)}><Icon name="chevronRight" class="w-4 h-4" /></Button>
			</div>
		</div>
		{#if !canSelect}<p class="version-hint">Inspect saved versions here. To continue from another version, branch into a new chat.</p>{/if}
		{#key viewed.variantId}<ResponsePreview message={viewed.message} {depth} />{/key}
		<div class="version-actions">
			<Button variant="secondary" size="sm" onclick={copy}><Icon name={copied ? 'check' : 'copy'} class="w-4 h-4" />{copied ? 'Copied' : 'Copy text'}</Button>
			<Button variant="ghost" size="sm" disabled={busy} aria-pressed={!!viewed.message.isBookmarked} onclick={bookmark}><Icon name="star" class="w-4 h-4" />{viewed.message.isBookmarked ? 'Remove bookmark' : 'Bookmark version'}</Button>
			<Button variant="secondary" size="sm" disabled={busy || messageStore.busy} onclick={branch}><Icon name="branch" class="w-4 h-4" />Branch from this version</Button>
			{#if canSelect && !viewed.selected}<Button size="sm" disabled={busy || messageStore.busy} onclick={select}>Select this swipe</Button>{/if}
			{#if canDelete}<Button variant="ghost" size="sm" disabled={busy || messageStore.busy} onclick={remove}><Icon name="trash" class="w-4 h-4" />Delete this swipe</Button>{/if}
		</div>
		{#if confirming}
			<div class="version-delete">
				<p>Delete version {viewed.index + 1}? This keeps the turn and its other {versions.length - 1} version{versions.length === 2 ? '' : 's'}. This cannot be undone.</p>
				<div class="version-actions"><HoldToConfirmButton shape="inline" holdMs={holdMsForBlast(1)} disabled={busy || !canDelete} onconfirm={remove}>Delete this swipe</HoldToConfirmButton><Button variant="ghost" size="sm" disabled={busy} onclick={() => confirming = null}>Cancel</Button></div>
			</div>
		{/if}
	{:else}
		<p class="version-hint">This response version is no longer available.</p>
		{#if versions.length}<Button variant="secondary" onclick={() => viewedId = turn?.selectedVariantId ?? versions[0].variantId}>Inspect selected version</Button>{/if}
	{/if}
</Dialog>

<style>
	.version-heading { display:flex; justify-content:space-between; gap:1rem; margin-bottom:1rem; }
	.version-number { font-size:.9rem; font-weight:600; }
	.version-meta, .version-hint { font-size:.78rem; color:var(--color-text-muted); line-height:1.6; }
	.version-meta { margin-top:.35rem; }
	.version-hint { margin:.5rem 0 1rem; }
	.version-pager, .version-actions { display:flex; align-items:center; flex-wrap:wrap; gap:.5rem; }
	.version-actions { margin-top:1.2rem; }
	.version-delete { margin-top:1rem; padding:1rem; border:1px solid var(--color-error); border-radius:var(--radius-lg); font-size:.8rem; line-height:1.6; }
</style>
