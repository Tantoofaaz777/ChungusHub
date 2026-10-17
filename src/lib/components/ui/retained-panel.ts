import type { Action } from 'svelte/action';
import { reducedMotion, SURFACE_ENTER_MS, SURFACE_EXIT_MS, SURFACE_OFFSET, SURFACE_EASING } from './surface-motion';

/** Hide after the outro, without unmounting children or delaying activity/inert state. */
export const retainedPanel: Action<HTMLElement, boolean> = (node, initial) => {
	const style = node.ownerDocument.defaultView?.getComputedStyle(node);
	const opacity = style?.opacity ?? '1';
	const transform = style?.transform && style.transform !== 'none' ? style.transform : '';
	const openFrame = { opacity, transform: transform || 'none' };
	const closedFrame = { opacity: '0', transform: `${transform} translateY(${SURFACE_OFFSET}px)` };
	let active: boolean | undefined;
	let animation: Animation | null = null;
	let revision = 0;
	let destroyed = false;

	function update(next: boolean) {
		if (destroyed || next === active) return;
		active = next;
		const ticket = ++revision;
		const wasHidden = node.hidden;
		const current = animation ? node.ownerDocument.defaultView?.getComputedStyle(node) : null;
		const from = current ? { opacity: current.opacity, transform: current.transform } : wasHidden ? closedFrame : openFrame;
		animation?.cancel(); animation = null;
		node.inert = !next;
		node.setAttribute('aria-hidden', String(!next));
		if ((!next && wasHidden) || reducedMotion(node) || typeof node.animate !== 'function') {
			node.hidden = !next;
			return;
		}
		node.hidden = false;
		const running = node.animate([from, next ? openFrame : closedFrame], {
			duration: next ? SURFACE_ENTER_MS : SURFACE_EXIT_MS,
			easing: SURFACE_EASING, fill: 'both'
		});
		animation = running;
		void running.finished.then(() => {
			if (destroyed || ticket !== revision) return;
			node.hidden = !active;
			animation = null;
			running.cancel();
		}, () => { /* Cancellation is expected when the reader reverses or leaves. */ });
	}
	update(initial);
	return { update, destroy() { destroyed = true; ++revision; animation?.cancel(); animation = null; } };
};
