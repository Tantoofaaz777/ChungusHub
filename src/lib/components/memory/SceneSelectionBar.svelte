<script lang="ts">
 import { memoryStore } from '$lib/memory/scene-store.svelte';
 import Button from '$lib/components/ui/Button.svelte';
 let count = $derived(memoryStore.selectedMessages.length);
</script>
{#if memoryStore.selection}
 <div class="scene-selection-bar" role="region" aria-label="Select scene">
  <span>{count ? `${count} messages selected` : memoryStore.selection.startId ? 'Select the last message (or the same message for a single turn).' : 'Select the first message of the scene.'}</span>
  {#if memoryStore.selectionError}<p role="alert">{memoryStore.selectionError}</p>{/if}
  <div><Button variant="ghost" size="sm" onclick={() => memoryStore.selection = null}>Cancel</Button><Button size="sm" disabled={!!memoryStore.selectionError || !memoryStore.selectedMessages.some((m) => !m.excludedFromPrompt)} onclick={() => memoryStore.summarizeSelection()}>Summarize</Button></div>
 </div>
{/if}
<style>
 .scene-selection-bar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:.5rem; padding:.65rem 1rem; background:var(--color-bg-secondary); border-bottom:1px solid var(--color-border); font-family:var(--font-ui); font-size:.8rem; }
 .scene-selection-bar>span { flex:1; min-width:10rem; }
 .scene-selection-bar>p { color:var(--color-warning); font-size:.75rem; flex-basis:100%; }
 .scene-selection-bar>div { display:flex; gap:.4rem; margin-left:auto; }
</style>
