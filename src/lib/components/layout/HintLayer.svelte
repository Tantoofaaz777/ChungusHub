<script lang="ts">
	/**
	 * Hint labels over every control on screen: the app's answer to reaching a target that is
	 * visible but far from wherever the keyboard currently is.
	 *
	 * Its value is that it needs nothing from the surfaces it labels. A panel becomes reachable
	 * by keyboard the moment its controls are real buttons, so no screen has to be taught arrow
	 * navigation of its own for the app to be usable without a mouse. What it cannot label is
	 * exactly what it should not hide: a `<div>` with a click handler has no label here, and
	 * that absence is a straight reading of where the markup is not semantic yet.
	 *
	 * **It is a mode, not a gesture**: the labels stay up until they are switched off, and
	 * re-label after every press instead of vanishing on the first one, because picking a
	 * control is usually the first of several moves and pressing the key again between each of
	 * them is the work this exists to remove. What it costs is the letters: while the labels
	 * are up they are spellings and not text, which is why picking a box to TYPE in switches
	 * the mode off on the way, and why Escape is always the way out.
	 *
	 * The open flag lives with the key that raises it (`commands/shortcuts.svelte.ts`).
	 */
	import { untrack } from 'svelte';
	import { hintMode } from '#lib/commands/shortcuts.svelte.ts';
	import { HINT_ALPHABET, hintLabels } from '#lib/utils/hints.ts';
	import { visibleTargets } from '#lib/utils/screen-targets.ts';

	interface Target {
		el: HTMLElement;
		label: string;
		x: number;
		y: number;
	}

	/**
	 * What earns a label: the things a browser already agrees are controls, plus `data-hint`
	 * for anything that opted in (the transcript's turns, which are reached rather than
	 * pressed). Deliberately no attempt to guess at click handlers: a wrong label points at
	 * something the press would never reach, which is worse than no label at all.
	 */
	const HINTABLE = [
		'a[href]',
		'button',
		'summary',
		'select',
		'textarea',
		'input:not([type="hidden"])',
		'[role="button"]',
		'[role="switch"]',
		'[role="tab"]',
		'[role="option"]',
		'[role="menuitem"]',
		'[data-hint]'
	].join(', ');

	/** Anything the letters belong to once it has focus: a caret, or a list that jumps on the
	 *  first letter typed at it. Reaching one of these is the way OUT of the mode. */
	const TEXT_ENTRY = 'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"])';

	/** Reached rather than pressed: the boxes above, and anything that opted in by saying it
	 *  has keys of its own (a turn's edit, branch and swipe). */
	const REACHED = `${TEXT_ENTRY}, [data-hint]`;

	let targets = $state<Target[]>([]);
	let typed = $state('');
	let layerElement = $state<HTMLDivElement | null>(null);

	let shown = $derived(targets.filter((target) => target.label.startsWith(typed)));

	$effect(() => {
		if (!hintMode.open) {
			targets = [];
			typed = '';
			return;
		}
		relabel();
		// **The page changes on its own schedule, so the labels watch it rather than guessing
		// when.** A press whose act is async (a swipe reaches the server and re-renders the turn
		// a few frames later) leaves labels standing over controls that are already gone, and
		// the reader spells one of them at something no press can reach. Re-reading a frame
		// after the press is not enough: the change has not landed yet.
		const observer = new MutationObserver((records) => {
			// Our own badges are a change too, and writing the labels would then observe itself.
			if (records.every((record) => layerElement?.contains(record.target))) return;
			queueRelabel();
		});
		observer.observe(document.body, { childList: true, subtree: true });
		return () => observer.disconnect();
	});

	/**
	 * Read the screen and label it, KEEPING the label a control already carries.
	 *
	 * Stability is what a standing mode needs and a one-off gesture never did: the transcript
	 * scrolls on its own while a reply arrives, and a set dealt fresh on every frame moves the
	 * label out from under a reader who has read it and not finished typing it, so the press
	 * lands on a different control. Labels go out fresh only when the count crosses into a
	 * different spelling length, where every one on screen is invalid anyway.
	 */
	function relabel(): void {
		const found = visibleTargets(HINTABLE);
		// Reading order rather than document order: the labels are read off the screen, and the
		// DOM puts a docked panel's controls wherever it happens to be mounted.
		found.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
		const labels = hintLabels(found.length);
		const width = labels[0]?.length ?? 0;
		const held = new Map<HTMLElement, string>();
		// Untracked, and this one is load-bearing: what is on screen now is an INPUT to what
		// goes on screen next, and the effect below calls this. Read as a dependency, the write
		// at the end of this function re-runs the effect that made it, forever.
		for (const target of untrack(() => targets)) {
			if (target.label.length === width) held.set(target.el, target.label);
		}
		const taken = new Set(found.map((target) => held.get(target.el)).filter(Boolean));
		// One spare per control that was not on screen last time, since every label a survivor
		// keeps is one this list does not hold.
		const spare = labels.filter((label) => !taken.has(label));
		let next = 0;
		targets = found.map((target) => ({
			el: target.el,
			label: held.get(target.el) ?? spare[next++],
			x: target.rect.left,
			y: target.rect.top
		}));
	}

	/**
	 * Re-label on the next frame, and only from a standing start.
	 *
	 * A refresh reassigns every label, so one landing mid-spelling would pull the screen out
	 * from under the reader between their two presses. With the field empty there is nothing to
	 * pull, which is exactly when the screen is worth re-reading.
	 */
	let refreshQueued = false;
	function queueRelabel(): void {
		if (!hintMode.open || typed || refreshQueued) return;
		refreshQueued = true;
		requestAnimationFrame(() => {
			refreshQueued = false;
			if (hintMode.open && !typed) relabel();
		});
	}

	function activate(el: HTMLElement): void {
		typed = '';
		// The label outlived what it pointed at: a press here reaches a node no longer in the
		// page and would read as the key having done nothing at all. Say so by putting fresh
		// labels up instead.
		if (!el.isConnected) {
			relabel();
			return;
		}
		if (el.matches(REACHED)) {
			// Focus is the whole act here. A turn keeps the labels up, since reaching one is
			// navigation and the next move is usually another; a box does not, and
			// `handleFocusIn` puts the mode away for it on the way.
			el.focus();
		} else {
			// Focus first, so the control the label picked is also where the keyboard now is:
			// the menu it opens takes its keys from there. `preventScroll`, because the label
			// was pointing at something already on screen.
			el.focus({ preventScroll: true });
			el.click();
		}
		// The press usually changed the screen (a menu opened, a page swapped), and the labels
		// have to be about what is there now or the next spelling reaches the wrong control.
		// A no-op once a text box has closed the mode on its way in.
		queueRelabel();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!hintMode.open) return;
		// A modified key was never aimed at a label, so it travels on to whatever it was meant
		// for, the key that switches the labels off included. It usually moves the keyboard or
		// swaps a panel, so the labels re-read the screen behind it.
		if (event.ctrlKey || event.metaKey || event.altKey) {
			queueRelabel();
			return;
		}
		// Captured before the composer, which still holds the caret: without this every letter
		// of a label would also land in the draft.
		event.preventDefault();
		event.stopPropagation();
		if (event.key === 'Escape') {
			hintMode.close();
			return;
		}
		if (event.key === 'Backspace') {
			typed = typed.slice(0, -1);
			return;
		}
		const key = event.key.toLowerCase();
		if (key.length !== 1 || !HINT_ALPHABET.includes(key)) return;
		const next = typed + key;
		const matching = targets.filter((target) => target.label.startsWith(next));
		// A mistyped letter costs nothing: the labels stay as they were rather than emptying
		// the screen and making the reader start the whole gesture again.
		if (matching.length === 0) return;
		typed = next;
		// Every label is the same length, so a spelling that reaches one is the whole of it.
		if (matching.length === 1 && matching[0].label === next) activate(matching[0].el);
	}

	/** A scroll or a resize moves what the labels point at, so they follow rather than lying
	 *  about it. Capture, since a scroll inside a panel does not bubble. */
	function follow(): void {
		queueRelabel();
	}

	/**
	 * Focus reaching a box that takes text switches the mode off, however it got there.
	 *
	 * The labels own the letters while they are up, so a caret landing anywhere by any route
	 * (a label, a Tab, a click into the composer) would otherwise leave the reader typing into
	 * a keyboard that answers with jumps. This is the rule that keeps a standing mode from
	 * becoming a trap.
	 */
	function handleFocusIn(event: FocusEvent): void {
		if (!hintMode.open) return;
		if (event.target instanceof HTMLElement && event.target.matches(TEXT_ENTRY)) hintMode.close();
	}
