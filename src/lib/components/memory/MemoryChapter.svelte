<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { countTokens } from '$lib/tokenizer';
	import { chapterTitle, sceneLevel, type MemoryScene, type ResolvedScene } from '../../../../shared/memory-scenes';

	let { item, model, onEdit, onRemove }: {
		item: ResolvedScene;
		model: string;
		onEdit: (chapter: MemoryScene) => void;
		onRemove: (chapter: MemoryScene) => void;
	} = $props();
	let title = $derived(chapterTitle(item.scene.title));
	let level = $derived(sceneLevel(item.scene));
	// Only saved content and the chat's model affect this count. Expanding a preview
	// or typing in the review dialog does not tokenize the chapter again.
	let tokens = $derived(countTokens(item.scene.content, model));
</script>

<article class="chapter-card">
	<details class="chapter-preview">
		<summary aria-label={`Preview ${level}: ${title}`}>
			<div class="chapter-heading">
				<h4>{title}</h4>
				<span class="chapter-status" class:needs-review={item.status === 'review'}>{item.status === 'active' ? 'In prompt' : item.status === 'review' ? 'Needs review' : item.status === 'covered' ? 'Compacted' : 'Other branch'}</span>
				<Icon name="chevronDown" class="chapter-chevron w-4 h-4" />
			</div>
			<div class="chapter-meta">
				<span>{#if level !== 'chapter'}{item.scene.children?.length ?? 0} {level === 'arc' ? 'chapters' : 'arcs'}{' · '}{/if}{item.scene.source.length} {item.scene.source.length === 1 ? 'message' : 'messages'}</span>
				<span class="chapter-tokens" title={`Estimated ${level} text tokens${model ? ` · ${model}` : ''}`}># {tokens.toLocaleString()} tokens</span>
			</div>
		</summary>
		<div class="chapter-content"><p>{item.scene.content}</p></div>
	</details>
	{#if item.reason}<p class="chapter-reason">{item.reason}</p>{/if}
	<div class="chapter-actions">
		<Button variant="ghost" size="sm" onclick={() => onEdit(item.scene)}>Review / edit</Button>
		<Button variant="ghost" size="sm" onclick={() => onRemove(item.scene)} aria-label={`Remove ${level}: ${title}`}><Icon name="trash" class="w-4 h-4" /></Button>
	</div>
</article>

<style>
	.chapter-card { border:1px solid var(--color-border); border-radius:var(--radius-lg); margin-bottom:.8rem; background:var(--color-bg-secondary); overflow:hidden; }
	summary { display:flex; flex-direction:column; gap:.55rem; padding:.9rem; list-style:none; cursor:pointer; }
	summary::-webkit-details-marker { display:none; }
	summary:hover { background:color-mix(in srgb, var(--color-accent) 4%, transparent); }
	summary:focus-visible { outline:2px solid var(--color-accent); outline-offset:-3px; border-radius:var(--radius-lg); }
	.chapter-heading { display:flex; align-items:center; gap:.65rem; }
	h4 { flex:1; min-width:0; font-size:.95rem; font-weight:600; overflow-wrap:anywhere; }
	.chapter-status { flex-shrink:0; font-size:.7rem; color:var(--color-accent); }
	.needs-review { color:var(--color-warning); }
	.chapter-heading :global(.chapter-chevron) { flex-shrink:0; color:var(--color-text-muted); transition:transform 140ms ease; }
	details[open] :global(.chapter-chevron) { transform:rotate(180deg); }
	.chapter-meta { display:flex; justify-content:space-between; flex-wrap:wrap; gap:.5rem; font-size:.72rem; color:var(--color-text-muted); }
	.chapter-tokens { font-variant-numeric:tabular-nums; }
	.chapter-content { padding:0 .9rem .9rem; }
	.chapter-content p { white-space:pre-wrap; overflow-wrap:anywhere; font-size:.85rem; line-height:1.6; }
	.chapter-reason { color:var(--color-text-muted); font-size:.75rem; margin:0 .9rem .7rem; }
	.chapter-actions { display:flex; justify-content:flex-end; gap:.3rem; padding:.3rem .5rem; border-top:1px solid var(--color-border-subtle); }
</style>
