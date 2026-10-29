<script lang="ts">
	/** The brain pulses during a requested summary generation. A quiet corner mark
	 *  identifies saved summaries needing review; the tooltip names the same state. */
	import type { ComponentProps } from 'svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { memoryStore } from '#lib/memory/scene-store.svelte.ts';

	/** Handed down rather than hardcoded, so the nav table stays the one place that says which
	 *  glyph this button wears. */
	let { icon }: { icon: ComponentProps<typeof Icon>['name'] } = $props();

	let standing = $derived(memoryStore.standing);

	// Counts name reviewable summaries, not an automatic extraction backlog.

	let count = $derived(standing.kind === 'behind' && standing.outstanding > 1 ? standing.outstanding : 0);
</script>

<span class="mem-glyph" class:is-working={standing.kind === 'working'}>
	<Icon name={icon} class="w-3.5 h-3.5" />
</span>

<!-- One slot, one chain, and the order is the rule: the count takes the corner when there is
     one (a tinted figure is already a mark, and a better one), and otherwise the mark belongs
     to `behind` and `error` and to nothing else. Naming those two states rather than excluding
     `idle` is deliberate: a warning dot over a run that is actively closing the backlog reads
     as "look here, something is wrong" about the very work that is fixing it. -->
<span class="mem-status" aria-hidden="true">
	{#if count > 0}
		<span class="mem-count" class:is-behind={standing.kind === 'behind'}>{count}</span>
	{:else if standing.kind === 'behind' || standing.kind === 'error'}
		<span class="mem-mark" class:is-error={standing.kind === 'error'}></span>
	{/if}
</span>

<style>
	/* Exactly the box the bare icon occupied in the nav row, so the button's geometry does not
	   depend on what memory is doing: it never grows, the cluster never reorders, and neither
	   neighbour moves. */
	.mem-glyph {
		display: inline-flex;
		flex: 0 0 auto;
		color: inherit;
	}

	/* The glyph is the indicator. `color` reaches the icon through currentColor, and the glow
	   breathes with the opacity because both sit on this element: one moving thing, so
	   nothing else in the button plays while a pass is running. */
	.mem-glyph.is-working {
		color: var(--color-accent);
		filter: drop-shadow(0 0 4px color-mix(in srgb, var(--color-accent) 55%, transparent));
		animation: mem-pulse 1.2s ease-in-out infinite alternate;
	}

	@keyframes mem-pulse {
		from {
			opacity: 0.6;
		}
		to {
			opacity: 1;
		}
	}

	/* Fills the button, takes part in none of its layout. */
	.mem-status {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.mem-mark {
		position: absolute;
		top: 0.2rem;
		right: 0.24rem;
		width: 5px;
		height: 5px;
		border-radius: var(--radius-full);
		background: var(--color-warning);
	}

	.mem-mark.is-error {
		background: var(--color-error);
	}

	/* Above the label's cap height and inside the button's own right padding, so it clears the
	   word at every width instead of sitting on it. */
	.mem-count {
		position: absolute;
		top: 0.06rem;
		right: 0.2rem;
		font-family: var(--font-ui);
		font-size: 0.5rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		color: var(--color-accent);
	}

	.mem-count.is-behind {
		color: var(--color-warning);
	}

	@media (prefers-reduced-motion: reduce) {
		/* The breath goes and what it leaves is the glyph lit at full strength, a frame that
		   still reads as working, which is the only kind of animation allowed here. */
		.mem-glyph.is-working {
			animation: none;
		}
	}
</style>
