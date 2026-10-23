<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { protectTouchRanges } from '$lib/services/touch-ranges';

	onMount(() => protectTouchRanges(document));

	let { children } = $props();
</script>

{@render children()}
