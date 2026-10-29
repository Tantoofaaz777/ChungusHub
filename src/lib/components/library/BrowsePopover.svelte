<script lang="ts">
	import { menuMotion } from '#lib/components/ui/menu-motion.ts';
	import { panelActivity } from '#lib/components/ui/panelActivity.ts';
	import type { Snippet } from 'svelte';

	const panelActive = panelActivity();
	interface Props {
		/** Bindable so callers can close the panel after an action (e.g. menu items). */
		open?: boolean;
		/** 'menu' renders a tight action-list panel instead of the settings sheet. */
		variant?: 'panel' | 'menu';
		trigger: Snippet<[{ toggle: () => void; open: boolean }]>;
		children: Snippet;
	}

	let { open = $bindable(false), variant = 'panel', trigger, children }: Props = $props();

	let rootRef = $state<HTMLDivElement | null>(null);

	function toggle() {
		open = !open;
	}

	$effect(() => {
		if (!panelActive() || !open) return;
		const onDown = (e: MouseEvent) => {
			if (rootRef && !rootRef.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				// Consume the press: without this the same Escape also reaches the
				// panel/workspace handlers and closes the whole panel behind the popover.
				e.stopPropagation();
				open = false;
			}
		};
		document.addEventListener('mousedown', onDown, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDown, true);
			document.removeEventListener('keydown', onKey);
		};
	});
	$effect(() => { if (!panelActive()) open = false; });
</script>

<!-- display:contents keeps the trigger in the toolbar's flex flow while the panel
     positions against the toolbar row itself (the nearest positioned ancestor), so
     every popover drops from the bar's right edge and can never overflow a narrow
     dock no matter which trigger opened it. -->
<div class="brw-pop" bind:this={rootRef}>
	{@render trigger({ toggle, open })}
	{#if open}
		<div transition:menuMotion class="brw-pop-panel" class:brw-pop-panel--menu={variant === 'menu'}>
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.brw-pop {
		display: contents;
	}

	.brw-pop-panel {
		position: absolute;
		top: calc(100% + 0.375rem);
		right: 0.75rem;
		z-index: 45;
		width: min(19rem, calc(100cqw - 1.5rem));
		padding: 0.875rem;
		background: var(--color-float-bg);
		backdrop-filter: var(--backdrop-blur) saturate(140%);
		-webkit-backdrop-filter: var(--backdrop-blur) saturate(140%);
		border: 1px solid var(--glass-border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	.brw-pop-panel--menu {
		width: auto;
		min-width: 11.5rem;
		padding: 0.25rem;
	}

	@container browse (min-width: 640px) {
		.brw-pop-panel {
			right: 1.5rem;
		}
	}
</style>
