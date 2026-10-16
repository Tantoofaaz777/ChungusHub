<script lang="ts">
	/**
	 * A color swatch that opens a color popover: the shared ColorPicker, optionally
	 * under a menu of sources this color can come from. ColorPicker is a bare panel by
	 * design (the caller owns anchor, click-away and Escape), so without this every
	 * settings row would re-implement the same dance.
	 *
	 * With `sources` given the swatch stops being "the custom hex" and becomes "this
	 * color", whatever it currently resolves to. That is why the chip can be told a
	 * `chip` value that is not `value`, and why the picker only appears once the reader
	 * has asked for a custom one. That collapses a four-pill source row plus a separate
	 * swatch into one control, which is what keeps a card of several accents readable.
	 *
	 * The Interface page's accent swatch deliberately does NOT use this: it carries its
	 * own "+" empty state and flips `accent` to 'custom' on open.
	 */
	import ColorPicker from './ColorPicker.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		value: string;
		oninput: (hex: string) => void;
		/** Accessible name for the swatch button (e.g. "User bubble tint color"). */
		label: string;
		/** Which edge the popover hangs from. Flip it for swatches near the left. */
		align?: 'start' | 'end';
		/** What the chip paints, when the color in force is not the hex being edited
		 *  (a resolved source). Defaults to `value`. */
		chip?: string;
		/** Where this color comes from. Given, the popover leads with these and the
		 *  picker follows only while `source === 'custom'`. Each `swatch` is any CSS
		 *  color the caller can name, so an option may show a live theme var. */
		sources?: { value: string; label: string; swatch: string }[];
		source?: string;
		onsource?: (value: string) => void;
	}

	let { value, oninput, label, align = 'end', chip, sources, source, onsource }: Props =
		$props();

	let open = $state(false);
	let popover = $state<HTMLDivElement | undefined>(undefined);
	let anchor = $state<HTMLButtonElement | undefined>(undefined);

	function pickSource(next: string) {
		onsource?.(next);
		// A source picked is a finished answer, so the popover goes with it. Custom is
		// the one that is not finished: it still owes a color, so the picker opens
		// underneath rather than the panel closing on a half-made decision. Closing takes
		// the pressed button down with it, so focus goes back to the swatch by hand or a
		// keyboard reader is left standing on <body>.
		if (next === 'custom') return;
		open = false;
		anchor?.focus();
	}

	function handlePointerDown(event: PointerEvent) {
		if (!open) return;
		const target = event.target as Node;
		if (popover?.contains(target) || anchor?.contains(target)) return;
		open = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !open) return;
		// Consume it so the Settings panel's Escape-steps-back doesn't also fire.
		event.preventDefault();
		event.stopPropagation();
		open = false;
		anchor?.focus();
	}
</script>

<svelte:window onpointerdown={handlePointerDown} onkeydown={handleKeydown} />

<span class="wrap">
	<button
		type="button"
		bind:this={anchor}
		class="swatch-btn"
		aria-label={label}
		aria-expanded={open}
		title={label}
		onclick={() => (open = !open)}
	>
		<span class="swatch-chip" style="background: {chip ?? value}"></span>
		<Icon name="chevronDown" class="w-3 h-3" strokeWidth={2} />
	</button>
	{#if open}
		<div class="popover surface-float slide-up" class:popover-start={align === 'start'} bind:this={popover}>
			{#if sources}
				<div class="sources" role="radiogroup" aria-label={label}>
					{#each sources as s (s.value)}
						<button
							type="button"
							class="source"
							class:is-active-tint={s.value === source}
							role="radio"
							aria-checked={s.value === source}
							onclick={() => pickSource(s.value)}
						>
							<span class="swatch-chip" style="background: {s.swatch}"></span>
							{s.label}
						</button>
					{/each}
				</div>
			{/if}
			{#if !sources || source === 'custom'}
				<ColorPicker {value} {oninput} />
			{/if}
		</div>
	{/if}
</span>

<style>
	.wrap {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
	}

	/* The colored area is NOT the control. Two earlier tries made the whole button
	   a block of the chosen color, and each time it collided with something else in
	   the row: a filled disc is the slider thumb, a filled stadium is the toggle,
	   and both wear the accent hue. So the control is neutral chrome (a bordered
	   button with a caret, like any other menu trigger) and the color rides inside
	   it as a small square. Nothing else in this UI is a square. */
	.swatch-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		height: 1.5rem;
		padding: 0 0.3rem;
		border-radius: var(--radius-sm);
		border: 1px solid color-mix(in srgb, var(--color-border) 88%, transparent);
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
	}

	.swatch-btn:hover {
		border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border) 45%);
		background: color-mix(in srgb, var(--color-bg-tertiary) 100%, transparent);
		color: var(--color-text-secondary);
	}

	.swatch-btn:focus-visible {
		outline: 0;
		border-color: color-mix(in srgb, var(--color-accent) 85%, white 15%);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent-muted) 70%, transparent);
	}

	/* The small color chip keeps its own fixed rounding. */
	.swatch-chip {
		flex-shrink: 0;
		width: 0.82rem;
		height: 0.82rem;
		border-radius: 3px;
		/* The chip may be handed `currentColor` by a source that means "whatever the
		   prose is", so it carries that color itself rather than inheriting the button's
		   muted one, which would paint the wrong answer with no error anywhere. */
		color: var(--color-text-primary);
		/* Inner hairline so a color close to the button's own fill still has an edge. */
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 22%);
	}

	/* Floating over panel content, so the markup carries .surface-float. */
	.popover {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.75rem;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	/* Matches ColorPicker's own width, so revealing the picker under Custom drops it
	   open downward instead of also snapping the panel wider. */
	.sources {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		width: 13.5rem;
	}

	.source {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.4rem;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-weight: 550;
		text-align: left;
		cursor: pointer;
		transition: color 90ms ease, background-color 90ms ease, border-color 90ms ease;
	}

	.source:hover {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
	}

	/* Scoped mirror of the canonical .is-active-tint recipe: that one lives in a
	   cascade layer, so this unlayered scoped base would otherwise outrank it. After
	   :hover, so the picked source stays tinted while the pointer is on it. */
	.source.is-active-tint {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 33%, transparent);
	}

	.popover-start {
		right: auto;
		left: 0;
	}
</style>
