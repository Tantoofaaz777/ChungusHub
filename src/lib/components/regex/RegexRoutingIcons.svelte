<!--
  Where a rule reaches, as a row of glyphs: whose messages it touches, which surface it
  rewrites, and (only when it is bounded) that it does not reach the whole story. Every
  list of rules shows the same cluster so the same rule reads identically on the Regex page
  and inside a preset.

  The clock is the one that earns its place by being conditional: a rule that quietly skips
  the turns you are looking at would otherwise be indistinguishable from one that runs on
  all of them, and the difference is only visible in its editor.

  Only ever rendered for a rule that reaches something. The host shows an inert badge
  instead, rather than an empty cluster whose tooltip has blank halves.
-->
<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import { depthSentence, routingSentence, type RegexRule } from '#lib/utils/regex-rules.ts';

	let { rule }: { rule: Pick<RegexRule, 'targets' | 'scopes' | 'minDepth' | 'maxDepth'> } = $props();

	let bounded = $derived(depthSentence(rule) !== null);
</script>

<span class="rx-routing" title={routingSentence(rule)}>
	{#if rule.targets.includes('user')}<Icon name="user" class="w-3 h-3" />{/if}
	{#if rule.targets.includes('assistant')}<Icon name="sparkles" class="w-3 h-3" />{/if}
	<span class="rx-routing-sep"></span>
	{#if rule.scopes.includes('display')}<Icon name="eye" class="w-3 h-3" />{/if}
	{#if rule.scopes.includes('prompt')}<Icon name="upload" class="w-3 h-3" />{/if}
	{#if bounded}
		<span class="rx-routing-sep"></span>
		<Icon name="clock" class="w-3 h-3" />
	{/if}
</span>

<style>
	.rx-routing {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		color: var(--color-text-muted);
		transition: opacity 140ms ease;
	}

	.rx-routing-sep {
		width: 1px;
		height: 0.7rem;
		background: var(--color-border-subtle);
		margin: 0 0.12rem;
	}
</style>
