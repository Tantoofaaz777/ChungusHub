<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';

	interface Props {
		page: number;
		totalPages: number;
		onPage: (p: number) => void;
	}

	let { page, totalPages, onPage }: Props = $props();

	// Page items: always 1 and last, a ±1 window around the current page,
	// 0 marking an ellipsis. A gap of exactly one page shows the page itself.
	let items = $derived.by(() => {
		const out: number[] = [];
		let prev = 0;
		for (let p = 1; p <= totalPages; p++) {
			if (p !== 1 && p !== totalPages && Math.abs(p - page) > 1) continue;
			if (prev && p - prev === 2) out.push(prev + 1);
			else if (prev && p - prev > 2) out.push(0);
			out.push(p);
			prev = p;
		}
		return out;
	});
</script>

<nav class="pager" aria-label="Pagination">
	<button
		type="button"
		class="pager-btn"
		disabled={page <= 1}
		onclick={() => onPage(page - 1)}
		aria-label="Previous page"
	>
		<Icon name="chevronLeft" class="w-3.5 h-3.5" />
	</button>
	{#each items as item, i (i)}
		{#if item === 0}
			<span class="pager-gap" aria-hidden="true">…</span>
		{:else}
			<button
				type="button"
				class="pager-btn"
				class:is-current={item === page}
				aria-current={item === page ? 'page' : undefined}
				onclick={() => onPage(item)}
			>
				{item}
			</button>
		{/if}
	{/each}
	<button
		type="button"
		class="pager-btn"
		disabled={page >= totalPages}
		onclick={() => onPage(page + 1)}
		aria-label="Next page"
	>
		<Icon name="chevronRight" class="w-3.5 h-3.5" />
	</button>
</nav>

<style>
	.pager {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.pager-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.9rem;
		height: 1.9rem;
		padding: 0 0.4rem;
		border-radius: var(--radius-md);
		font-family: var(--font-ui);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background-color 140ms ease, color 140ms ease;
	}
	.pager-btn:hover:not(:disabled):not(.is-current) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}
	.pager-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	.pager-btn.is-current {
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-weight: 600;
	}
	.pager-gap {
		padding: 0 0.15rem;
		font-family: var(--font-ui);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
