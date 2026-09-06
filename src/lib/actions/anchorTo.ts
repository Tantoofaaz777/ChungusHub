/**
 * Svelte action: lifts a floating panel out of the layout and glues it to an anchor.
 *
 * Every hover explanation in the app places itself through here, so no two of them
 * can drift apart. A bubble left in normal flow is offset from its nearest
 * positioned ancestor and clipped by the nearest scroll container, and the
 * workspace nests panels inside several `overflow: hidden` docks, so the tail of
 * the text is simply gone, with no way to reach it. Naming a side by hand only
 * picks which edge it falls off: the same bubble that fits in the settings column
 * can run off the edge of a narrow dock.
 *
 * So the node moves to `<body>` and lives in viewport coordinates, where nothing
 * can clip it, and the side is measured rather than declared: below the anchor
 * unless it doesn't fit there and does fit above, then pushed back inside both
 * edges. The result lands on the node as `data-placement="below" | "above"` so a
 * component can point its enter animation the right way, and `data-open` follows a
 * frame later so a CSS transition has a from-state to run out of.
 *
 * Render the node only while it should be visible. The node and the action live
 * and die together, which is what keeps this clear of the always-mounted portal
 * trap in architecture/ui-shell-settings.md, since there is no effect whose
 * cleanup can outlive what it detached:
 *
 *     {#if open}
 *         <span class="bubble" use:anchorTo={triggerEl}>…</span>
 *     {/if}
 */

/** Anchor → panel, and panel → viewport edge. One spacing for every tip in the app. */
const GAP = 8;
const EDGE = 8;

/** Push a `size`-long panel starting at `at` back inside an `extent`-long axis. */
const inside = (at: number, size: number, extent: number): number =>
	Math.max(EDGE, Math.min(at, extent - size - EDGE));

export function anchorTo(node: HTMLElement, anchor: HTMLElement | undefined) {
	let current = anchor;

	node.style.position = 'fixed';
	document.body.appendChild(node);

	function place(): void {
		if (!current) return;
		const box = current.getBoundingClientRect();
		// Layout size, not the rendered one: the reveal scales and shifts the node, and
		// a measurement taken mid-animation would place it against the wrong width.
		const width = node.offsetWidth;
		const height = node.offsetHeight;

		const below = box.bottom + GAP;
		const above = box.top - GAP - height;
		const flip = below + height + EDGE > window.innerHeight && above >= EDGE;

		node.style.left = `${inside(box.left, width, window.innerWidth)}px`;
		node.style.top = `${inside(flip ? above : below, height, window.innerHeight)}px`;
		node.dataset.placement = flip ? 'above' : 'below';
	}

	place();
	// A frame late on purpose: placing forces the layout that gives the transition its
	// from-state, and revealing in the same breath would skip it.
	const reveal = requestAnimationFrame(() => (node.dataset.open = ''));

	const reflow = (): void => place();
	// Capture: the scroll that moves the anchor is a panel's, not the window's.
	window.addEventListener('scroll', reflow, true);
	window.addEventListener('resize', reflow);

	return {
		update(next: HTMLElement | undefined): void {
			current = next;
			place();
		},
		destroy(): void {
			cancelAnimationFrame(reveal);
			window.removeEventListener('scroll', reflow, true);
			window.removeEventListener('resize', reflow);
			node.remove();
		}
	};
}
