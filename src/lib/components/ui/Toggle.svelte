<script lang="ts">
	/**
	 * The one switch. Two sizes and ONE on-state, deliberately: a control that is
	 * on has to look on the same way everywhere, so a dense list does not get to
	 * trade the solid accent for a faint tint and leave the reader deciding per
	 * surface what "lit" means here.
	 *
	 * `md` is a settings row. `sm` is a dense list row (steering notes, lorebook rows),
	 * where the md track is taller than the line of text beside it.
	 *
	 * Not every two-state control belongs here: the lorebook row's status dot
	 * carries THREE natures in its colour (always active / keyword / off) and only
	 * happens to click as a toggle, so it stays its own glyph.
	 */
	interface Props {
		checked: boolean;
		onchange?: (checked: boolean) => void;
		disabled?: boolean;
		size?: 'sm' | 'md';
		/** Accessible name when no visible label sits next to the control. */
		label?: string;
	}

	let { checked, onchange, disabled = false, size = 'md', label }: Props = $props();
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	class="toggle toggle--{size}"
	class:on={checked}
	{disabled}
	onclick={() => onchange?.(!checked)}
>
	<span class="knob"></span>
</button>

<style>
	/* Geometry is three custom properties per size, so the knob's travel is derived
	   from the track rather than hand-tuned twice and drifting apart. */
	.toggle {
		position: relative;
		flex-shrink: 0;
		padding: 0;
		width: var(--tgl-w);
		height: var(--tgl-h);
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-bg-tertiary) 85%, transparent);
		cursor: pointer;
		transition: background-color 160ms ease, border-color 160ms ease;
	}

	.toggle--md {
		--tgl-w: 2.3rem;
		--tgl-h: 1.3rem;
		--tgl-knob: 0.95rem;
	}

	.toggle--sm {
		--tgl-w: 1.75rem;
		--tgl-h: 1rem;
		--tgl-knob: 0.7rem;
	}

	.toggle.on {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	.toggle:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.knob {
		position: absolute;
		top: 50%;
		left: 2px;
		width: var(--tgl-knob);
		height: var(--tgl-knob);
		border-radius: var(--radius-full);
		background: var(--color-text-muted);
		transform: translateY(-50%);
		transition: transform 160ms ease, background-color 160ms ease;
	}

	.toggle.on .knob {
		background: var(--color-on-accent);
		/* Track minus knob minus both 2px insets and the 1px borders. */
		transform: translate(calc(var(--tgl-w) - var(--tgl-knob) - 6px), -50%);
	}
</style>
