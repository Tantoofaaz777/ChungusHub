type OpenMenu = (anchor: DOMRect) => void;

/** Context-menu gestures for a button whose ordinary click has its own action. */
export function contextPress(node: HTMLButtonElement, initial: OpenMenu | null) {
	let openMenu = initial;
	let held: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
	let suppressClick = false;
	let touchGesture = false;
	let releaseGuard: AbortController | null = null;

	function cancel() {
		if (!held) return;
		clearTimeout(held.timer);
		held = null;
		window.removeEventListener('scroll', cancel, true);
	}

	function openFromTouch() {
		if (!held) return;
		const { x, y } = held;
		cancel();
		guardTouchRelease();
		openMenu?.(new DOMRect(x, y));
	}

	function clearReleaseGuard() {
		releaseGuard?.abort();
		releaseGuard = null;
	}

	function guardTouchRelease() {
		clearReleaseGuard();
		releaseGuard = new AbortController();
		const options = { capture: true, signal: releaseGuard.signal };
		// The click synthesized on release can land on the menu or its backdrop.
		window.addEventListener('mousedown', event => event.preventDefault(), options);
		window.addEventListener('click', event => {
			if (event.detail === 0) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			clearReleaseGuard();
		}, options);
		window.addEventListener('pointerdown', clearReleaseGuard, options);
	}

	function down(event: PointerEvent) {
		if (!event.isPrimary) return;
		cancel();
		suppressClick = false;
		touchGesture = event.pointerType === 'touch';
		if (!openMenu || !touchGesture) return;
		held = {
			id: event.pointerId, x: event.clientX, y: event.clientY,
			timer: setTimeout(openFromTouch, 500)
		};
		window.addEventListener('scroll', cancel, { capture: true, passive: true });
	}

	function move(event: PointerEvent) {
		if (held?.id !== event.pointerId || Math.hypot(event.clientX - held.x, event.clientY - held.y) <= 10) return;
		suppressClick = true;
		cancel();
	}

	function end(event: PointerEvent) {
		if (held?.id === event.pointerId) cancel();
	}

	function contextMenu(event: MouseEvent) {
		if (!openMenu) return;
		event.preventDefault();
		if (held) openFromTouch();
		else if (!touchGesture && (event as PointerEvent).pointerType !== 'touch') {
			openMenu(event.clientX || event.clientY ? new DOMRect(event.clientX, event.clientY) : node.getBoundingClientRect());
		}
	}

	function keydown(event: KeyboardEvent) {
		if (!openMenu || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return;
		event.preventDefault();
		openMenu(node.getBoundingClientRect());
	}

	function click(event: MouseEvent) {
		if (!suppressClick || event.detail === 0) return;
		suppressClick = false;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	const listeners = new AbortController();
	const { signal } = listeners;
	node.addEventListener('pointerdown', down, { signal });
	node.addEventListener('pointermove', move, { signal });
	node.addEventListener('pointerup', end, { signal });
	node.addEventListener('pointercancel', end, { signal });
	node.addEventListener('lostpointercapture', end, { signal });
	node.addEventListener('contextmenu', contextMenu, { signal });
	node.addEventListener('keydown', keydown, { signal });
	node.addEventListener('click', click, { signal, capture: true });
	return {
		update(next: OpenMenu | null) {
			openMenu = next;
			if (!next) cancel();
		},
		destroy() {
			cancel();
			clearReleaseGuard();
			listeners.abort();
		}
	};
}
