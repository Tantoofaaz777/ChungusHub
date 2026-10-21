<script lang="ts">
	/**
	 * Try the open book against text the reader types, and show exactly what would fire.
	 *
	 * The counterpart to the trace a reply carries: that one answers "what shaped this turn",
	 * this one answers "why does my entry never fire", which is the question a stored record
	 * cannot answer, because the entry that is failing is precisely the one the record has
	 * nothing to say about.
	 *
	 * It runs the real engine, never a second implementation of the matching rules, and it
	 * writes nothing: no generation, no store, no row.
	 */
	import { resolveLorebooks } from '$lib/lorebook/engine';
	import { tokenEstimate } from '$lib/tokenizer/reactive.svelte';
	import { lorebookSettingsStore } from '$lib/lorebook/settings.svelte';
	import LorebookTraceList from './LorebookTraceList.svelte';
	import type { Lorebook } from '$lib/lorebook/types';

	interface Props {
		book: Lorebook;
	}

	let { book }: Props = $props();

	let text = $state('');

	/** One line is one turn, oldest first, so scan depth means here what it means in a chat. */
	const turns = $derived(
		text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0)
	);

	// Trigger rolls are pinned to pass: a tester whose answer changes on every keystroke for
	// reasons that have nothing to do with the text is worse than no tester. The dice are the
	// entry row's business, matching is this box's.
	const result = $derived(
		turns.length > 0
			? tokenEstimate(() => resolveLorebooks({
					books: [book],
					messages: turns,
					settings: lorebookSettingsStore.settings,
					rng: () => 0
				}))
			: null
	);
</script>

<div class="st-body">
	<label class="st-label section-label" for="lorebook-scan-test">Text to scan</label>
	<textarea
		id="lorebook-scan-test"
		bind:value={text}
		class="input-base st-input"
		rows="4"
		placeholder="Paste a few lines of story. One line is one turn, oldest first…"
	></textarea>

	{#if result}
		<p class="st-note">Trigger rolls always pass here, so an entry's chance never hides it.</p>
		<LorebookTraceList trace={result.trace} />
	{:else}
		<p class="st-note">{turns.length ? 'Loading token counter…' : 'Nothing to scan yet.'}</p>
	{/if}
</div>

<style>
	.st-body {
		padding: 0.9rem 1rem 1rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.st-label {
		display: block;
		margin-bottom: 0.35rem;
	}

	.st-input {
		width: 100%;
		padding: 0.6rem 0.75rem;
		font-family: var(--font-body);
		font-size: 0.9rem;
		line-height: 1.5;
		resize: vertical;
	}

	.st-note {
		margin: 0.7rem 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}
</style>
