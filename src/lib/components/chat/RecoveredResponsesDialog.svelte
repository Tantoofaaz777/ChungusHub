<script lang="ts">
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import GenerationDots from '#lib/components/ui/GenerationDots.svelte';
	import HoldToConfirmButton, { holdMsForBlast } from '#lib/components/ui/HoldToConfirmButton.svelte';
	import { deleteGuard } from '#lib/stores/delete-guard.svelte.ts';
	import { recoveredGenerations } from '#lib/stores/recoveredGenerations.svelte.ts';
	import { recoveredResponse } from '#shared/recovered-generation.ts';
	import { copyText } from '#lib/utils/clipboard.ts';
	import { formatDate } from '#lib/utils/date.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';

	let selectedId = $state<string | null>(null);
	let confirmingId = $state<string | null>(null);
	let copied = $state<'content' | 'thinking' | null>(null);
	$effect(() => {
		if (!recoveredGenerations.entries.some(entry => entry.id === selectedId)) selectedId = recoveredGenerations.entries[0]?.id ?? null;
	});
	$effect(() => { void selectedId; confirmingId = null; copied = null; });
	const selected = $derived(recoveredGenerations.entries.find(entry => entry.id === selectedId));
	const response = $derived(selected ? recoveredResponse(selected) : null);

	async function copy(kind: 'content' | 'thinking') {
		if (!response) return;
		const id = selectedId;
		try { await copyText(response[kind]); if (selectedId === id) copied = kind; }
		catch (error) { toastStore.failed('copy recovered text', error); }
	}
	async function discard() {
		if (!selected || recoveredGenerations.removingId) return;
		if (deleteGuard.asks && confirmingId !== selected.id) { confirmingId = selected.id; return; }
		try { await recoveredGenerations.discard(selected.id); confirmingId = null; }
		catch (error) { toastStore.failed('discard the recovered response', error); }
	}
</script>

<Dialog open={recoveredGenerations.open} onClose={() => recoveredGenerations.open = false} title="Recovered responses" titleAlign="left" size="xl" placement="center">
	<p class="recovery-help">These generations finished after their conversation changed. Copy the saved text before discarding it. Your current conversation is preserved.</p>
	{#if recoveredGenerations.error}
		<div class="recovery-error" role="alert"><p>{recoveredGenerations.error}</p><Button variant="secondary" size="sm" onclick={() => recoveredGenerations.refresh()}>Retry</Button></div>
	{/if}
	{#if recoveredGenerations.loading}<GenerationDots label="Loading recovered responses" />{/if}
	{#if recoveredGenerations.entries.length}
		<div class="recovery-list" role="group" aria-label="Saved generations">
			{#each recoveredGenerations.entries as entry, index (entry.id)}
				<Button variant={entry.id === selectedId ? 'primary' : 'secondary'} size="sm" aria-pressed={entry.id === selectedId} onclick={() => selectedId = entry.id}>{recoveredResponse(entry).kind} {index + 1} · {formatDate(entry.createdAt)}</Button>
			{/each}
		</div>
		{#if selected && response}
			<p class="recovery-reason">{selected.reason}</p>
			<label class="recovery-label" for="recovered-response-text">Saved response</label>
			<textarea id="recovered-response-text" class="recovery-text" readonly value={response.content} rows="12" placeholder="No response text was saved."></textarea>
			{#if response.thinking}
				<details class="recovery-reasoning"><summary>Saved reasoning</summary><textarea class="recovery-text" aria-label="Saved reasoning" readonly value={response.thinking} rows="7"></textarea></details>
			{/if}
			<div class="recovery-actions">
				<Button variant="secondary" size="sm" disabled={!response.content} onclick={() => copy('content')}><Icon name={copied === 'content' ? 'check' : 'copy'} class="w-4 h-4" />{copied === 'content' ? 'Copied' : 'Copy response'}</Button>
				{#if response.thinking}<Button variant="ghost" size="sm" onclick={() => copy('thinking')}>{copied === 'thinking' ? 'Copied' : 'Copy reasoning'}</Button>{/if}
				<Button variant="ghost" size="sm" disabled={recoveredGenerations.removingId !== null} onclick={discard}><Icon name="trash" class="w-4 h-4" />Discard saved output</Button>
			</div>
			{#if confirmingId === selected.id}
				<div class="recovery-confirm"><p>Discard this saved response and its reasoning? This cannot be undone.</p><div class="recovery-actions"><HoldToConfirmButton shape="inline" holdMs={holdMsForBlast(1)} disabled={recoveredGenerations.removingId !== null} onconfirm={discard}>Discard saved output</HoldToConfirmButton><Button variant="ghost" size="sm" onclick={() => confirmingId = null}>Cancel</Button></div></div>
			{/if}
		{/if}
	{:else if !recoveredGenerations.loading && !recoveredGenerations.error}
		<p class="recovery-help">No recovered responses in this chat.</p>
	{/if}
</Dialog>

<style>
	.recovery-help, .recovery-reason { font-size:.8rem; line-height:1.65; color:var(--color-text-muted); margin-bottom:1rem; }
	.recovery-list, .recovery-actions { display:flex; flex-wrap:wrap; gap:.5rem; margin:.8rem 0; }
	.recovery-label { display:block; font-size:.8rem; font-weight:600; margin-bottom:.5rem; }
	.recovery-text { display:block; resize:vertical; width:100%; min-height:8rem; padding:.8rem; border:1px solid var(--color-border); border-radius:var(--radius-md); background:var(--color-bg-primary); color:var(--color-text-primary); font:inherit; font-size:.85rem; line-height:1.7; }
	.recovery-reasoning { margin-top:1rem; }
	.recovery-reasoning summary { cursor:pointer; font-size:.8rem; margin-bottom:.5rem; }
	.recovery-error, .recovery-confirm { padding:.8rem; border:1px solid var(--color-error); border-radius:var(--radius-md); font-size:.8rem; line-height:1.65; margin-bottom:1rem; }
</style>
