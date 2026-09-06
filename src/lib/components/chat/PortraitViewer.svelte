<script lang="ts">
	/**
	 * The portrait a reader opened by clicking a message avatar: a card in the bottom-left,
	 * floating above everything in that corner including the sprite (`SpriteLayer`).
	 *
	 * Every avatar opens it, the character's own included. The sprite in the same corner is
	 * ambient and the click is deliberate, so the reader gets what they asked for; closing the
	 * card hands the corner back.
	 */
	import { portraitViewerStore } from '$lib/stores/portraitViewer.svelte';
	import { imageService } from '$lib/services/imageService';
	import { focusTrap } from '$lib/actions/focusTrap';
	import Icon from '$lib/components/ui/Icon.svelte';

	/** The shape a portrait usually is, held for the frame before the file reports its own. */
	const FALLBACK_ASPECT = 3 / 4;

	const name = $derived(portraitViewerStore.name);
	const url = $derived(imageService.imageUrl(portraitViewerStore.imagePath ?? undefined));

	/**
	 * The picture's own width-to-height ratio, read off the loaded image and **stamped with
	 * the picture it was read from**, so a ratio never outlives its portrait.
	 *
	 * It is the one fact CSS cannot get from an `<img>`, and the card needs it: the card has a
	 * surface of its own, so it has to be exactly the size of the picture it holds. Given the
	 * ratio it can be told to stand `--picture-height` tall and no wider than the bay, with
	 * the shorter of the two deciding, which is the sprite layer's `contain` written as a box.
	 * Without it the card either freezes at one height and letterboxes everything that is not
	 * the shape it expected, or hugs the picture and hands its size to whatever resolution the
	 * file happens to be.
	 */
	let measured = $state<{ url: string; aspect: number } | null>(null);
	const aspect = $derived(measured?.url === url ? measured.aspect : FALLBACK_ASPECT);

	function measure(event: Event) {
		const img = event.currentTarget as HTMLImageElement;
		if (url && img.naturalHeight > 0) {
			measured = { url, aspect: img.naturalWidth / img.naturalHeight };
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && portraitViewerStore.imagePath) {
			// Claim the key so the workspace's global Esc leaves open panels alone.
			event.preventDefault();
			portraitViewerStore.close();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if url}
	<!-- The bay: the same box the sprite stands in, so the two pictures share a place on
	     screen instead of each having their own idea of the corner. It spans that whole
	     margin and passes every event through it; only the card itself is clickable. -->
	<div class="portrait-bay">
		<!-- Non-modal floating card: focus lands on the close button when it opens (and is
		     given back on close), but Tab is NOT trapped, so the chat behind stays usable. -->
		<div class="portrait-viewer surface-float fade-in" use:focusTrap={{ trap: false }}>
			<button
				type="button"
				class="portrait-close"
				onclick={() => portraitViewerStore.close()}
				aria-label="Close portrait"
			>
				<Icon name="close" class="w-4 h-4" strokeWidth={2} />
			</button>
			<img
				src={url}
				alt={name ?? 'Portrait'}
				class="portrait-image"
				style="width: min(var(--picture-room), calc(var(--picture-height) * {aspect}))"
				onload={measure}
			/>
			{#if name}
				<div class="portrait-name">{name}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.portrait-bay {
		position: fixed;
		left: 0;
		bottom: 0;
		/* Below the docked side panels and the chat-area
		   overlays, but above the chat column and the sprite layer (14): panels always
		   win, and a portrait the reader opened wins its corner. */
		z-index: 15;
		width: var(--picture-bay);
		/* Side room so a card at full width does not touch the screen edge, and what is
		   left of the bay once it is taken. The width is a length rather than a percentage
		   because the card shrink-wraps its picture, so a picture sized against the card
		   would be sizing itself against its own result. */
		--picture-inset: 0.75rem;
		--picture-room: calc(var(--picture-bay) - var(--picture-inset) * 2);
		display: flex;
		justify-content: center;
		/* The bottom inset is what keeps this a card floating in the margin rather than
		   the sprite's figure standing on the floor. */
		padding: 0 var(--picture-inset) clamp(0.75rem, 0.5rem + 1vw, 1.5rem);
		/* Mostly empty margin, and the chat forwards the wheel from there: the box must
		   not become the event target. The card takes its own events back. */
		pointer-events: none;
	}

	.portrait-viewer {
		position: relative;
		pointer-events: auto;
		border-radius: var(--radius-xl);
		overflow: hidden;
		box-shadow: var(--shadow-lg);
	}

	/* Height leads and width follows, so the card's presence is the picture's shape rather
	   than its pixel count: the inline width is the width that height implies, clamped to
	   the bay, and `height: auto` takes the height back down with it. */
	.portrait-image {
		display: block;
		height: auto;
		background: var(--color-bg-secondary);
	}

	.portrait-close {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
		background: color-mix(in srgb, var(--color-bg-primary) 78%, transparent);
		color: var(--color-text-secondary);
		cursor: pointer;
		backdrop-filter: blur(6px);
		transition: color 120ms ease, background-color 120ms ease;
	}

	.portrait-close:hover {
		color: var(--color-text-primary);
		background: var(--color-bg-tertiary);
	}

	.portrait-name {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 1.5rem 0.9rem 0.6rem;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 650;
		color: #fff;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.72), transparent);
		pointer-events: none;
	}
</style>
