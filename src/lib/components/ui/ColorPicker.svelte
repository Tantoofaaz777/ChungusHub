<script lang="ts">
	/**
	 * Compact HSV color picker panel: saturation/value pad, hue rail, hex field.
	 * Pure panel: the caller owns the popover (anchor, click-away, Escape).
	 * Emits a #rrggbb hex on every change.
	 */
	interface Props {
		value: string;
		oninput: (hex: string) => void;
	}

	let { value, oninput }: Props = $props();

	let h = $state(20);
	let s = $state(0.5);
	let v = $state(0.8);
	let hexField = $state('');
	let lastEmitted = '';
	let padEl = $state<HTMLDivElement | undefined>(undefined);

	const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

	function hsvToHex(h: number, s: number, v: number): string {
		const f = (n: number) => {
			const k = (n + h / 60) % 6;
			const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
			return Math.round(c * 255)
				.toString(16)
				.padStart(2, '0');
		};
		return `#${f(5)}${f(3)}${f(1)}`;
	}

	function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
		const m = HEX_RE.exec(hex);
		if (!m) return null;
		const r = parseInt(m[1].slice(0, 2), 16) / 255;
		const g = parseInt(m[1].slice(2, 4), 16) / 255;
		const b = parseInt(m[1].slice(4, 6), 16) / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		let hue = 0;
		if (d > 0) {
			if (max === r) hue = 60 * (((g - b) / d) % 6);
			else if (max === g) hue = 60 * ((b - r) / d + 2);
			else hue = 60 * ((r - g) / d + 4);
		}
		if (hue < 0) hue += 360;
		return { h: hue, s: max === 0 ? 0 : d / max, v: max };
	}

	// Follow external value changes (e.g. reset elsewhere) without fighting our own emits.
	$effect(() => {
		if (value === lastEmitted) return;
		const parsed = hexToHsv(value);
		if (parsed) {
			h = parsed.h;
			s = parsed.s;
			v = parsed.v;
			hexField = value.toLowerCase();
			lastEmitted = value;
		}
	});

	function emit() {
		const hex = hsvToHex(h, s, v);
		hexField = hex;
		lastEmitted = hex;
		oninput(hex);
	}

	function handlePadPointer(event: PointerEvent) {
		if (!padEl) return;
		const rect = padEl.getBoundingClientRect();
		s = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
		v = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
		emit();
	}

	function handlePadDown(event: PointerEvent) {
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		handlePadPointer(event);
	}

	function handlePadMove(event: PointerEvent) {
		if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
			handlePadPointer(event);
		}
	}

	function handleHue(event: Event) {
		h = Number((event.target as HTMLInputElement).value);
		emit();
	}

	function handleHexInput(event: Event) {
		const raw = (event.target as HTMLInputElement).value.trim();
		hexField = raw;
		const m = HEX_RE.exec(raw);
		if (!m) return;
		const hex = `#${m[1].toLowerCase()}`;
		const parsed = hexToHsv(hex);
		if (!parsed) return;
		h = parsed.h;
		s = parsed.s;
		v = parsed.v;
		lastEmitted = hex;
		oninput(hex);
	}

	const current = $derived(hsvToHex(h, s, v));
</script>

<div class="picker" role="group" aria-label="Custom color">
	<div
		class="pad"
		bind:this={padEl}
		role="slider"
		aria-label="Saturation and brightness"
		aria-valuenow={Math.round(v * 100)}
		tabindex="0"
		style="background:
			linear-gradient(to top, #000, transparent),
			linear-gradient(to right, #fff, hsl({h} 100% 50%))"
		onpointerdown={handlePadDown}
		onpointermove={handlePadMove}
	>
		<span
			class="pad-dot"
			style="left: {s * 100}%; top: {(1 - v) * 100}%; background: {current}"
		></span>
	</div>

	<input
		class="hue"
		type="range"
		min="0"
		max="360"
		step="1"
		value={h}
		aria-label="Hue"
		oninput={handleHue}
	/>

	<div class="row">
		<span class="swatch" style="background: {current}"></span>
		<input
			class="hex input-base"
			type="text"
			spellcheck="false"
			maxlength="7"
			value={hexField}
			aria-label="Hex color"
			oninput={handleHexInput}
		/>
	</div>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: 13.5rem;
		max-width: 100%;
	}

	.pad {
		position: relative;
		height: 8.5rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		cursor: crosshair;
		touch-action: none;
	}

	.pad-dot {
		position: absolute;
		width: 0.85rem;
		height: 0.85rem;
		border-radius: var(--radius-full);
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 45%);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.hue {
		height: 0.7rem;
		border-radius: var(--radius-full);
		appearance: none;
		-webkit-appearance: none;
		background: linear-gradient(
			to right,
			#f00 0%,
			#ff0 17%,
			#0f0 33%,
			#0ff 50%,
			#00f 67%,
			#f0f 83%,
			#f00 100%
		);
		cursor: pointer;
	}

	.hue::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 1rem;
		height: 1rem;
		border-radius: var(--radius-full);
		background: transparent;
		border: 2.5px solid #fff;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 45%);
	}

	.hue::-moz-range-thumb {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: var(--radius-full);
		background: transparent;
		border: 2.5px solid #fff;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 45%);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.swatch {
		flex-shrink: 0;
		width: 1.8rem;
		height: 1.8rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
	}

	.hex {
		flex: 1;
		min-width: 0;
		height: 1.8rem;
		padding: 0 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--color-text-primary);
	}
</style>
