<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import InfoTip from '$lib/components/ui/InfoTip.svelte';
	import { llmService } from '$lib/services/llm/provider';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { formatDuration, formatMessageTime, relativeClock } from '$lib/utils/time-format.svelte';
	import { lorebookWasInjected, type LorebookTrace } from '$lib/lorebook/types';
	import type { ProviderName } from '$lib/types/llm';

	interface Props {
		name: string;
		isUser?: boolean;
		timestamp: number | null;
		model?: string | null;
		provider?: string | null;
		edited?: boolean;
		streaming?: boolean;
		/** Preformatted token count, shown directly in the metadata row. */
		tokens?: string | null;
		/** Turn folded into chat memory: shows the "In memory" pill at the line's end. */
		archived?: boolean;
		/** Transcript position, ONLY when there is no portrait column to carry it.
		 *  The caller decides (Message.svelte's `avatarsHidden`). */
		ordinal?: number | null;
		/** Generation duration, on the same "no portrait to carry it" terms. */
		durationMs?: number | null;
		/** This turn's lorebook scan: the pill's readout and the door to the whole trace. Null
		 *  for every turn no book was consulted for, which is what keeps the pill off the
		 *  transcript of anyone not using lorebooks. The caller decides (Message.svelte). */
		lorebook?: LorebookTrace | null;
		onLorebook?: () => void;
	}

	let {
		name,
		isUser = false,
		timestamp,
		model = null,
		provider = null,
		edited = false,
		streaming = false,
		tokens = null,
		archived = false,
		ordinal = null,
		durationMs = null,
		lorebook = null,
		onLorebook
	}: Props = $props();

	const loreCount = $derived(lorebook ? lorebook.records.filter((r) => lorebookWasInjected(r.status)).length : 0);

	// Timestamp SHAPE is presentation config, not per-message data, so it is read
	// here rather than drilled through every caller. Visibility stays a prop: the
	// caller passes null, which skips the formatting entirely.
	const appearance = $derived(themeStore.appearance);
	const formattedDate = $derived(
		timestamp != null
			? formatMessageTime(
					timestamp,
					appearance.timestampFormat,
					appearance.clockFormat,
					// Only a relative label depends on the shared tick; reading it under
					// the same guard keeps absolute rows out of the 30s re-render.
					appearance.timestampFormat === 'relative' ? relativeClock.now : 0
				)
			: null
	);
	const durationLabel = $derived(durationMs != null ? formatDuration(durationMs) : null);

	const providerLabel = $derived(
		provider
			? llmService.getProviderMeta(provider as ProviderName)?.displayName ?? provider
			: null
	);
	// Provider/model exist on assistant turns only. Keep them behind the shared
	// hover-or-tap explanation while the useful token count remains visible.
	const generationTitle = $derived(
		provider || model
			? `${providerLabel ?? 'unknown provider'}${model ? ` · ${model}` : ''}`
			: null
	);

	// Turn enough off and the row has nothing left to say, so render nothing at all
	// rather than a bare strip of padding above the prose.
	const hasContent = $derived(
		appearance.showSpeakerName ||
			formattedDate !== null ||
			generationTitle !== null ||
			tokens !== null ||
			durationLabel !== null ||
			ordinal !== null ||
			edited ||
			archived ||
			lorebook !== null ||
			streaming
	);
</script>

