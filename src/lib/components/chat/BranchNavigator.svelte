<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		current: number;
		total: number;
		onNavigate: (direction: 'prev' | 'next') => void;
	}

	let { current, total, onNavigate }: Props = $props();
</script>

<div class="branch-nav" role="group" aria-label="Response branch navigation">
	<button
		type="button"
		class="branch-btn"
		disabled={current === 0}
		onclick={() => onNavigate('prev')}
		aria-label="Previous branch"
		title="Previous"
	>
		<Icon name="chevronLeft" class="w-3.5 h-3.5" strokeWidth={1.75} />
	</button>

	<span class="branch-count">{current + 1} / {total}</span>

	<button
		type="button"
		class="branch-btn"
		disabled={current === total - 1}
		onclick={() => onNavigate('next')}
		aria-label="Next branch"
		title="Next"
	>
		<Icon name="chevronRight" class="w-3.5 h-3.5" strokeWidth={1.75} />
	</button>
</div>

<style>
	.branch-nav {
		display: inline-flex;
		align-items: center;
		gap: 0.14rem;
		padding: 0.16rem;
		border-radius: var(--radius-lg);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 92%, transparent);
		background: color-mix(in srgb, var(--color-bg-secondary) 76%, transparent);
	}

	.branch-btn {
		width: 1.6rem;
		height: 1.6rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
	}

	.branch-btn:hover:not(:disabled) {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
		border-color: color-mix(in srgb, var(--color-border) 76%, transparent);
	}

	.branch-btn:disabled {
		opacity: 0.32;
		cursor: not-allowed;
	}

	.branch-btn:focus-visible {
		outline: 0;
		border-color: color-mix(in srgb, var(--color-accent) 85%, white 15%);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent-muted) 70%, transparent);
	}

	/* A compact mobile pager still leaves a larger target than the desktop control. */
	@media (pointer: coarse) {
		.branch-nav {
			gap: 0.08rem;
			padding: 0.1rem;
		}

		.branch-btn {
			width: 2.1rem;
			height: 2.1rem;
		}

		.branch-count {
			min-width: 2rem;
			padding-inline: 0.1rem;
		}
	}

	.branch-count {
		min-width: 2.3rem;
		padding: 0 0.2rem;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: var(--color-text-secondary);
	}
</style>
