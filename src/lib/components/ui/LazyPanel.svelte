<script lang="ts" generics="P extends Record<string, unknown>">
	import type { Component } from 'svelte';
	import { panelActivity } from './panelActivity';
	import GenerationDots from './GenerationDots.svelte';
	import Alert from './Alert.svelte';
	import Button from './Button.svelte';

	type Loader = () => Promise<{ default: Component<P> }>;
	let { load, componentProps = {} as P, label = 'panel' }: {
		load: Loader; componentProps?: P; label?: string;
	} = $props();
	const active = panelActivity();
	let result = $state.raw<{ loader: Loader; component: Component<P> } | null>(null);
	let failure = $state.raw<{ loader: Loader } | null>(null);
	let attempt = $state(0);
	let Current = $derived(result && result.loader === load ? result.component : null);
	let failed = $derived(failure?.loader === load);

	$effect(() => {
		void attempt;
		if (!active() || Current) return;
		const loader = load;
		let cancelled = false;
		failure = null;
		void loader().then((module) => {
			if (!cancelled) result = { loader, component: module.default };
		}, () => {
			if (!cancelled) failure = { loader };
		});
		return () => { cancelled = true; };
	});
</script>

{#if Current}
	<Current {...componentProps} />
{:else}
	<div class="lazy-panel-status" role={failed ? undefined : 'status'}>
		{#if failed}
			<Alert message={`Couldn’t load ${label}. Check your connection and try again.`} />
			<Button variant="secondary" size="sm" onclick={() => { attempt++; }}>Try again</Button>
		{:else}
			<p>Loading {label}…</p>
			<GenerationDots label={`Loading ${label}`} />
		{/if}
	</div>
{/if}

<style>
	.lazy-panel-status {
		display: flex; flex-direction: column; align-items: center; justify-content: center;
		gap: 0.75rem; min-height: 8rem; height: 100%; padding: 1rem;
		font-family: var(--font-ui); font-size: 0.85rem; color: var(--color-text-muted);
	}
	.lazy-panel-status p { margin: 0; }
</style>
