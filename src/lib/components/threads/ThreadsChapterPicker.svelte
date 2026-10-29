<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import type { ThreadsRound } from '#shared/threads/types.ts';

	let { rounds, value, onchange }: { rounds: ThreadsRound[]; value: string; onchange: (id: string) => void } = $props();
	const index = $derived(rounds.findIndex(round => round.id === value));
	function move(direction: -1 | 1) { const round = rounds[index + direction]; if (round) onchange(round.id); }
</script>

<nav class="chapter-picker" aria-label="Thread chapters">
	<button class="chapter-arrow" aria-label="Previous chapter" title="Previous chapter" disabled={index <= 0} onclick={() => move(-1)}><Icon name="chevronLeft" class="w-4 h-4" /></button>
	<select class="chapter-select input-base" aria-label="Choose chapter" {value} onchange={(event) => onchange(event.currentTarget.value)}>
		{#each [...rounds].reverse() as round (round.id)}
			<option value={round.id}>{round.label || `Thread ${rounds.indexOf(round) + 1}`}</option>
		{/each}
	</select>
	<button class="chapter-arrow" aria-label="Next chapter" title="Next chapter" disabled={index < 0 || index >= rounds.length - 1} onclick={() => move(1)}><Icon name="chevronRight" class="w-4 h-4" /></button>
</nav>

<style>
	.chapter-picker { display:flex; align-items:center; justify-content:center; gap:.4rem; margin:-.25rem 0 1rem; }
	.chapter-arrow, .chapter-select { min-height:2.5rem; border:1px solid var(--color-border-subtle); border-radius:var(--radius-md); background:var(--color-bg-secondary); color:var(--color-text-secondary); }
	.chapter-arrow { display:flex; align-items:center; justify-content:center; width:2.5rem; flex-shrink:0; }
	.chapter-arrow:disabled { opacity:.3; cursor:default; }
	.chapter-select { appearance:auto; flex:1; min-width:0; max-width:22rem; padding:.5rem .75rem; font-family:var(--font-ui); font-size:.8rem; font-weight:600; text-align:center; cursor:pointer; }
	.chapter-arrow:not(:disabled):hover, .chapter-select:hover { background:var(--color-bg-tertiary); color:var(--color-text-primary); }
</style>
