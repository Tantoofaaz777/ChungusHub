<script lang="ts">
	import type { ThreadsComment } from '$shared/threads/types';
	import ThreadsAuthor from './ThreadsAuthor.svelte';
	import ThreadsEngagement from './ThreadsEngagement.svelte';
	let { comment, depth = 0 }: { comment: ThreadsComment; depth?: number } = $props();
</script>

{#snippet renderComment(item: ThreadsComment, level: number)}
	<div class="comment" class:root={level === 0}>
		<ThreadsAuthor username={item.username} />
		<p>{item.body}</p>
		<ThreadsEngagement score={item.score} />
		{#if item.replies.length}
			<div class="replies" class:flat={level >= 3}>
				{#each item.replies as reply}{@render renderComment(reply, level + 1)}{/each}
			</div>
		{/if}
	</div>
{/snippet}
{@render renderComment(comment, depth)}

<style>
	.comment { min-width:0; padding-top:.85rem; }
	.comment.root { padding:1rem; border-bottom:6px solid var(--color-bg-primary); }
	.comment.root:last-child { border-bottom:0; }
	p { margin-top:.4rem; font-size:.82rem; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }
	.replies { margin-top:.65rem; margin-left:.2rem; padding-left:.8rem; border-left:2px solid var(--color-border-subtle); }
	.replies.flat { margin-left:0; padding-left:0; border-left:0; }
	@media(max-width:420px) { .comment.root { padding:.85rem .75rem; } .replies { margin-left:.1rem; padding-left:.6rem; } }
</style>
