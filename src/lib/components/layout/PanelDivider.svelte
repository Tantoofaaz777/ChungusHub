<script lang="ts">
	import { onDestroy } from 'svelte';
	import { desktopLayoutStore } from '$lib/stores/desktop-layout.svelte';
	import { clampPanelWidth, DEFAULT_PANEL_WIDTH, panelBounds } from './desktop-layout';

	let { workspaceWidth, width = $bindable(DEFAULT_PANEL_WIDTH), resizing = $bindable(false) }:
		{ workspaceWidth: number; width?: number; resizing?: boolean } = $props();
	let handle: HTMLDivElement;
	let pointer: number | null = null;
	let startX = 0;
	let startWidth = 0;
	let dragSide = 'left';
	let frame = 0;
	let pendingWidth = 0;
	const bounds = $derived(panelBounds(workspaceWidth));

	$effect(() => {
		if (!resizing) width = clampPanelWidth(desktopLayoutStore.panelWidth, workspaceWidth);
	});

	function start(event: PointerEvent) {
		if (event.button !== 0 || !event.isPrimary || pointer !== null) return;
		event.preventDefault();
		pointer = event.pointerId;
		startX = event.clientX; startWidth = width; dragSide = desktopLayoutStore.side;
		pendingWidth = width; resizing = true;
		handle.setPointerCapture(pointer);
		handle.focus({ preventScroll: true });
	}

	function move(event: PointerEvent) {
		if (event.pointerId !== pointer) return;
		pendingWidth = clampPanelWidth(startWidth + (event.clientX - startX) * (dragSide === 'left' ? 1 : -1), workspaceWidth);
		if (!frame) frame = requestAnimationFrame(() => { frame = 0; width = pendingWidth; });
	}

	function finish(save: boolean) {
		if (pointer === null) return;
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
		const id = pointer; pointer = null;
		if (save) desktopLayoutStore.setPanelWidth(pendingWidth);
		resizing = false;
		if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
	}

	function reset() { finish(false); desktopLayoutStore.setPanelWidth(DEFAULT_PANEL_WIDTH); }

	function keydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && resizing) { event.preventDefault(); event.stopPropagation(); finish(false); return; }
		let next: number;
		if (event.key === 'Home') next = bounds.min;
		else if (event.key === 'End') next = bounds.max;
		else if (event.key === 'Enter') { event.preventDefault(); reset(); return; }
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			next = width + (event.key === 'ArrowRight' ? 1 : -1) * (desktopLayoutStore.side === 'left' ? 1 : -1) * (event.shiftKey ? 40 : 16);
		} else return;
		event.preventDefault(); event.stopPropagation();
		desktopLayoutStore.setPanelWidth(clampPanelWidth(next, workspaceWidth));
	}

	onDestroy(() => finish(false));
</script>

<!-- A focusable ARIA separator is a keyboard-adjustable window splitter. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	class="panel-divider" class:resizing data-panel bind:this={handle}
	role="separator" tabindex="0" aria-label="Resize panel and chat" aria-orientation="vertical"
	aria-controls="workspace-panels" aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={width}
	aria-valuetext={`${width} pixels`} title="Drag to resize · Double-click to reset"
	onpointerdown={start} onpointermove={move} onpointerup={(event) => { if (event.pointerId === pointer) finish(true); }}
	onpointercancel={() => finish(false)} onlostpointercapture={() => finish(false)} ondblclick={reset} onkeydown={keydown}
></div>

<style>
	.panel-divider { position:absolute; z-index:40; top:0; bottom:0; width:8px; left:calc(var(--desktop-panel-width) - 4px); cursor:col-resize; touch-action:none; }
	.panel-divider::after { content:''; position:absolute; top:0; bottom:0; left:3px; width:2px; background:var(--color-border-subtle); transition:background-color 120ms ease; }
	.panel-divider:hover::after, .panel-divider:focus-visible::after, .panel-divider.resizing::after { background:var(--color-accent); }
	:global(.desktop-right) .panel-divider { left:auto; right:calc(var(--desktop-panel-width) - 4px); }
</style>
