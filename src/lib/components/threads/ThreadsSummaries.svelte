<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import ExpandableTextarea from '#lib/components/ui/ExpandableTextarea.svelte';
	import { threadsStore as store } from '#lib/threads/store.svelte.ts';
	import { MAX_THREADS_SUMMARY_LENGTH } from '#shared/threads/summary.ts';
	import type { ThreadsRound } from '#shared/threads/types.ts';
	import ThreadsChapterPicker from './ThreadsChapterPicker.svelte';

	let { visible, labels }: { visible: boolean; labels: ReadonlyMap<string, string> } = $props();
	let selectedId = $state<string | null>(null);
	let savedId = $state<string | null>(null);
	const drafts = new SvelteMap<string, { original: string; text: string; error?: string }>();
	const rounds = $derived(store.rounds.filter(round => round.summary));
	const selected = $derived(rounds.find(round => round.id === selectedId) ?? rounds.at(-1));
	const draft = $derived(selected ? drafts.get(selected.id) : undefined);
	const text = $derived(draft?.text ?? selected?.summary ?? '');
	const trimmedText = $derived(text.trim());
	const valid = $derived(trimmedText.length > 0 && trimmedText.length <= MAX_THREADS_SUMMARY_LENGTH);
	const changed = $derived(!!draft && trimmedText !== selected?.summary);
	const conflict = $derived(changed && draft?.original !== selected?.summary);
	const outsideContext = $derived(selected && !store.previousRounds.some(round => round.id === selected.id));

	$effect(() => {
		const next = selected?.id ?? null;
		if (visible && selectedId !== next) selectedId = next;
	});

	function edit(round: ThreadsRound, value: string) {
		if (!round.summary) return;
		const original = drafts.get(round.id)?.original ?? round.summary;
		savedId = null;
		if (value === round.summary) drafts.delete(round.id);
		else drafts.set(round.id, { original, text: value });
	}

	async function save(round: ThreadsRound) {
		const pending = drafts.get(round.id);
		const summary = pending?.text.trim();
		if (!round.summary || !pending || !summary || summary.length > MAX_THREADS_SUMMARY_LENGTH) return;
		try {
			// On a conflict, the editor exposes the latest saved text before offering an overwrite.
			await store.updateSummary(round, round.summary, summary);
			drafts.delete(round.id);
			savedId = round.id;
		} catch (error) {
			drafts.set(round.id, { ...pending, error: error instanceof Error ? error.message : String(error) });
			if (store.chatId === round.chatId) void store.syncReload();
		}
	}
</script>

{#if visible}
	{#if selected}
		{@const round = selected}
		<ThreadsChapterPicker {rounds} {labels} value={round.id} label="Summary chapters" onchange={(id) => { selectedId = id; savedId = null; }} />
		<section class="summary-card">
			<div class="summary-heading">
				<label for="threads-story-summary">{labels.get(round.id)}</label>
				{#if outsideContext}<span>Outside current context</span>{/if}
			</div>
			{#key round.id}
				<ExpandableTextarea id="threads-story-summary" value={text} onValueChange={(value) => edit(round, value)}
					dialogTitle={`Story summary · ${labels.get(round.id)}`} rows={8} macroScope="none" disabled={store.busy}
					class="input-base summary-text" />
			{/key}
			{#if conflict}
				<details class="summary-conflict">
					<summary>The saved summary changed. Review the current version.</summary>
					<p>{round.summary}</p>
				</details>
			{/if}
			{#if draft?.error}
				<p class="summary-error" role="alert">{draft.error}</p>
			{/if}
			<div class="summary-actions">
				{#if changed && !valid}
					<span class="summary-error">{trimmedText ? `Use at most ${MAX_THREADS_SUMMARY_LENGTH.toLocaleString()} characters.` : 'Enter summary text to save.'}</span>
				{:else if changed}
					<span>Unsaved changes</span>
				{:else if savedId === round.id}
					<span role="status">Summary saved.</span>
				{/if}
				{#if draft}<Button variant="ghost" size="sm" disabled={store.busy} onclick={() => drafts.delete(round.id)}>Discard edits</Button>{/if}
				<Button size="sm" disabled={store.busy || !changed || !valid} onclick={() => save(round)}>{conflict ? 'Save my version' : 'Save summary'}</Button>
			</div>
		</section>
	{:else}
		<EmptyState icon="threads" title="No summaries yet">Saved summaries appear here when Threads summarizes older story rounds.</EmptyState>
	{/if}
{/if}

<style>
	.summary-card { display:grid; gap:.75rem; min-width:0; padding:1rem; border:1px solid var(--color-border-subtle); border-radius:var(--radius-lg); background:var(--color-bg-secondary); }
	.summary-heading, .summary-actions { display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; }
	.summary-heading { justify-content:space-between; }
	.summary-heading label { font-size:.9rem; font-weight:650; overflow-wrap:anywhere; }
	.summary-heading span, .summary-actions span { font-size:.72rem; color:var(--color-text-muted); }
	.summary-actions { justify-content:flex-end; }
	.summary-actions span { margin-right:auto; }
	.summary-card :global(.summary-text) { width:100%; padding:.65rem; font-size:.8rem; line-height:1.6; }
	.summary-card .summary-error { font-size:.75rem; color:var(--color-error); overflow-wrap:anywhere; }
	.summary-conflict { font-size:.75rem; color:var(--color-text-secondary); }
	.summary-conflict summary { cursor:pointer; }
	.summary-conflict p { margin-top:.5rem; padding:.65rem; border:1px solid var(--color-border-subtle); border-radius:var(--radius-md); white-space:pre-wrap; overflow-wrap:anywhere; }
</style>
