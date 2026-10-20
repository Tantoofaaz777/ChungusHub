<script lang="ts">
	import PromptTokens from './PromptTokens.svelte';
	import PromptDebugPanel from './PromptDebugPanel.svelte';
</script>

<div class="inspector">
	<PromptTokens />
	<div class="log"><PromptDebugPanel /></div>
</div>

<style>
	.inspector { display: flex; flex-direction: column; height: 100%; min-height: 0; }
	.log { flex: 1; min-height: 0; }
</style>