{#if hasContent}
<div class="message-meta {isUser ? 'message-meta-user' : ''}">
	{#if appearance.showSpeakerName}
		<span class="message-role {isUser ? 'message-role-user' : ''}">{name}</span>
	{/if}

	<!-- Both of these normally live under the portrait; they fall back to this row
	     when there is no portrait column (see Message.svelte). -->
	{#if ordinal !== null}
		<span class="message-ordinal">#{ordinal}</span>
	{/if}

	{#if formattedDate}
		<span class="message-date">{formattedDate}</span>
	{/if}

	{#if durationLabel}
		<span class="message-date" title="Generation time">{durationLabel}</span>
	{/if}

	{#if tokens}
		<span class="message-generation message-generation-count">{tokens}</span>
	{/if}

	{#if generationTitle}
		<InfoTip text={generationTitle} />
	{/if}

	{#if edited}
		<span class="message-edited">Edited</span>
	{/if}

	{#if archived}
		<span class="message-ghost-tag" title="This turn has been folded into chat memory: it's recalled as memory, not re-sent verbatim.">
			<Icon name="brain" class="w-3 h-3" />
			<span>In memory</span>
		</span>
	{/if}

	{#if lorebook && onLorebook}
		<button
			type="button"
			class="message-lore-tag"
			onclick={onLorebook}
			title="Which lorebook entries this turn was built with"
		>
			<Icon name="bookOpen" class="w-3 h-3" />
			<span>{loreCount}</span>
		</button>
	{/if}

	{#if streaming}
		<span class="message-dots" aria-label="Generating response">
			<span class="message-dot"></span>
			<span class="message-dot" style="animation-delay: 120ms"></span>
			<span class="message-dot" style="animation-delay: 240ms"></span>
		</span>
	{/if}
</div>
{/if}

<style>
	.message-meta {
		display: flex;
		/* Narrow columns (phone, Portraits style) can't always fit name + date +
		   pills on one line; let the tail spill to a second line instead of
		   overflowing the card. */
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.5rem;
		/* Outer padding follows the card's padding setting; the 0.18rem below is
		   rhythm against the content under it, not padding, so it stays fixed. */
		padding: var(--msg-pad-top, 0.72rem) var(--msg-pad-x, 0.98rem) 0.18rem;
		font-family: var(--font-ui);
	}

	.message-meta-user {
		flex-direction: row-reverse;
		justify-content: flex-start;
	}

	.message-role {
		display: inline-flex;
		align-items: center;
		height: 1.36rem;
		padding: 0 0.58rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
		background: color-mix(in srgb, var(--color-bg-secondary) 65%, transparent);
		color: var(--color-text-secondary);
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.02em;
	}

	.message-role-user {
		color: color-mix(in srgb, var(--color-accent) 82%, var(--color-text-primary) 18%);
		border-color: color-mix(in srgb, var(--color-accent) 28%, var(--color-border) 72%);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}

	.message-date {
		font-size: 0.68rem;
		color: var(--color-text-muted);
		letter-spacing: 0.01em;
		white-space: nowrap;
	}

	/* The portrait's #N badge, relocated here when portraits are off. */
	.message-ordinal {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.message-generation {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		opacity: 0.7;
		cursor: help;
		transition: opacity 120ms ease, color 120ms ease;
	}

	.message-generation:hover {
		opacity: 1;
		color: var(--color-text-secondary);
	}

	.message-generation-count {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.message-edited {
		font-size: 0.68rem;
		color: var(--color-text-muted);
		letter-spacing: 0.02em;
	}

	.message-ghost-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.12rem 0.5rem;
		border-radius: var(--radius-full);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		white-space: nowrap;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 26%, transparent);
	}

	/* Quieter than the memory pill on purpose: that one states a fact about the story, this
	   one opens a debug reading. It wakes up on hover like any other control. */
	.message-lore-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.26rem;
		padding: 0.1rem 0.42rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border-subtle);
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.66rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		line-height: 1.4;
		cursor: pointer;
		transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
	}

	.message-lore-tag:hover {
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 32%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.message-dots {
		display: inline-flex;
		align-items: center;
		gap: 0.26rem;
	}

	.message-dot {
		width: 0.36rem;
		height: 0.36rem;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-accent) 86%, white 14%);
		opacity: 0.92;
		animation: messageDotPulse 900ms ease-in-out infinite;
	}

	@keyframes messageDotPulse {
		0%,
		100% {
			transform: translateY(0) scale(0.95);
			opacity: 0.45;
		}

		50% {
			transform: translateY(-1px) scale(1.08);
			opacity: 1;
		}
	}

	@media (max-width: 900px) {
		.message-meta {
			padding-inline: min(0.86rem, var(--msg-pad-x, 0.98rem));
		}
	}

	/* Name style (Settings → Chat → Speaker & Controls). Chrome and casing are
	   two INDEPENDENT attributes, so all four combinations are reachable: a pill in
	   small caps is a real thing people want, and folding casing into the chrome enum
	   made it unreachable. Deliberately placed BEFORE the manuscript block: those
	   selectors carry the same specificity, so source order lets Manuscript keep its
	   own label, since a pill would contradict a style that draws no chrome at all. */
	:global([data-speaker-label='plain']) .message-role {
		height: auto;
		padding: 0;
		border: 0;
		background: transparent;
	}

	:global([data-speaker-label='plain']) .message-role-user {
		color: color-mix(in srgb, var(--color-accent) 78%, var(--color-text-muted) 22%);
	}

	:global([data-speaker-caps='on']) .message-role {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}

	/* Letter-spacing trails after the last glyph, which reads as a lopsided chip;
	   give the pill's right edge the same slack back. */
	:global([data-speaker-label='pill'][data-speaker-caps='on']) .message-role {
		padding-right: calc(0.58rem + 0.13em);
	}

	/* Chat style: Flat. Bubbles' header, with the user's row un-mirrored so both
	   speakers read left-to-right. */
	:global([data-chat-style='flat']) .message-meta-user {
		flex-direction: row;
		justify-content: flex-start;
	}

	/* Chat style: Portraits. Same header as Bubbles (pill and all), just
	   left-aligned for both roles and no divider. */
	:global([data-chat-style='portrait']) .message-meta {
		flex-direction: row;
		justify-content: flex-start;
	}

	/* Chat style: Manuscript. Speaker as a quiet small-caps label over the prose. */
	:global([data-chat-style='manuscript']) .message-meta {
		flex-direction: row;
		justify-content: flex-start;
		padding: 0.15rem 0.2rem 0;
	}

	:global([data-chat-style='manuscript']) .message-role {
		height: auto;
		padding: 0;
		border: 0;
		background: transparent;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	:global([data-chat-style='manuscript']) .message-role::before {
		display: none;
	}

	:global([data-chat-style='manuscript']) .message-role-user {
		color: color-mix(in srgb, var(--color-accent) 75%, var(--color-text-muted) 25%);
	}
</style>
