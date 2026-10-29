<script lang="ts" module>
	import { deleteGuard } from '#lib/stores/delete-guard.svelte.ts';

	/** Blast radii below this confirm with a plain click; at/above it the button
	 *  requires a press-and-hold, so muscle memory alone can never fire it. */
	export const HOLD_THRESHOLD = 5;

	/** Hold duration scaled by blast radius: ~0.63s at the threshold, growing to 1.4s at
	 *  100+ messages. Active holding beats a passive countdown: the reading happens
	 *  while the finger is on the button, and a deliberate user is never parked. The
	 *  curve is tuned so a cleanup pass of many small deletes never feels parked either:
	 *  the gesture has to outlast a reflex, not a sentence. */
	export function holdMsForBlast(messages: number): number {
		// One place answers "is the heavy rung in force", so every hold in the app follows the
		// setting without a single call site knowing the setting exists.
		if (!deleteGuard.holds) return 0;
		if (messages < HOLD_THRESHOLD) return 0;
		const t = Math.min(1, (messages - HOLD_THRESHOLD) / (100 - HOLD_THRESHOLD));
		return Math.round(630 + t * 770);
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** 0 = a normal click confirms; > 0 = press-and-hold for this long. */
		holdMs: number;
		/**
		 * Where the button is standing. `block` is a row in a stacked menu: full width, text
		 * on the left, the shape every other item in that column has. `inline` is one action
		 * in a dialog's footer, metrically identical to `ui/Button` at size md in padding,
		 * radius and type, so it and the Cancel beside it read as a pair; the footer is what
		 * settles their shared width. A block button dropped into a footer takes the whole
		 * row and squeezes its neighbour to its text.
		 */
		shape?: 'block' | 'inline';
		onconfirm: () => void;
		disabled?: boolean;
		children: Snippet;
	}

	let { holdMs, shape = 'block', onconfirm, disabled = false, children }: Props = $props();

	let holding = $state(false);
	let showHint = $state(false);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let hintTimer: ReturnType<typeof setTimeout> | null = null;
	let pressedAt = 0;

	const needsHold = $derived(holdMs > 0);

	function start() {
		if (disabled || !needsHold || holding) return;
		pressedAt = Date.now();
		showHint = false;
		holding = true;
		timer = setTimeout(() => {
			holding = false;
			timer = null;
			onconfirm();
		}, holdMs);
	}

	function cancel() {
		if (!holding) return;
		holding = false;
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		// A short tap means the user expected a click: teach the hold, don't sulk.
		if (Date.now() - pressedAt < Math.min(400, holdMs)) {
			showHint = true;
			if (hintTimer) clearTimeout(hintTimer);
			hintTimer = setTimeout(() => (showHint = false), 1400);
		}
	}

	function onClick() {
		if (disabled || needsHold) return;
		onconfirm();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== ' ' && e.key !== 'Enter') return;
		e.preventDefault();
		if (!e.repeat) start();
	}

	$effect(() => () => {
		if (timer) clearTimeout(timer);
		if (hintTimer) clearTimeout(hintTimer);
	});
</script>

<button
	type="button"
	class="hold-confirm hold-{shape}"
	class:is-holding={holding}
	{disabled}
	title={needsHold ? 'Press and hold to confirm' : undefined}
	aria-label={needsHold ? 'Press and hold to confirm' : undefined}
	onclick={onClick}
	onpointerdown={start}
	onpointerup={cancel}
	onpointerleave={cancel}
	onpointercancel={cancel}
	onkeydown={onKeydown}
	onkeyup={cancel}
>
	<span class="hold-fill" style:transition-duration="{holding ? holdMs : 120}ms"></span>
	<span class="hold-content" class:hint-visible={showHint}>
		{#if showHint}
			<span class="hold-hint">Press and hold</span>
		{:else}
			{@render children()}
		{/if}
	</span>
</button>

<style>
	.hold-confirm {
		position: relative;
		overflow: hidden;
		display: flex;
		align-items: center;
		border: 1px solid color-mix(in srgb, var(--color-error) 38%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-error) 9%, transparent);
		color: var(--color-error);
		font-family: var(--font-ui);
		font-weight: 600;
		cursor: pointer;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		transition: border-color 140ms ease, background-color 140ms ease;
	}

	/* A row in a stacked menu: the column's full width, label on the left. */
	.hold-block {
		width: 100%;
		padding: 0.5rem 0.65rem;
		font-size: 0.8rem;
		text-align: left;
	}

	/* One action in a dialog footer. The metrics are `ui/Button` size md to the pixel
	   (px-4 py-2 / text-sm / gap-2), and the 1px border matches the ghost Cancel's own
	   transparent one, so the pair sits on a single baseline at a single height. */
	.hold-inline {
		padding: 0.5rem 1rem;
		font-size: 0.875rem;
		text-align: center;
	}
	.hold-inline .hold-content {
		justify-content: center;
		gap: 0.5rem;
		min-height: 1.25rem;
	}
	.hold-confirm:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-error) 60%, transparent);
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
	}
	.hold-confirm:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* The progress fill: it IS the countdown display, not decoration. */
	.hold-fill {
		position: absolute;
		inset: 0;
		background: color-mix(in srgb, var(--color-error) 30%, transparent);
		transform: scaleX(0);
		transform-origin: left;
		transition-property: transform;
		transition-timing-function: linear;
		pointer-events: none;
	}
	.is-holding .hold-fill {
		transform: scaleX(1);
	}

	.hold-content {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		min-height: 1.2rem;
	}

	.hold-hint {
		font-weight: 700;
		letter-spacing: 0.02em;
		animation: hold-hint-in 160ms ease;
	}
	@keyframes hold-hint-in {
		from {
			opacity: 0;
			transform: translateX(-3px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
