<script lang="ts">
	/**
	 * Engines settings page: the overview. Every engine is one calm row: icon,
	 * name, one-line summary and its app-wide on/off switch. Everything deeper
	 * (what the engine does, the connection it resolves to, its prompt templates)
	 * lives in the detail view a row drills into (EngineDetail, keyed off
	 * uiStore.settingsEngineId exactly like the connection editor), so this list
	 * stays readable at a glance.
	 *
	 * This page ASSIGNS no connections: every connection choice in the app lives
	 * on the Connections page, each engine's own assignment included (its Engine
	 * models fold).
	 */
	import Icon from '#lib/components/ui/Icon.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import EngineDetail from './EngineDetail.svelte';
	import { ENGINES } from '#lib/engines/registry.ts';
	import { uiStore } from '#lib/stores/ui.svelte.ts';

	const engineId = $derived(uiStore.settingsEngineId);
</script>

{#if engineId}
	{#key engineId}
		<EngineDetail id={engineId} />
	{/key}
{:else}
	<div class="engines" data-setting="engines">
		<section class="card">
			<div class="rows">
				{#each ENGINES as engine (engine.id)}
					<div class="engine" class:is-off={!engine.enabled.get()}>
						<button
							type="button"
							class="row-main"
							onclick={() => (uiStore.settingsEngineId = engine.id)}
						>
							<span class="row-orb">
								<Icon name={engine.icon} class="w-4 h-4" strokeWidth={1.75} />
							</span>
							<span class="row-text">
								<span class="row-name">{engine.name}</span>
								<span class="row-summary">{engine.summary}</span>
							</span>
							<Icon name="chevronRight" class="w-4 h-4 row-chev" strokeWidth={2} />
						</button>
						<Toggle
							checked={engine.enabled.get()}
							onchange={(v) => engine.enabled.set(v)}
							label="Enable {engine.name}"
						/>
					</div>
				{/each}
			</div>
		</section>
	</div>
{/if}

<style>
	.engines {
		display: flex;
		flex-direction: column;
	}

	.rows {
		display: flex;
		flex-direction: column;
	}

	.rows > .engine + .engine {
		border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 65%, transparent);
	}

	.engine {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-right: 0.35rem;
		border-radius: var(--radius-md);
		transition: background-color 120ms ease;
	}

	/* Hover follows the drill button, not the toggle sitting beside it. */
	.engine:has(.row-main:hover) {
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
	}

	.row-main {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.15rem 0.6rem;
		padding: 0.6rem 0.2rem 0.6rem 0.35rem;
		border: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}

	.row-orb {
		grid-column: 1;
		grid-row: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
		color: var(--color-text-secondary);
	}

	.row-text {
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.row-name {
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 620;
		color: var(--color-text-primary);
	}

	.row-summary {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.35;
		color: var(--color-text-muted);
	}

	/* Off engines read as inert without dropping opacity on text. */
	.engine.is-off .row-name,
	.engine.is-off .row-summary {
		color: var(--color-text-muted);
	}

	.engine.is-off .row-orb {
		color: var(--color-text-muted);
		background: transparent;
	}

	.row-main :global(.row-chev) {
		grid-column: 3;
		grid-row: 1;
		color: var(--color-text-muted);
		opacity: 0.65;
	}
</style>
