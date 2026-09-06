<!--
  InfoTip: the app's one text explanation on hover, a small ⓘ that opens a bubble.

  The bubble is placed by `anchorTo`, which lifts it to <body> and measures which
  side it fits on, so no panel can clip it and no call site has to pick a
  direction. Hover or focus opens it; on touch, where neither exists, a tap pins it
  and an outside tap or Escape (consumed, per the workspace Esc contract) lets go.

  Pass a `trigger` snippet to hang the tip off something other than the ⓘ: a chip,
  a badge. It renders as the content of InfoTip's own button, so pass markup, not a
  button of your own.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import { anchorTo } from '$lib/actions/anchorTo';

	let { text, trigger }: { text: string; trigger?: Snippet } = $props();

	let rootEl = $state<HTMLElement>();
	let hovering = $state(false);
	let pinned = $state(false);
	let open = $derived(hovering || pinned);

	$effect(() => {
		if (!pinned) return;
		const onDown = (e: PointerEvent) => {
			if (rootEl && !rootEl.contains(e.target as Node)) pinned = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				pinned = false;
			}
		};
		document.addEventListener('pointerdown', onDown, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onDown, true);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	class="info-tip"
	bind:this={rootEl}
	onpointerenter={() => (hovering = true)}
	onpointerleave={() => (hovering = false)}
	onfocusin={() => (hovering = true)}
	onfocusout={() => (hovering = false)}
>
	<button
		type="button"
		class="info-trigger"
		aria-label={text}
		aria-expanded={pinned}
		onclick={() => (pinned = !pinned)}
	>
		{#if trigger}
			{@render trigger()}
		{:else}
			<Icon name="info" class="w-3.5 h-3.5" strokeWidth={1.75} />
		{/if}
	</button>
</span>

{#if open}
	<span
		class="info-bubble surface-float"
		use:anchorTo={rootEl}
		out:fade={{ duration: 100 }}
		role="tooltip"
		aria-hidden="true">{text}</span
	>
{/if}

<style>
	.info-tip {
		display: inline-flex;
		vertical-align: middle;
	}

	.info-trigger {
		display: inline-grid;
		place-items: center;
		padding: 0;
		border: 0;
		/* A `trigger` snippet must render exactly as it would outside this button, and
		   the UA's own font shorthand on <button> would hand it a foreign line-height. */
		font: inherit;
		background: transparent;
		color: var(--color-text-muted);
		cursor: help;
		transition: color 120ms ease;
	}

	.info-trigger:hover,
	.info-tip:focus-within .info-trigger {
		color: var(--color-text-secondary);
	}

	/* Position, side and reveal belong to `anchorTo`. This lives at <body> level, so
	   nothing here may assume a positioned ancestor or a place in the panel's stack. */
	.info-bubble {
		width: max-content;
		max-width: min(240px, calc(100vw - 2rem));
		padding: 0.5rem 0.65rem;
		/* Mobile compositors do not always re-blur a portalled surface above an
		   already frosted dialog. Keep the shared glass treatment, but give tips a
		   denser fallback so the UI beneath cannot remain sharp through the copy. */
		background: color-mix(in srgb, var(--color-float-bg) 70%, var(--color-bg-primary) 30%);
		backdrop-filter: var(--backdrop-blur) saturate(160%);
		-webkit-backdrop-filter: var(--backdrop-blur) saturate(160%);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 400;
		line-height: 1.4;
		text-align: left;
		/* pre-line, not normal: a tip can carry prose somebody else wrote (a preset author's
		   help text), and their paragraph breaks are part of it. */
		white-space: pre-line;
		z-index: 1000;
		opacity: 0;
		pointer-events: none;
		transform: translateY(-4px);
		transition: opacity 120ms ease, transform 120ms ease;
	}

	.info-bubble:global([data-placement='above']) {
		transform: translateY(4px);
	}

	.info-bubble:global([data-open]) {
		opacity: 1;
		transform: translateY(0);
	}

	@media (prefers-reduced-motion: reduce) {
		.info-bubble,
		.info-bubble:global([data-placement='above']) {
			transition: opacity 120ms ease;
			transform: none;
		}
	}
</style>