</script>

<svelte:window
	onkeydowncapture={handleKeydown}
	onscrollcapture={follow}
	onresize={follow}
	onfocusin={handleFocusIn}
/>

{#if hintMode.open}
	<!-- aria-hidden: a badge is an aim for the eye. A reader on a screen reader navigates by
	     the controls themselves, and reading a wall of two-letter codes to them would bury
	     every label the app actually wrote. -->
	<div class="hint-layer" aria-hidden="true" bind:this={layerElement}>
		{#each shown as target (target.label)}
			<span class="hint" style="left: {target.x}px; top: {target.y}px">
				{#if typed}<span class="hint-typed">{typed}</span>{/if}{target.label.slice(typed.length)}
			</span>
		{/each}
	</div>
{/if}

<style>
	/* Above every panel, popover and dialog in the app: the labels are drawn ON the screen the
	   reader is looking at, so anything they sit under is a control they cannot pick. */
	.hint-layer {
		position: fixed;
		inset: 0;
		z-index: 1200;
		pointer-events: none;
	}

	.hint {
		position: absolute;
		transform: translate(-25%, -45%);
		padding: 0.05rem 0.25rem;
		border-radius: var(--radius-sm);
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1.35;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
		white-space: nowrap;
	}

	/* What has already been typed stays on screen so the reader can see how far in they are,
	   dimmed so the letters still to press are the ones that read as the label. */
	.hint-typed {
		opacity: 0.55;
	}
</style>
