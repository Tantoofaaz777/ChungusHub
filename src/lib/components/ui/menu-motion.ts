import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';
import { reducedMotion } from './surface-motion';

/** Bidirectional motion lets a rapidly toggled menu reverse from its current position.
 * Svelte makes outgoing elements inert immediately and restores them on reversal. */
export function menuMotion(node: HTMLElement): (options?: { direction: 'in' | 'out' }) => TransitionConfig {
	const view = node.ownerDocument.defaultView;
	const style = view?.getComputedStyle(node);
	const transform = style?.transform && style.transform !== 'none' ? style.transform : '';
	const opacity = Number.parseFloat(style?.opacity ?? '1');
	return ({ direction } = { direction: 'in' }) => {
		const reduced = reducedMotion(node);
		return {
			duration: reduced ? 0 : direction === 'out' ? 100 : 160,
			easing: cubicOut,
			css: (t, u) => `opacity: ${opacity * t}; transform: ${transform} translateY(${4 * u}px);`
		};
	};
}
