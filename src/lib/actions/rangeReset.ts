/**
 * Svelte action: double-clicking a raw <input type="range"> snaps it back to its
 * default value. ui/Slider has this built in via its `defaultValue` prop. This
 * action covers the bespoke range inputs scattered around the app (grid columns,
 * sampling knobs, …).
 *
 * Usage: <input type="range" use:rangeReset={{ defaultValue: 1, apply: (v) => ... }} />
 * `apply` must route through the same state setter the input's own handler uses,
 * so the reset behaves exactly like the user dragging back to the default.
 */
interface RangeResetParam {
	defaultValue: number;
	apply: (value: number) => void;
}

export function rangeReset(node: HTMLInputElement, param: RangeResetParam) {
	let current = param;

	function handleDblClick() {
		if (node.disabled) return;
		current.apply(current.defaultValue);
	}

	node.addEventListener('dblclick', handleDblClick);
	node.title ||= 'Double-click to reset';

	return {
		update(next: RangeResetParam) {
			current = next;
		},
		destroy() {
			node.removeEventListener('dblclick', handleDblClick);
		}
	};
}
