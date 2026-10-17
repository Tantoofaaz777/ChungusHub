<script lang="ts">
	import type { Snippet } from 'svelte';
	import { panelActivity, providePanelActivity } from './panelActivity';

	// An animated outer shell can keep painting the last view while activity stops now.
	let { active, present, children }: { active: boolean; present?: boolean; children: Snippet } = $props();
	const parentActive = panelActivity();
	const visible = $derived(active && parentActive());
	let visited = $state(false);
	providePanelActivity(() => visible);
	$effect(() => { if (visible) visited = true; });
</script>

<div class="retained-view" hidden={!(present ?? active)} inert={!visible}>
	{#if visited || visible}{@render children()}{/if}
</div>

<style>
	.retained-view { height:100%; min-height:0; }
	.retained-view[hidden] { display:none !important; }
</style>
