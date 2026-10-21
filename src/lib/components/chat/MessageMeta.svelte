<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import GenerationDots from '$lib/components/ui/GenerationDots.svelte';
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
	const stacked = $derived(appearance.chatStyle === 'manuscript' && appearance.showAvatars);
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
			archived ||
			lorebook !== null ||
			streaming
	);
</script>

{#if hasContent}
<div class="message-meta {isUser ? 'message-meta-user' : ''}" class:message-meta-stacked={stacked}>
	{#if appearance.showSpeakerName}
		<span class="message-role {isUser ? 'message-role-user' : ''}">{name}</span>
	{/if}

	<div class="message-details">
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
				<span class="message-lore-count">{loreCount}</span>
			</button>
		{/if}

		{#if streaming}
			<GenerationDots />
		{/if}
	</div>
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

	/* Speaker names are always plain and set in small caps. */
	.message-role {
		display: inline-flex;
		align-items: center;
		height: auto;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.13em;
		text-transform: uppercase;
	}

	.message-role-user {
		color: color-mix(in srgb, var(--color-accent) 78%, var(--color-text-muted) 22%);
	}

	.message-date,
	.message-ordinal {
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

	/* One type treatment for all numeric message details. Lining digits keep scan
	   counts such as 9 on the same baseline as the other readouts. */
	.message-date,
	.message-ordinal,
	.message-generation-count,
	.message-lore-count {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		font-variant-numeric: lining-nums tabular-nums;
		white-space: nowrap;
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
		font-family: var(--font-ui);
		line-height: 1;
		cursor: pointer;
		transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
	}

	.message-lore-count {
		display: block;
		line-height: 1;
	}

	.message-lore-tag:hover {
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 32%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}


	@media (max-width: 900px) {
		.message-meta {
			padding-inline: min(0.86rem, var(--msg-pad-x, 0.98rem));
		}
	}

	/* Chat style: Flat. Bubbles' header, with the user's row un-mirrored so both
	   speakers read left-to-right. */
	:global([data-chat-style='flat']) .message-meta-user {
		flex-direction: row;
		justify-content: flex-start;
	}

	/* Chat style: Portraits. Same plain header as Bubbles, just
	   left-aligned for both roles and no divider. */
	:global([data-chat-style='portrait']) .message-meta {
		flex-direction: row;
		justify-content: flex-start;
	}

	/* Chat style: Manuscript. Speaker as a quiet small-caps label over the prose. */
	:global([data-chat-style='manuscript']) .message-meta {
		flex-direction: row;
		justify-content: flex-start;
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
	/* Without portraits this wrapper has no layout box: the original inline row stays intact. */
	.message-details {
		display: contents;
	}

	/* Compact manuscript header: diagnostics on top, speaker name beneath, both left-aligned. */
	:global([data-chat-style='manuscript']) .message-meta-stacked {
		flex: 1;
		min-width: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		padding: 0;
	}

	.message-meta-stacked .message-details {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		max-width: 100%;
	}

	.message-meta-stacked .message-details:empty {
		display: none;
	}

	:global([data-chat-style='manuscript']) .message-meta-stacked .message-role {
		order: 1;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

</style>
