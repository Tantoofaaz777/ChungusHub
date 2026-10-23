/** Touch policy for every native range, including controls mounted in dialogs/popovers.
 * Mouse, pen, keyboard and assistive-technology input keep their native behavior. */
export function protectTouchRanges(doc: Document): () => void {
	const win = doc.defaultView;
	if (!win) return () => {};
	const SLOP = 10;
	type Gesture = {
		node: HTMLInputElement;
		id: number;
		x: number;
		y: number;
		original: string;
		accepted: string;
		moved: boolean;
		mode: 'pending' | 'horizontal' | 'scroll';
	};
	let gesture: Gesture | null = null;
	let emitting = false;
	let lastTouch: { node: HTMLInputElement; time: number } | null = null;
	let lastScroll: { target: EventTarget | null; time: number } | null = null;

	function range(event: Event): HTMLInputElement | undefined {
		return event.composedPath().find((target): target is HTMLInputElement =>
			(target as Element).nodeName === 'INPUT' && (target as HTMLInputElement).type === 'range');
	}

	function dispatch(node: HTMLInputElement, type: 'input' | 'change') {
		emitting = true;
		try { node.dispatchEvent(new Event(type, { bubbles: true, composed: true })); }
		finally { emitting = false; }
	}

	function restore(current: Gesture) {
		if (!current.node.isConnected || current.node.disabled) return;
		current.node.value = current.original;
		if (current.accepted !== current.original) dispatch(current.node, 'input');
		current.accepted = current.node.value;
	}

	function cancel() {
		if (gesture) restore(gesture);
		gesture = null;
	}

	function down(event: PointerEvent) {
		if (event.pointerType !== 'touch') {
			lastTouch = null;
			return;
		}
		const multiTouch = gesture !== null || !event.isPrimary;
		if (multiTouch) cancel();
		const node = range(event);
		lastTouch = null;
		if (!node || node.disabled) return;
		// Cancel the range's immediate native jump, not browser panning. CSS grants pan-y
		// and pinch-zoom before contact; Pointer Events cancellation does not own scrolling.
		event.preventDefault();
		event.stopImmediatePropagation();
		lastTouch = { node, time: Date.now() };
		if (multiTouch) return;
		const scrolling = lastScroll && Date.now() - lastScroll.time < 150 &&
			(lastScroll.target === doc || (lastScroll.target as Element)?.contains?.(node));
		gesture = { node, id: event.pointerId, x: event.clientX, y: event.clientY,
			original: node.value, accepted: node.value, moved: false, mode: scrolling ? 'scroll' : 'pending' };
	}

	function classify(current: Gesture, event: PointerEvent) {
		const dx = Math.abs(event.clientX - current.x);
		const dy = Math.abs(event.clientY - current.y);
		if (Math.max(dx, dy) >= SLOP) current.moved = true;
		if (current.mode !== 'pending') return;
		if (dy >= SLOP && dy >= dx) current.mode = 'scroll';
		else if (dx >= SLOP && dx > dy * 1.4) current.mode = 'horizontal';
	}

	function apply(current: Gesture, x: number) {
		const node = current.node;
		if (!node.isConnected || node.disabled) return;
		const rect = node.getBoundingClientRect();
		if (!rect.width) return;
		const style = win!.getComputedStyle(node);
		const thumbWidth = parseFloat(win!.getComputedStyle(node, '::-webkit-slider-thumb').width);
		const thumb = (thumbWidth > 0 && thumbWidth < node.offsetWidth / 2 ? thumbWidth : 16) *
			(rect.width / (node.offsetWidth || rect.width));
		const inset = Math.min(thumb / 2, rect.width / 4);
		let fraction = Math.min(1, Math.max(0, (x - rect.left - inset) / (rect.width - inset * 2)));
		if (style.direction === 'rtl') fraction = 1 - fraction;
		const min = node.min === '' ? 0 : Number(node.min);
		const max = node.max === '' ? 100 : Number(node.max);
		const before = node.value;
		// The native setter supplies exactly the range's own clamping/step/decimal rules.
		node.valueAsNumber = min + fraction * (max - min);
		current.accepted = node.value;
		if (node.value !== before) dispatch(node, 'input');
	}

	function move(event: PointerEvent) {
		const current = gesture;
		if (!current || event.pointerId !== current.id) return;
		classify(current, event);
		event.stopImmediatePropagation();
		if (current.mode === 'horizontal') {
			event.preventDefault();
			apply(current, event.clientX);
		}
	}

	function up(event: PointerEvent) {
		const current = gesture;
		if (!current || event.pointerId !== current.id) return;
		classify(current, event);
		event.preventDefault();
		event.stopImmediatePropagation();
		lastTouch = { node: current.node, time: Date.now() };
		if (current.mode === 'horizontal' || (current.mode === 'pending' && !current.moved)) {
			current.node.focus({ preventScroll: true });
			apply(current, event.clientX);
			if (current.accepted !== current.original) dispatch(current.node, 'change');
		} else restore(current);
		gesture = null;
	}

	function abort(event: PointerEvent) {
		if (gesture && event.pointerId === gesture.id) cancel();
	}

	function nativeInput(event: Event) {
		if (emitting || !gesture || range(event) !== gesture.node) return;
		// Some engines still emit native range input during a cancelled pointer default.
		// Stop it before any component can persist the value, rather than undoing a save.
		gesture.node.value = gesture.accepted;
		event.stopImmediatePropagation();
	}

	function scroll(event: Event) {
		lastScroll = { target: event.target, time: Date.now() };
		if (gesture?.mode === 'pending' &&
			(event.target === doc || (event.target as Element)?.contains?.(gesture.node))) gesture.mode = 'scroll';
	}

	function click(event: MouseEvent) {
		if (!lastTouch || range(event) !== lastTouch.node) return;
		const pointerType = (event as PointerEvent).pointerType;
		if (pointerType === 'mouse' || pointerType === 'pen') return;
		const capabilities = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities;
		if (pointerType === 'touch' || capabilities?.firesTouchEvents ||
			(capabilities == null && Date.now() - lastTouch.time < 800)) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	}

	const capture = { capture: true, passive: false };
	doc.addEventListener('pointerdown', down, capture);
	doc.addEventListener('pointermove', move, capture);
	doc.addEventListener('pointerup', up, capture);
	doc.addEventListener('pointercancel', abort, true);
	doc.addEventListener('lostpointercapture', abort, true);
	doc.addEventListener('input', nativeInput, true);
	doc.addEventListener('change', nativeInput, true);
	doc.addEventListener('scroll', scroll, { capture: true, passive: true });
	doc.addEventListener('click', click, capture);
	doc.addEventListener('dblclick', click, capture);
	win.addEventListener('blur', cancel);
	win.addEventListener('pagehide', cancel);
	return () => {
		gesture = null;
		doc.removeEventListener('pointerdown', down, true);
		doc.removeEventListener('pointermove', move, true);
		doc.removeEventListener('pointerup', up, true);
		doc.removeEventListener('pointercancel', abort, true);
		doc.removeEventListener('lostpointercapture', abort, true);
		doc.removeEventListener('input', nativeInput, true);
		doc.removeEventListener('change', nativeInput, true);
		doc.removeEventListener('scroll', scroll, true);
		doc.removeEventListener('click', click, true);
		doc.removeEventListener('dblclick', click, true);
		win.removeEventListener('blur', cancel);
		win.removeEventListener('pagehide', cancel);
	};
}
