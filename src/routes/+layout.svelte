<script lang="ts">
	import '../app.css';
	import '../chat-highlights.css';
	import { onMount } from 'svelte';
	import { protectTouchRanges } from '#lib/services/touch-ranges.ts';

	onMount(() => protectTouchRanges(document));

	let { children } = $props();
</script>

{@render children()}
