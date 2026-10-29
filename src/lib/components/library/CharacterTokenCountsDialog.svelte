<script lang="ts">
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import type { CharacterTokenCounts } from '#lib/utils/character-token-counts.ts';

	let { counts, onClose }: {
		counts: CharacterTokenCounts;
		onClose: () => void;
	} = $props();
</script>

<Dialog open title="Character token counts" titleAlign="left" placement="center" size="md" bare {onClose}>
	<div class="token-counts panel-scroll overscroll-contain">
		<p class="token-total">
			<span class="token-hash" aria-hidden="true">#</span>
			{counts.total.toLocaleString()} tokens across all listed text
		</p>
		{#each counts.groups as group (group.label)}
			<section aria-label={group.label}>
				<h3>{group.label}</h3>
				<dl class="count-rows">
					{#each group.rows as row (row.key)}
						<div class="count-row">
							<dt>{row.label}</dt>
							<dd>{row.tokens.toLocaleString()}</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/each}
	</div>
</Dialog>

<style>
	.token-counts { min-height: 0; padding: 1rem 1.25rem 1.25rem; font-family: var(--font-ui); }
	.token-total { display: flex; align-items: center; gap: 0.55rem; padding: 0.75rem;
		border-radius: var(--radius-md); background: color-mix(in srgb, var(--color-accent) 13%, transparent);
		color: var(--color-accent); font-size: 0.78rem; font-weight: 600; }
	.token-hash { font-size: 1rem; }
	section { margin-top: 1.1rem; }
	h3 { margin-bottom: 0.45rem; color: var(--color-text-secondary); font-size: 0.75rem; font-weight: 600; }
	.count-rows { overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
	.count-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
		padding: 0.55rem 0.65rem; font-size: 0.75rem; }
	.count-row + .count-row { border-top: 1px solid var(--color-border-subtle); }
	dt { color: var(--color-text-primary); overflow-wrap: anywhere; min-width: 0; }
	dd { flex-shrink: 0; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
</style>
