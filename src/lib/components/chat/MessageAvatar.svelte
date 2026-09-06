<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { imageService } from '$lib/services/imageService';
	import { portraitViewerStore } from '$lib/stores/portraitViewer.svelte';
	import { formatDuration } from '$lib/utils/time-format.svelte';
	import { portraitFocusStyle, type PortraitFocus } from '$lib/utils/portrait-focus';

	interface Props {
		role: 'user' | 'assistant' | 'system';
		name: string;
		imagePath: string | null;
		/** The speaker's stored framing; undefined leaves the frame on a centred cover. */
		focus?: PortraitFocus;
		/** 1-based transcript position badge (#N) under the portrait; null hides it. */
		ordinal?: number | null;
		/** Generation duration in ms, rendered under the ordinal (live elapsed while
		 *  streaming, the stored value after). Null hides the readout. */
		durationMs?: number | null;
	}

	let { role, name, imagePath, focus, ordinal = null, durationMs = null }: Props = $props();

	/** Every portrait opens the bottom-left card, the character's own included: the sprite in
	 *  that corner is ambient and the click is not, so it draws over the sprite until closed. */
	const clickable = $derived(!!imagePath);

	const durationLabel = $derived(durationMs != null ? formatDuration(durationMs) : null);

	let portraitUrl = $derived(imageService.thumbnailUrl(imagePath ?? undefined));
	const isUser = $derived(role === 'user');

	function handleClick() {
		if (clickable && imagePath) portraitViewerStore.toggle(imagePath, name);
	}
</script>

<div class="avatar-column">
	<button
		type="button"
		class="avatar-frame {isUser ? 'avatar-frame-user' : ''}"
		class:clickable
		onclick={handleClick}
		disabled={!clickable}
		aria-label={clickable ? `View ${name} portrait` : `${name} portrait`}
	>
		{#if portraitUrl}
			<img
				src={portraitUrl}
				alt={`${name} portrait`}
				class="avatar-image"
				style={portraitFocusStyle(focus)}
			/>
		{:else}
			<div class="avatar-fallback">
				<Icon name={role === 'assistant' ? 'sparkles' : 'user'} class="w-5 h-5" strokeWidth={1.8} />
			</div>
		{/if}
	</button>
	{#if ordinal !== null}
		<div class="avatar-ordinal">#{ordinal}</div>
	{/if}
	{#if durationLabel}
		<div class="avatar-duration" title="Generation time">{durationLabel}</div>
	{/if}
</div>

<style>
	/* Width, silhouette and radius all ride Settings → Chat → Portraits.
	   The fallbacks are the shipped defaults, for the frame before the theme store
	   has stamped its vars. */
	.avatar-column {
		width: calc(clamp(3.2rem, 2.8rem + 1.4vw, 4.8rem) * var(--avatar-scale, 1));
		flex: 0 0 calc(clamp(3.2rem, 2.8rem + 1.4vw, 4.8rem) * var(--avatar-scale, 1));
	}

	.avatar-frame {
		width: 100%;
		aspect-ratio: var(--avatar-ratio, 2 / 3);
		border-radius: var(--avatar-radius, calc(var(--radius-xl) - 0.12rem));
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--color-border) 92%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 75%, transparent);
		box-shadow: var(--shadow-sm);
		padding: 0;
		display: block;
	}

	.avatar-frame-user {
		border-color: color-mix(in srgb, var(--color-accent) 32%, var(--color-border) 68%);
	}

	.avatar-frame.clickable {
		cursor: pointer;
		transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
	}

	.avatar-frame.clickable:hover {
		border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border) 45%);
		box-shadow: var(--shadow-md);
	}

	.avatar-frame.clickable:active {
		transform: scale(0.97);
	}

	.avatar-frame:focus-visible {
		outline: 0;
		border-color: color-mix(in srgb, var(--color-accent) 85%, white 15%);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent-muted) 70%, transparent);
	}

	.avatar-image {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.avatar-fallback {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		color: color-mix(in srgb, var(--color-text-muted) 90%, white 10%);
		background:
			radial-gradient(circle at 26% 18%, color-mix(in srgb, var(--color-accent) 13%, transparent), transparent 58%),
			color-mix(in srgb, var(--color-bg-secondary) 90%, transparent);
	}

	.avatar-ordinal {
		margin-top: 0.28rem;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	/* Sits under the ordinal (or alone when numbers are off / while streaming);
	   lighter than #N so the badge stays the anchor of the little stack. */
	.avatar-duration {
		margin-top: 0.14rem;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	/* Phones square every silhouette up to keep rows short, and only the radius follows
	   the shape setting, so a circle stays a circle. */
	@media (max-width: 900px) {
		.avatar-column {
			width: calc(2.5rem * var(--avatar-scale, 1));
			flex-basis: calc(2.5rem * var(--avatar-scale, 1));
		}

		.avatar-frame {
			aspect-ratio: 1 / 1;
			border-radius: var(--avatar-radius-sm, var(--radius-lg));
		}
	}

	/* Chat style: Portraits. The portrait lives inside the message card, flush
	   with its top-left corner. No frame of its own: the right and bottom edges
	   fade into the card instead. The in-card wrapper owns the width. */
	:global([data-chat-style='portrait']) .avatar-column {
		width: 100%;
		flex: none;
	}

	:global([data-chat-style='portrait']) .avatar-frame {
		aspect-ratio: 2 / 3;
		border: 0;
		/* The card does not clip its children (overflow: visible for the sticky
		   portrait), so the frame rounds its own top-left corner to match the card.
		   It must read the SAME var the card does: a fixed radius here leaves a
		   wedge of empty card showing behind the portrait as soon as the Card
		   corners knob moves off the shipped value. */
		border-radius: 0;
		border-top-left-radius: var(--msg-radius-card, var(--radius-lg));
		box-shadow: none;
		background: transparent;
		-webkit-mask-image:
			linear-gradient(to right, #000 68%, transparent 100%),
			linear-gradient(to bottom, #000 68%, transparent 100%);
		-webkit-mask-composite: source-in;
		mask-image:
			linear-gradient(to right, #000 68%, transparent 100%),
			linear-gradient(to bottom, #000 68%, transparent 100%);
		mask-composite: intersect;
	}
</style>
