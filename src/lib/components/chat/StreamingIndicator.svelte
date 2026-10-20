<script lang="ts">
	import { renderMarkdown } from '$lib/utils/markdown';
	import { renderedHtml } from '$lib/actions/renderedHtml';
	import { regexRulesStore } from '$lib/stores/regex-rules.svelte';
	import { liveTokenCount } from '$lib/utils/live-token-count.svelte';
	import { liveGenerationTime } from '$lib/utils/live-generation-time.svelte';
	import MessageReasoning from './MessageReasoning.svelte';
	import MessageAvatar from './MessageAvatar.svelte';
	import MessageMeta from './MessageMeta.svelte';
	import MessageHeader from './MessageHeader.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { openChatSetup } from '$lib/stores/openChatSetup.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { storyRoleName } from '$lib/types/library';

	interface Props {
		content: string;
		thinking?: string;
	}

	let { content, thinking = '' }: Props = $props();

	const mountedAt = Date.now();
	const startedAt = $derived(chatStore.stream?.startedAt ?? mountedAt);
	const speaker = $derived.by(() => {
		const cid = chatStore.activeChat?.characterId;
		if (!cid) return null;
		const entry = characterLibraryStore.entries.find((e) => e.id === cid);
		return entry
			? {
					name: storyRoleName(entry.identity),
					imageUrl: entry.identity.imageUrl ?? null,
					portraitFocus: entry.identity.portraitFocus
				}
			: null;
	});
	const speakerName = $derived(speaker?.name?.trim() || 'Assistant');
	const speakerImagePath = $derived(speaker?.imageUrl ?? null);
	const speakerFocus = $derived(speaker?.portraitFocus);

	// Display-scope regex runs live over the partial text, same as the saved turn will. This
	// bubble IS the newest turn, so depth 0, and the turn it settles into is handed the same
	// 0 by MessageList, which is what keeps a depth-bounded rule from changing its mind at
	// the moment a reply lands.
	// Resolved on its own line: `displayContent` recomputes per streamed token, and resolving
	// a preset parses the chat's feature-state blob.
	const displayPreset = $derived(openChatSetup.preset);
	let displayContent = $derived(regexRulesStore.forDisplay(content, 'assistant', 0, displayPreset));
	let bodyHtml = $derived(renderMarkdown(displayContent));
	// Counts the raw stream, not the display transform: it estimates what the model emits.
	const estimate = liveTokenCount({ text: () => content,
		enabled: () => themeStore.appearance.showTokenCount, streaming: () => true,
		identity: () => chatStore.stream });
	let streamingTokens = $derived(estimate.value);
	// Same rule as Message.svelte: MessageReasoning is a pure renderer, so the caller
	// decides whether there is anything to show.
	const hasReasoning = $derived(Boolean(thinking.trim()));
	// Portraits style renders the portrait inside the card (see Message.svelte).
	const isPortraitStyle = $derived(themeStore.appearance.chatStyle === 'portrait');
	// Same rule as Message.svelte: with no portrait column the live timer falls back
	// into the meta row instead of disappearing.
	const isManuscript = $derived(themeStore.appearance.chatStyle === 'manuscript');
	const avatarsHidden = $derived(!themeStore.appearance.showAvatars);
	const metaReadouts = $derived(avatarsHidden || isManuscript);

	// Fresh replies and replacements use the same request clock, including after remount.
	const showGenerationTime = $derived(themeStore.appearance.showGenerationTime);
	const generationTimer = liveGenerationTime({
		startedAt: () => startedAt,
		enabled: () => showGenerationTime
	});
</script>

