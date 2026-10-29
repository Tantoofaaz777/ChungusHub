/**
 * Moving the keyboard by direction: the focus keys' one door into the page.
 *
 * Where the hint labels reach a target that is visible but far, this reaches the one next to
 * where you already are, which is the step Tab gets wrong on any screen laid out in two
 * dimensions. Scoring is pure and lives in [`utils/spatial-nav.ts`](../utils/spatial-nav.ts);
 * what this file owns is the page: who the candidates are, where the move starts from, and
 * what happens when there is nothing that way.
 *
 * See architecture/ui-shell-settings.md, "Keyboard".
 */
import { bestInDirection, type Direction } from '#lib/utils/spatial-nav.ts';
import { visibleTargets } from '#lib/utils/screen-targets.ts';

/**
 * What can hold focus, read off the ATTRIBUTE rather than the computed `tabIndex`.
 *
 * The difference is load-bearing: an element with no tabindex reports -1 exactly like one
 * carrying `tabindex="-1"`, so the computed value cannot tell a transcript turn (focusable,
 * deliberately out of the tab order) from a plain `<div>` (not focusable at all), and moving
 * to the second one silently drops the keyboard on the floor.
 *
 * Narrower than the hint labels' list on purpose: a `role="button"` with no tabindex can be
 * pressed by a label and cannot be reached by a focus key, because nothing can focus it.
 */
const FOCUSABLE = [
	'a[href]',
	'button',
	'input:not([type="hidden"])',
	'select',
	'textarea',
	'summary',
	'[tabindex]'
].join(', ');

/** How much of a panel one press scrolls when nothing is left on screen that way. */
const SCROLL_SHARE = 0.8;

/**
 * Move the keyboard one control in a direction.
 *
 * With nothing focused (or focus on `<body>`, which is where it lands after a surface closes)
 * the move starts from the middle of the screen, so the first press goes somewhere predictable
 * instead of nowhere.
 */
export function moveFocus(direction: Direction, mayScroll = true): void {
	const active = document.activeElement;
	const from = active instanceof HTMLElement && active !== document.body ? active : null;
	const origin = from?.getBoundingClientRect() ?? centreOfScreen();
	const targets = visibleTargets(FOCUSABLE).filter((target) => target.el !== from);
	const pick = bestInDirection(
		origin,
		targets.map((target) => target.rect),
		direction
	);
	if (pick !== null) {
		targets[pick].el.focus();
		return;
	}
	// Nothing that way ON SCREEN, which is not the same as nothing that way: a settings page is
	// taller than the window, and without this the keyboard would stop dead at the fold every
	// time. Scroll the box the focus is in and take the one retry, which either lands on what
	// just came into view or reports the edge by doing nothing.
	if (!mayScroll) return;
	if (!scrollTowards(direction, from)) return;
	requestAnimationFrame(() => moveFocus(direction, false));
}

/** A zero-size box in the middle of the window: a starting point with no bias in any direction. */
function centreOfScreen(): DOMRect {
	const x = window.innerWidth / 2;
	const y = window.innerHeight / 2;
	return new DOMRect(x, y, 0, 0);
}

/** Scroll the nearest box that can still move that way, and say whether anything did. */
function scrollTowards(direction: Direction, from: Element | null): boolean {
	const vertical = direction === 'up' || direction === 'down';
	const sign = direction === 'up' || direction === 'left' ? -1 : 1;
	let node: Element | null = from ?? document.scrollingElement;
	while (node) {
		const style = getComputedStyle(node);
		const overflow = vertical ? style.overflowY : style.overflowX;
		if (overflow === 'auto' || overflow === 'scroll') {
			const before = vertical ? node.scrollTop : node.scrollLeft;
			const step = (vertical ? node.clientHeight : node.clientWidth) * SCROLL_SHARE * sign;
			// `instant`: the transcript's scroller glides by its own CSS and a plain write
			// defers to it (architecture/chat-sessions.md coupling 15), so the retry a frame
			// later would read a position still travelling and land on the wrong control.
			node.scrollBy({ top: vertical ? step : 0, left: vertical ? 0 : step, behavior: 'instant' });
			if ((vertical ? node.scrollTop : node.scrollLeft) !== before) return true;
		}
		node = node.parentElement;
	}
	return false;
}
