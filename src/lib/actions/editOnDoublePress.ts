import { DoubleTapGesture, TAP_HOLD_MS, DOUBLE_TAP_GAP_MS } from '#lib/utils/double-tap.ts';

interface Options { enabled: boolean; onEdit: () => void }
const CONTROLS = 'a, button, input, textarea, select, label, summary, img, video, audio, [role="button"], [role="link"], [contenteditable]:not([contenteditable="false"])';
const onControl = (target: EventTarget | null) => !(target instanceof Element) || !!target.closest(CONTROLS);
const point = (event: PointerEvent) => ({ id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp });

/** Optional mouse/touch shortcut; the normal Edit button remains the keyboard entry point. */
export function editOnDoublePress(node: HTMLElement, initial: Options) {
	let options = initial;
	const gesture = new DoubleTapGesture();
	let expiry: ReturnType<typeof setTimeout> | undefined;
	let watching = false;
	let lastTouch = -Infinity;
	const passiveCapture = { passive: true, capture: true };

	function reset() {
		gesture.cancel();
		clearTimeout(expiry);
		expiry = undefined;
		if (!watching) return;
		watching = false;
		window.removeEventListener('pointerdown', otherPress, true);
		window.removeEventListener('pointermove', move, true);
		window.removeEventListener('pointerup', release, true);
		window.removeEventListener('pointercancel', reset, true);
		window.removeEventListener('scroll', reset, true);
		window.removeEventListener('blur', reset);
	}
	function expireAfter(ms: number) { clearTimeout(expiry); expiry = setTimeout(reset, ms); }
	function otherPress(event: PointerEvent) {
		if (event.pointerType !== 'touch' || !event.isPrimary || !(event.target instanceof Node) || !node.contains(event.target) || onControl(event.target)) reset();
	}
	function move(event: PointerEvent) {
		gesture.move(point(event));
		if (!gesture.active) reset();
	}
	function release(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		if (!options.enabled || onControl(event.target)) { reset(); return; }
		const matched = gesture.end(point(event));
		if (matched) { reset(); options.onEdit(); }
		else if (gesture.active) expireAfter(DOUBLE_TAP_GAP_MS);
		else reset();
	}
	function press(event: PointerEvent) {
		if (event.pointerType !== 'touch') return;
		lastTouch = performance.now();
		if (!options.enabled || !event.isPrimary || onControl(event.target)) { reset(); return; }
		gesture.start(point(event));
		if (!watching) {
			watching = true;
			// Capture only while a gesture is pending, rather than a global listener per row.
			window.addEventListener('pointerdown', otherPress, passiveCapture);
			window.addEventListener('pointermove', move, passiveCapture);
			window.addEventListener('pointerup', release, passiveCapture);
			window.addEventListener('pointercancel', reset, passiveCapture);
			window.addEventListener('scroll', reset, passiveCapture);
			window.addEventListener('blur', reset);
		}
		expireAfter(TAP_HOLD_MS);
	}
	function doubleClick(event: MouseEvent) {
		// Some touch browsers also synthesize dblclick. Never let it bypass gesture checks.
		if (performance.now() - lastTouch < 700 || !options.enabled || event.button !== 0 || onControl(event.target)) return;
		options.onEdit();
	}
	node.addEventListener('pointerdown', press, { passive: true });
	node.addEventListener('dblclick', doubleClick);
	return {
		update(next: Options) { options = next; if (!next.enabled) reset(); },
		destroy() {
			reset();
			node.removeEventListener('pointerdown', press);
			node.removeEventListener('dblclick', doubleClick);
		}
	};
}
