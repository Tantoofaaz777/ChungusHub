<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { promptTokensStore as tokens } from '#lib/stores/promptTokens.svelte.ts';

	let buckets = $derived([
		{ label: 'Preset', value: tokens.preset, color: 'var(--color-accent)', title: 'System instructions & format from your preset' },
		{ label: 'Context', value: tokens.context, color: '#fb923c', title: 'Persona, characters, lorebook, steering & preset controls' },
		{ label: 'Memory', value: tokens.memory, color: '#a78bfa', title: 'Chat memory: the chapters in play on this branch' },
		{ label: 'Chat', value: tokens.chatTokens, color: '#10b981', title: 'Conversation history included in the prompt' }
	]);
</script>

<section class="tokens panel-scroll" aria-labelledby="prompt-tokens-title">
	<div class="heading">
		<h2 id="prompt-tokens-title">Prompt Tokens</h2>
		{#if chatStore.activeChat}
			<div class="totals">
				<span>Total context <strong>{tokens.loading ? '…' : `~${tokens.total.toLocaleString()}`}</strong></span>
				<span>+ your message <strong>{tokens.input?.toLocaleString() ?? '…'}</strong></span>
			</div>
		{/if}
	</div>
	{#if chatStore.activeChat}
		<div class="bar" aria-hidden="true">
			{#each buckets as bucket (bucket.label)}
				<div style:background={bucket.color} style:width={`${tokens.total ? bucket.value / tokens.total * 100 : 0}%`}></div>
			{/each}
		</div>
		<div class="buckets">
			{#each buckets as bucket (bucket.label)}
				<div class="bucket" title={bucket.title}>
					<span class="dot" style:background={bucket.color}></span>
					<span>{bucket.label}</span>
					<strong>{tokens.loading ? '…' : bucket.value.toLocaleString()}</strong>
				</div>
			{/each}
		</div>
		{#if tokens.trimmedMessages > 0}
			<p class="warning" role="status"><Icon name="warning" class="w-3.5 h-3.5 shrink-0" />{tokens.trimmedMessages} older {tokens.trimmedMessages === 1 ? 'message' : 'messages'} trimmed to fit the context size</p>
		{/if}
		{#if tokens.overBudget}
			<p class="warning over" role="status"><Icon name="warning" class="w-3.5 h-3.5 shrink-0" />Prompt exceeds the context size even with all history trimmed</p>
		{/if}
		<p class="foot">{#if tokens.model}Estimated for <b>{tokens.model}</b>, auto-calibrated from real usage.{:else}Estimate: calibrates from real usage.{/if}</p>
	{:else}
		<p class="empty">Open a chat to see its prompt token breakdown.</p>
	{/if}
</section>

<style>
	.tokens { flex: 0 1 auto; min-height: 0; max-height: 45%; padding: .8rem; border-bottom: 1px solid var(--color-border-subtle); font-family: var(--font-ui); }
	.heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: .4rem 1rem; margin-bottom: .6rem; }
	h2 { margin: 0; color: var(--color-text-primary); font-size: .84rem; font-weight: 600; }
	.totals { display: flex; flex-wrap: wrap; gap: .3rem .9rem; color: var(--color-text-muted); font-size: .7rem; }
	strong { color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
	.totals strong { margin-left: .3rem; }
	.bar { display: flex; height: .4rem; overflow: hidden; border-radius: 999px; background: var(--color-bg-tertiary); margin-bottom: .65rem; }
	.buckets { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem 1rem; }
	.bucket { display: flex; align-items: center; gap: .35rem; color: var(--color-text-secondary); font-size: .72rem; }
	.bucket strong { margin-left: auto; }
	.dot { width: .5rem; height: .5rem; border-radius: 2px; flex-shrink: 0; }
	.foot, .empty { margin: .55rem 0 0; color: var(--color-text-muted); font-size: .65rem; line-height: 1.4; overflow-wrap: anywhere; }
	.empty { font-size: .76rem; }
	.warning { display: flex; align-items: center; gap: .4rem; margin: .6rem 0 0; padding: .4rem .5rem; border-radius: var(--radius-md); color: var(--color-warning); background: color-mix(in srgb, var(--color-warning) 12%, transparent); font-size: .7rem; }
	.over { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 12%, transparent); }
	@media (max-width: 640px) { .buckets { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
