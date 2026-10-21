<script lang="ts">
	import GenerationDots from './GenerationDots.svelte';
	let { label, progress }: {
		label: string;
		progress: { reasoning: number | null; response: number | null };
	} = $props();
</script>

<div class="generation-progress">
	<span class="generation-label" role="status"><GenerationDots {label} />{label}</span>
	<span class="generation-tokens" title="Estimated tokens from received text, using the assigned model’s tokenizer.">Reasoning {progress.reasoning === null ? '-' : `~${progress.reasoning.toLocaleString()}`} · Response {progress.response === null ? '-' : `~${progress.response.toLocaleString()}`} tok</span>
</div>

<style>
	.generation-progress { display:flex; flex-direction:column; gap:.4rem; min-width:0; }
	.generation-label { display:flex; align-items:center; gap:.5rem; }
	.generation-tokens { font-family:var(--font-mono); font-size:.68rem; font-variant-numeric:tabular-nums; color:var(--color-text-muted); overflow-wrap:anywhere; }
</style>
