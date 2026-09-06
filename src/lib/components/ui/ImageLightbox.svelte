<script lang="ts">
	/**
	 * The app's one full-screen image viewer: view at full size, page through the set,
	 * download the original, close with Escape / backdrop click. Portalled to <body>
	 * like Dialog so backdrop-filter stacking contexts can't clip it.
	 *
	 * It pages a SET and never decides what that set is. The surface that opens it does,
	 * because each one has exactly one set it can name: a chat message's attachments,
	 * a library entry's gallery, or one logged request's images. A viewer that chose
	 * its own scope would be guessing at the screen behind it.
	 */
	import { fade, scale } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import { focusTrap } from '$lib/actions/focusTrap';
	import { fileUrl } from '$lib/services/transport';

	interface Props {
		/** Server-relative image paths (images/<category>/<file>), in the order the surface
		 *  shows them, so "next" always means "the next one further down the screen". */
		images: string[];
		/** Position in `images`; null closes the viewer, as does a position the set no longer has.
		 *  The open/closed condition lives HERE, never in an `{#if}` around this component:
		 *  the portal below moves its own node out of Svelte's tree, so the effect that
		 *  moves it has to re-run on every open. Bound to the component's lifetime instead,
		 *  it runs once, and after its cleanup the node is orphaned: the viewer then looks
		 *  open to the caller while rendering nothing, permanently. */
		index: number | null;
		alt?: string;
		/** Optional word the counter leads with. Bare "3 / 7" without it. */
		countLabel?: string;
		onClose: () => void;
	}

	let { images, index = $bindable(), alt = 'Image', countLabel, onClose }: Props = $props();

	let portalEl: HTMLDivElement | null = $state(null);
	let path = $derived(index === null ? null : (images[index] ?? null));
	/** Read by the portal effect INSTEAD of `index`: stepping must not detach and re-append
	 *  the node, which would replay the open transition and drop focus on every arrow press. */
	let open = $derived(path !== null);
	let src = $derived(path ? fileUrl(path) : '');
	let filename = $derived(path ? path.slice(path.lastIndexOf('/') + 1) : '');
	let pageable = $derived(images.length > 1);

	// The cleanup holds its own reference because `bind:this` is nulled on unmount, which
	// would skip the removal and strand the node in <body>.
	$effect(() => {
		const el = portalEl;
		if (!open || !el) return;
		document.body.appendChild(el);
		return () => {
			if (el.parentNode === document.body) document.body.removeChild(el);
		};
	});

	/** Wraps, so the set has no dead end to press against at either edge. */
	function step(delta: number) {
		if (index === null || !pageable) return;
		index = (index + delta + images.length) % images.length;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			// preventDefault also tells the workspace's global Esc to stand down.
			e.preventDefault();
			e.stopPropagation();
			onClose();
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			step(e.key === 'ArrowLeft' ? -1 : 1);
		}
	}

	// ---- Swipe ----
	// Touch and pen only: a mouse has the arrow keys and the buttons, and a phone is the
	// one place where paging by hand is the obvious gesture rather than a hidden one. The
	// buttons stay on screen regardless, because a horizontal drag near a phone's edge is
	// the system's own back gesture and this must not be the only way through the set.
	const SWIPE_MIN = 48;
	let swipe: { id: number; x: number; y: number } | null = null;

	function onSwipeDown(e: PointerEvent) {
		if (e.pointerType === 'mouse') return;
		// A second finger is a pinch, not a page: drop the gesture rather than page on release.
		if (!e.isPrimary) {
			swipe = null;
			return;
		}
		if (!pageable) return;
		swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onSwipeUp(e: PointerEvent) {
		if (!swipe || e.pointerId !== swipe.id) return;
		const dx = e.clientX - swipe.x;
		const dy = e.clientY - swipe.y;
		swipe = null;
		if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function handleBackdropKeydown(e: KeyboardEvent) {
		// Keyboard equivalent of the backdrop click (Escape is handled window-wide).
		if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
<div bind:this={portalEl}>
	<div
		class="lightbox"
		role="dialog"
		aria-modal="true"
		aria-label={alt}
		tabindex="-1"
		use:focusTrap
		onclick={handleBackdropClick}
		onkeydown={handleBackdropKeydown}
		transition:fade={{ duration: 160 }}
	>
		<div class="lightbox-toolbar">
			<span class="lightbox-name" title={filename}>{filename}</span>
			<div class="lightbox-actions">
				<a class="lightbox-btn" href={src} download={filename} title="Download" aria-label="Download image">
					<Icon name="download" class="w-5 h-5" strokeWidth={1.8} />
				</a>
				<a class="lightbox-btn" href={src} target="_blank" rel="noopener" title="Open original in a new tab" aria-label="Open original in a new tab">
					<Icon name="maximize" class="w-5 h-5" strokeWidth={1.8} />
				</a>
				<button type="button" class="lightbox-btn" onclick={onClose} title="Close" aria-label="Close viewer">
					<Icon name="close" class="w-5 h-5" strokeWidth={1.8} />
				</button>
			</div>
		</div>
		<img
			class="lightbox-image"
			{src}
			{alt}
			onpointerdown={onSwipeDown}
			onpointerup={onSwipeUp}
			onpointercancel={() => (swipe = null)}
			transition:scale={{ duration: 180, start: 0.96 }}
		/>
		{#if pageable}
			<button
				type="button"
				class="lightbox-btn lightbox-nav lightbox-nav--prev"
				onclick={() => step(-1)}
				title="Previous image"
				aria-label="Previous image"
			>
				<Icon name="chevronLeft" class="w-6 h-6" strokeWidth={1.8} />
			</button>
			<button
				type="button"
				class="lightbox-btn lightbox-nav lightbox-nav--next"
				onclick={() => step(1)}
				title="Next image"
				aria-label="Next image"
			>
				<Icon name="chevronRight" class="w-6 h-6" strokeWidth={1.8} />
			</button>
			<span class="lightbox-count">{countLabel ? `${countLabel} ` : ''}{(index ?? 0) + 1} / {images.length}</span>
		{/if}
	</div>
</div>
{/if}

<style>
	.lightbox {
		position: fixed;
		inset: 0;
		/* Shares Dialog's z-[300] layer so it stays above workspace panels and popovers. */
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 3.4rem 1rem 1.4rem;
		background: color-mix(in srgb, black 78%, transparent);
		backdrop-filter: var(--backdrop-blur);
	}

	.lightbox-toolbar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.6rem 0.8rem;
		background: linear-gradient(to bottom, color-mix(in srgb, black 55%, transparent), transparent);
	}

	.lightbox-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.76rem;
		color: rgb(255 255 255 / 0.75);
	}

	.lightbox-actions {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	.lightbox-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.1rem;
		height: 2.1rem;
		border: none;
		border-radius: var(--radius-md);
		background: rgb(255 255 255 / 0.09);
		color: rgb(255 255 255 / 0.88);
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.lightbox-btn:hover {
		background: rgb(255 255 255 / 0.2);
		color: white;
	}

	/* Always on screen, never hover-revealed: a touch screen has no hover, and these are
	   the guaranteed way through the set where a swipe can be eaten by the system. */
	.lightbox-nav {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		width: 2.6rem;
		height: 2.6rem;
		background: rgb(0 0 0 / 0.5);
	}

	.lightbox-nav--prev {
		left: 0.8rem;
	}

	.lightbox-nav--next {
		right: 0.8rem;
	}

	.lightbox-count {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.2rem 0.6rem;
		border-radius: var(--radius-full);
		background: rgb(0 0 0 / 0.5);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: rgb(255 255 255 / 0.8);
	}

	.lightbox-image {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: var(--radius-md);
		box-shadow: 0 12px 48px rgb(0 0 0 / 0.55);
		/* Hands us the horizontal drag while the browser keeps pinch zoom. */
		touch-action: pan-y pinch-zoom;
	}
</style>
