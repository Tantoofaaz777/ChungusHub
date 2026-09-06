/**
 * Svelte action: hands a settings row's whole area to the switch it contains.
 *
 * A switch is a ~40px target sitting at the far end of a row as wide as the
 * settings column (`--settings-measure`), so pointer users pay a long travel for
 * a small hit box, the motor half of the label-is-miles-from-its-control
 * problem (the visual half is the hover band on `.toggle-row` in app.css; the
 * measure is capped on the column, never per row). This widens the target to the
 * row without adding a second tab stop: the switch stays the only focusable
 * thing in there, so keyboard and screen-reader behaviour is untouched.
 *
 * **The row is the switch, including what it refuses to do.** Every other
 * click-the-whole-row surface in the app is a real `<button>`, which app.css makes
 * `user-select: none`; this one is a plain div that borrowed a button's meaning,
 * so it has to borrow the rest by hand. Left to the browser, a double click means
 * two different things three pixels apart (over a word it highlights the word,
 * over the gap beside it it flips the switch twice), and nothing on screen says
 * which one you are about to get. So the row refuses the multi-click selection
 * step, and nothing else: a deliberate drag over the label still selects it. That
 * is the whole rule. A press that travels is a drag and belongs to the text; a
 * press that lands where it started is a click and belongs to the row; neither
 * asks what is selected elsewhere on the page.
 *
 * Usage: <div class="toggle-row" use:toggleRow> … <Toggle … /> </div>
 * It works on any row shape, not just the `.toggle-row` recipe: Security's
 * password lock and the lorebook globals both roll their own markup. The action
 * stamps `data-row-toggle` so app.css can hand
 * those the pointer cursor too, gated on the same `[role="switch"]:not(:disabled)`
 * this handler checks so the affordance and the behaviour can't disagree.
 *
 * Do NOT put this on a row that already means something else when clicked: the
 * Engines list row drills into a detail page and the Regex rule row expands, and
 * a second meaning on the same click is a bug, not a convenience.
 */

/** Travel between press and release, past which the gesture was a drag, not a click. */
const DRAG_SLOP = 4;

/** The switch itself, an InfoTip trigger, a link, a lorebook global's number field. */
const CONTROLS = 'button, a, input, select, textarea, label';

/** Whether this press or click is a control's own business rather than the row's. */
const onControl = (event: MouseEvent): boolean =>
	!!(event.target as HTMLElement | null)?.closest(CONTROLS);

export function toggleRow(node: HTMLElement) {
	let press: { x: number; y: number } | null = null;

	function handleMouseDown(event: MouseEvent) {
		press = { x: event.clientX, y: event.clientY };
		if (onControl(event)) return;
		// The second and third press of a rapid sequence is where the browser extends
		// the selection by word and then by line. That is the only thing refused here;
		// a single press still starts an ordinary drag-selection. Refused off controls
		// only: double-clicking a word inside a row's own text field must still pick
		// that word, and the same-shaped rule in both handlers is what keeps the two
		// from disagreeing about who owns a press.
		if (event.detail > 1) event.preventDefault();
	}

	function handleClick(event: MouseEvent) {
		const from = press;
		press = null;

		if (onControl(event)) return;
		// A press that travelled was a drag over the label. Asked of this press only:
		// what is selected elsewhere on the page is not this row's business either.
		if (
			from &&
			(Math.abs(event.clientX - from.x) > DRAG_SLOP || Math.abs(event.clientY - from.y) > DRAG_SLOP)
		) {
			return;
		}

		node.querySelector<HTMLButtonElement>('[role="switch"]:not(:disabled)')?.click();
	}

	node.dataset.rowToggle = '';
	node.addEventListener('mousedown', handleMouseDown);
	node.addEventListener('click', handleClick);

	return {
		destroy() {
			delete node.dataset.rowToggle;
			node.removeEventListener('mousedown', handleMouseDown);
			node.removeEventListener('click', handleClick);
		}
	};
}
