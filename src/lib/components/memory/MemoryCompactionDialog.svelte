<script lang="ts">
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { memoryStore } from '#lib/memory/scene-store.svelte.ts';
	import { chapterTitle } from '../../../../shared/memory-scenes';
	let selection = $derived(memoryStore.compaction);
	let candidates = $derived(memoryStore.compactionCandidates);
	let error = $derived(memoryStore.compactionError);
</script>

<Dialog open={selection !== null} onClose={() => memoryStore.compaction = null} title={`Create ${selection?.level ?? 'memory'}`} size="lg" titleAlign="left" placement="center">
	{#if selection}
		<div class="compaction-picker">
			<p>Select at least two consecutive {selection.level === 'arc' ? 'chapters' : 'arcs'}. Their saved summaries will be used to create the {selection.level}.</p>
			{#if !candidates.length}<p>No available sources on this branch. Create or review the source summaries first.</p>{/if}
			<div class="source-list">
				{#each candidates as item (item.scene.id)}
					<label class:selected={selection.ids.includes(item.scene.id)}>
						<input type="checkbox" checked={selection.ids.includes(item.scene.id)} onchange={() => memoryStore.toggleCompactionSource(item.scene.id)} />
						<span>{chapterTitle(item.scene.title)}<small>Messages {item.start + 1} to {item.end + 1}</small></span>
					</label>
				{/each}
			</div>
			{#if error}<p class="selection-hint" role="status">{error}</p>{/if}
			<div class="picker-actions">
				<Button variant="ghost" size="sm" onclick={() => memoryStore.compaction = null}>Cancel</Button>
				<Button variant="secondary" size="sm" disabled={!!error} onclick={() => memoryStore.createCompaction(false)}>Write manually</Button>
				<Button size="sm" disabled={!!error} onclick={() => memoryStore.createCompaction(true)}>Generate {selection.level}</Button>
			</div>
		</div>
	{/if}
</Dialog>

<style>
	.compaction-picker { display:flex; flex-direction:column; gap:.9rem; font-family:var(--font-ui); }
	p { font-size:.8rem; line-height:1.5; color:var(--color-text-muted); }
	.source-list { display:flex; flex-direction:column; gap:.5rem; }
	label { display:flex; align-items:center; gap:.7rem; padding:.8rem; border:1px solid var(--color-border); border-radius:var(--radius-lg); cursor:pointer; }
	label.selected { border-color:var(--color-accent); background:color-mix(in srgb,var(--color-accent) 8%,transparent); }
	input { width:1.1rem; height:1.1rem; accent-color:var(--color-accent); flex-shrink:0; }
	span { font-size:.9rem; overflow-wrap:anywhere; min-width:0; }
	small { display:block; margin-top:.25rem; font-size:.72rem; color:var(--color-text-muted); }
	.picker-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:.4rem; }
</style>
