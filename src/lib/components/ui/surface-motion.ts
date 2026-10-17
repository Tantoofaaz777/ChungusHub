import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

export const SURFACE_ENTER_MS = 200;
export const SURFACE_EXIT_MS = 140;
export const SURFACE_OFFSET = 8;
export const SURFACE_EASING = 'cubic-bezier(0.215, 0.61, 0.355, 1)';

export function reducedMotion(node: HTMLElement): boolean {
	return !!node.closest('[data-motion="reduced"]') ||
		!!node.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Geometry stays fixed; only the painted surface moves. Deferred options support reversal. */
export function surfaceMotion(node: HTMLElement, { offset = SURFACE_OFFSET, fade = true } = {}):
	(options?: { direction: 'in' | 'out' }) => TransitionConfig {
	const style = node.ownerDocument.defaultView?.getComputedStyle(node);
	const transform = style?.transform && style.transform !== 'none' ? style.transform : '';
	const opacity = Number.parseFloat(style?.opacity ?? '1');
	return ({ direction } = { direction: 'in' }) => ({
		duration: reducedMotion(node) ? 0 : direction === 'out' ? SURFACE_EXIT_MS : SURFACE_ENTER_MS,
		easing: cubicOut,
		css: (t, u) => `${fade ? `opacity: ${opacity * t};` : ''}${offset ? `transform: ${transform} translateY(${offset * u}px);` : ''}`
	});
}

/** A portal containing fixed children must never acquire a transform. */
export function scrimMotion(node: HTMLElement) {
	return surfaceMotion(node, { offset: 0 });
}
