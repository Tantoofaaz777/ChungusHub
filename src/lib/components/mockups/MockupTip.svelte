<!--
  MockupTip: a hover/focus tooltip that shows a live, animated mockup of what a
  setting actually does, rendered in the app's own visual language, with a short
  caption underneath.

  This is the generic shell. The moving picture itself lives in a sibling
  component under this folder (one file per concept, e.g. MergeRolesMockup) and
  is passed in as children:

      <MockupTip text="what it does in words">
          <MergeRolesMockup />
      </MockupTip>

  By default it renders a small (i) icon as the trigger. Pass a `trigger` snippet
  to make an existing control (a button, a toggle) BE the trigger instead:

      <MockupTip text="...">
          {#snippet trigger()}<button ...>Raw</button>{/snippet}
          <RawExpandedMockup />
      </MockupTip>

  Placement is the shared `anchorTo` action's, the same one behind every InfoTip:
  the popover lives at <body> level in viewport coordinates, so the several
  `overflow: hidden` docks the workspace nests panels in can neither clip it nor
  bury it. It exists only while open, so the mockup's animation costs nothing the
  rest of the time.
-->
<script lang="ts">
	import { panelActivity } from '#lib/components/ui/panelActivity.ts';
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { anchorTo } from '#lib/actions/anchorTo.ts';

	const panelActive = panelActivity();
	let { text, children, trigger }: { text: string; children: Snippet; trigger?: Snippet } = $props();

	let anchorEl = $state<HTMLElement>();
	let open = $state(false);
	$effect(() => { if (!panelActive()) open = false; });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	class="mockup-tip"
	bind:this={anchorEl}
	onpointerenter={() => (open = true)}
	onpointerleave={() => (open = false)}
	onfocusin={() => (open = true)}
	onfocusout={() => (open = false)}
>
	{#if trigger}
		{@render trigger()}
	{:else}
		<button type="button" class="tip-trigger" aria-label={text}>
			<Icon name="info" class="w-3.5 h-3.5" strokeWidth={1.75} />
		</button>
	{/if}
</span>

{#if open && panelActive()}
	<div
		class="tip-pop"
		use:anchorTo={anchorEl}
		out:fade={{ duration: 100 }}
		role="tooltip"
		aria-hidden="true"
	>
		<div class="tip-stage">{@render children()}</div>
		<div class="tip-caption">{text}</div>
	</div>
{/if}

<style>
	.mockup-tip {
		display: inline-flex;
		vertical-align: middle;
	}

	.tip-trigger {
		display: inline-grid;
		place-items: center;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: help;
		transition: color 120ms ease;
	}

	.tip-trigger:hover,
	.mockup-tip:focus-within .tip-trigger {
		color: var(--color-text-secondary);
	}

	/* Position, side and reveal belong to `anchorTo`. Deliberately opaque (not the
	   glass float recipe): an animated demo over bleed-through content is
	   unreadable. */
	.tip-pop {
		width: 340px;
		max-width: min(340px, 92vw);
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.7rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg-solid);
		box-shadow: var(--shadow-md);
		z-index: 1000;
		opacity: 0;
		pointer-events: none;
		transform-origin: top left;
		transform: translateY(-6px) scale(0.97);
		transition:
			opacity 140ms ease,
			transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.tip-pop:global([data-placement='above']) {
		transform-origin: bottom left;
		transform: translateY(6px) scale(0.97);
	}

	.tip-pop:global([data-open]) {
		transform: translateY(0) scale(1);
		opacity: 1;
	}

	.tip-stage {
		display: block;
	}

	.tip-caption {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 400;
		line-height: 1.45;
		color: var(--color-text-secondary);
		text-align: left;
	}

	@media (prefers-reduced-motion: reduce) {
		.tip-pop,
		.tip-pop:global([data-placement='above']) {
			transition: opacity 120ms ease;
			transform: none;
		}
	}
</style>
