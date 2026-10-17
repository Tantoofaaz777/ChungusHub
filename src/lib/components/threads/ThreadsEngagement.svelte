<script lang="ts">
	/** Display-only audience reactions, as in Threadverse. They never change scores. */
	import Icon from '$lib/components/ui/Icon.svelte';
	let { score, commentCount }: { score: number; commentCount?: number } = $props();
</script>

<div class="engagement">
	<span class="votes" role="img" aria-label={`${score.toLocaleString()} votes`} title="Audience score">
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 10.5h4.25V21h6.5V10.5h4.25L12 3Z" /></svg>
		<span class="score">{score.toLocaleString()}</span>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21 4.5 13.5h4.25V3h6.5v10.5h4.25L12 21Z" /></svg>
	</span>
	{#if commentCount !== undefined}
		<span class="comment-count" aria-label={`${commentCount} comments`}><Icon name="chat" class="w-3.5 h-3.5" /><span>{commentCount}</span><span class="action-label">comments</span></span>
	{:else}
		<span class="visual-action" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5v-3h4c3.5 0 5.5 1.2 7 4-.4-5-2.7-8-7-8H9V7Z" /></svg><span class="action-label">Reply</span></span>
	{/if}
	<span class="visual-action" aria-hidden="true"><Icon name="externalLink" class="w-3.5 h-3.5" /><span class="action-label">Share</span></span>
</div>

<style>
	.engagement { display:flex; flex-wrap:wrap; align-items:center; gap:.75rem; margin-top:.65rem; min-width:0; color:var(--color-text-muted); font-size:.67rem; line-height:1; }
	.votes { display:inline-flex; align-items:center; gap:.5rem; padding:.35rem .5rem; border:1px solid var(--color-border-subtle); border-radius:var(--radius-full); background:var(--color-bg-tertiary); }
	svg { width:.9rem; height:.9rem; flex-shrink:0; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
	.score { font-weight:650; color:var(--color-text-primary); font-variant-numeric:tabular-nums; }
	.comment-count, .visual-action { display:inline-flex; align-items:center; gap:.3rem; }
	@media(max-width:420px) { .engagement { gap:.65rem; } .action-label { display:none; } }
</style>
