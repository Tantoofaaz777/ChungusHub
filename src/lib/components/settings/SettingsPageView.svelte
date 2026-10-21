<script lang="ts">
	import LazyPanel from '$lib/components/ui/LazyPanel.svelte';
	import { settingsPages } from './page-loaders';
	import type { SettingsPage } from '$lib/config/settings-pages';

	// The retained split panel also sees 'root' briefly while it is being hidden.
	let { page }: { page: SettingsPage | 'root' } = $props();
	let load = $derived(page === 'root' ? null : settingsPages[page]);
</script>

{#if load}<LazyPanel {load} label="settings" />{/if}
