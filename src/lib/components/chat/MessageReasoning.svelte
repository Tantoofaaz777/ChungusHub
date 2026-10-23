<script lang="ts">
	import type { ReasoningTiming } from '$lib/types/chat';
	import { liveGenerationTime } from '$lib/utils/live-generation-time.svelte';
	import { reasoningDuration, reasoningLabel } from '$lib/utils/reasoning-time';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { renderMarkdown } from '$lib/utils/markdown';
	import { renderedHtml } from '$lib/actions/renderedHtml';
	import { liveTokenCount } from '$lib/utils/live-token-count.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { generalSettingsStore } from '$lib/stores/general-settings.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';

	interface Props {
		/** The reply's reasoning text. Non-empty: the caller owns the emptiness check. */
		thinking: string;
		isStreaming?: boolean;
		reasoningMs?: number | null;
		timing?: ReasoningTiming | null;
	}

	let { thinking, isStreaming = false, reasoningMs = null, timing = null }: Props = $props();

	// Mount-time value on purpose: the setting seeds the box open/closed, then the
	// toggle belongs to the user (no reactive re-open while streaming).
	// svelte-ignore state_referenced_locally
	let expanded = $state(generalSettingsStore.autoExpandReasoning);
	// The reasoning block's own knob, independent of the message-level token
	// toggle. The shared estimator cancels its pending work while this readout is off.
	let showTokens = $derived(themeStore.appearance.showReasoningTokenCount);
	const estimate = liveTokenCount({ text: () => thinking, enabled: () => showTokens,
		streaming: () => isStreaming, identity: () => chatStore.stream });
	let thinkingTokens = $derived(estimate.value);
	let bodyHtml = $derived(renderMarkdown(thinking));
	const activeThinking = $derived(isStreaming && timing?.active === true);
	const timer = liveGenerationTime({
		startedAt: () => timing?.startedAt ?? null,
		enabled: () => activeThinking
	});
	const duration = $derived(isStreaming && timing
		? (reasoningMs ?? 0) + (activeThinking ? timer.value ?? 0 : reasoningDuration(timing, timing.lastTokenAt))
		: reasoningMs);
	const label = $derived(reasoningLabel(activeThinking, duration));
</script>

<div class="reasoning-wrap">
	<button type="button" onclick={() => (expanded = !expanded)} class="reasoning-toggle" aria-expanded={expanded}>
		<Icon
			name="brain"
			fill="currentColor"
			stroke="#000"
			class="w-4 h-4 text-accent flex-shrink-0 {activeThinking ? 'animate-pulse' : ''}"
		/>
		<span class="reasoning-label">{label}</span>
		{#if showTokens}
			<span class="reasoning-tokens">~{thinkingTokens} tokens</span>
		{/if}
		<Icon
			name="chevronRight"
			class="w-4 h-4 text-text-muted transition-transform duration-200 {expanded ? 'rotate-90' : ''}"
		/>
	</button>

	{#if expanded}
		<div class="reasoning-body">
			<!-- Patched in place, like the story text: this block streams too, and
			     reprinting it on every chunk drops whatever the reader was doing in it. -->
			<div class="reasoning-content prose prose-sm text-text-secondary" use:renderedHtml={bodyHtml}></div>
		</div>
	{/if}
</div>

<style>
	.reasoning-wrap {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-tertiary) 54%, transparent);
		overflow: hidden;
	}

	.reasoning-toggle {
		width: 100%;
		border: 0;
		background: transparent;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.56rem 0.68rem;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.reasoning-toggle:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
	}

	.reasoning-label {
		flex: 1;
		min-width: 0;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 620;
		letter-spacing: 0.02em;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.reasoning-tokens {
		font-family: var(--font-ui);
		font-size: 0.66rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.reasoning-body {
		border-top: 1px solid var(--color-border-subtle);
		padding: 0.62rem;
	}

	.reasoning-content {
		max-height: 16rem;
		overflow: auto;
		font-size: 0.84rem;
		line-height: 1.5;
	}

	.reasoning-content :global(p) {
		margin: 0 0 0.85em;
	}

	.reasoning-content :global(p:last-child) {
		margin-bottom: 0;
	}

	@media (max-width: 900px) {
		.reasoning-label {
			font-size: 0.68rem;
		}
	}
</style>