<div class="stream-row fade-in">
	<div class="stream-main">
		{#if !isPortraitStyle && !isManuscript && !avatarsHidden}
			<MessageAvatar
				role="assistant"
				name={speakerName}
				imagePath={speakerImagePath}
				focus={speakerFocus}
				durationMs={generationTimer.value}
			/>
		{/if}

		<div class="stream-body">
			<div class="stream-bubble-shell">
				<div class="stream-bubble">
					{#if isPortraitStyle && !avatarsHidden}
						<div class="stream-portrait">
							<MessageAvatar
								role="assistant"
								name={speakerName}
								imagePath={speakerImagePath}
								durationMs={generationTimer.value}
							/>
						</div>
					{/if}
					<div class="stream-card-col">
						<MessageHeader role="assistant" name={speakerName} imagePath={speakerImagePath} focus={speakerFocus}>
							<MessageMeta
								name={speakerName}
								timestamp={themeStore.appearance.showTimestamps ? startedAt : null}
								tokens={isManuscript && !avatarsHidden && themeStore.appearance.showTokenCount && streamingTokens > 0 ? `~${streamingTokens} tok` : null}
								durationMs={metaReadouts ? generationTimer.value : null}
								streaming={true}
							/>
						</MessageHeader>

						{#if hasReasoning}
							<div class="stream-thinking">
								<MessageReasoning {thinking} isStreaming={true} />
							</div>
						{/if}

						{#if displayContent}
							<div class="stream-content">
								<!-- Patched in place, same as the settled turn: see Message.svelte. -->
								<div class="prose stream-prose" use:renderedHtml={bodyHtml}></div>
							</div>
						{/if}

						<!-- The shared estimator cancels pending counts while this readout is off. -->
						{#if !(isManuscript && !avatarsHidden) && themeStore.appearance.showTokenCount && streamingTokens > 0}
							<div class="stream-tokens-row">
								<span class="stream-tokens" title="Estimated tokens">~{streamingTokens}</span>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	/* Card geometry mirrors Message.svelte's --msg-* vars exactly, since the live turn
	   and the turn it becomes must be indistinguishable (coupling in
	   architecture/chat-sessions.md). */
	.stream-row {
		padding: var(--msg-row-gap, clamp(0.45rem, 0.36rem + 0.42vw, 0.75rem))
			clamp(0.55rem, 0.4rem + 0.5vw, 0.95rem);
	}

	.stream-main {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: clamp(0.5rem, 0.42rem + 0.3vw, 0.78rem);
	}

	.stream-body {
		min-width: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
	}

	.stream-bubble-shell {
		position: relative;
		width: 100%;
	}

	/* The card outline lives on the shell so it paints above the card's own content.
	   See the note in Message.svelte; this is its mirror. */
	.stream-bubble-shell::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		border: var(--msg-border-width, 1px) solid
			var(--msg-border-color, color-mix(in srgb, var(--color-border-subtle) 88%, transparent));
		border-radius: var(--msg-radius, calc(var(--radius-xl) + 0.14rem));
		border-top-left-radius: var(--msg-radius-notch, 0.58rem);
	}

	.stream-bubble {
		position: relative;
		z-index: 1;
		border-radius: var(--msg-radius, calc(var(--radius-xl) + 0.14rem));
		border: var(--msg-border-width, 1px) solid transparent;
		background: var(--color-assistant-bubble);
		background-clip: padding-box;
		box-shadow: var(--msg-shadow, var(--shadow-sm));
		border-top-left-radius: var(--msg-radius-notch, 0.58rem);
		overflow: hidden;
	}

	/* Same rhythm as .message-thinking in Message.svelte: even gaps above and
	   below the diagnostics bar. */
	.stream-thinking {
		padding: 0.35rem var(--msg-pad-x, 0.98rem) 0.3rem;
	}

	.stream-content {
		padding: 0.24rem var(--msg-pad-x, 0.98rem) var(--msg-pad-bottom, 0.95rem);
	}

	.stream-tokens-row {
		padding: 0 var(--msg-pad-x, 0.98rem) 0.7rem;
	}

	.stream-tokens {
		font-size: 0.72rem;
		color: var(--color-text-muted);
		opacity: 0.75;
	}

	.stream-prose {
		font-size: calc(clamp(0.95rem, 0.91rem + 0.16vw, 1.03rem) * var(--user-font-scale, 1));
		line-height: var(--user-line-height, 1.72);
	}

	.stream-prose :global(p) {
		margin: 0 0 var(--user-paragraph-spacing, 1em);
	}

	.stream-prose :global(p:last-child) {
		margin-bottom: 0;
	}

	.stream-prose :global(h1),
	.stream-prose :global(h2),
	.stream-prose :global(h3),
	.stream-prose :global(h4) {
		font-family: var(--font-ui);
		letter-spacing: 0.01em;
		margin-top: 1.15em;
		margin-bottom: 0.55em;
	}

	.stream-prose :global(blockquote) {
		margin: 1.05rem 0;
		padding: 0.2rem 0 0.2rem 0.92rem;
		border-left-width: 2px;
	}

	.stream-prose :global(ul),
	.stream-prose :global(ol) {
		margin: 0.86em 0;
		padding-left: 1.34em;
	}

	.stream-prose :global(li + li) {
		margin-top: 0.26em;
	}

	.stream-prose :global(pre) {
		margin: 1.05em 0;
	}

	/* Before anything arrives the bubble is just the meta row (name, dots, live
	   timer), with no placeholder text by design. Meta's own 0.18rem bottom pad
	   expects content below it, so pad the empty state to a real bottom edge. */
	.stream-card-col > :global(.message-meta:last-child) {
		padding-bottom: var(--msg-pad-top, 0.72rem);
	}

	@media (max-width: 900px) {
		.stream-row {
			padding-inline: 0.45rem;
		}

		.stream-main {
			gap: 0.42rem;
		}

		.stream-content {
			padding-inline: min(0.86rem, var(--msg-pad-x, 0.98rem));
		}
	}

	/* Keep the live-streaming turn in step with the chat styles: same two-column
	   card with a sticky portrait as .message-portrait in Message.svelte. */
	.stream-portrait {
		flex: 0 0 calc(clamp(5rem, 4rem + 3.5vw, 8.75rem) * var(--avatar-scale, 1));
		position: sticky;
		top: 0;
		margin-right: 0.2rem;
		/* Same floor as .message-portrait in Message.svelte. */
		margin-bottom: 1.8rem;
	}

	:global([data-chat-style='portrait']) .stream-bubble-shell::before {
		border-radius: var(--msg-radius-card, var(--radius-lg));
		border-top-left-radius: var(--msg-radius-card, var(--radius-lg));
	}

	/* Same bubble-grade opacity as the portrait cards in Message.svelte; same
	   overflow: visible too, since sticky is inert inside any clipping ancestor. */
	:global([data-chat-style='portrait']) .stream-bubble {
		border-radius: var(--msg-radius-card, var(--radius-lg));
		background: var(--color-assistant-bubble);
		display: flex;
		align-items: flex-start;
		overflow: visible;
	}

	:global([data-chat-style='portrait']) .stream-card-col {
		flex: 1;
		min-width: 0;
	}

	/* Same full-width card and shared appearance settings as a settled manuscript turn. */
	:global([data-chat-style='manuscript']) .stream-bubble,
	:global([data-chat-style='manuscript']) .stream-bubble-shell::before {
		border-radius: var(--msg-radius-card, var(--radius-lg));
	}
</style>
