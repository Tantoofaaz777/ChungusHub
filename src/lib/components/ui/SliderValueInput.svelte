<script lang="ts">
	import { parseSliderValue } from '#lib/utils/slider-value.ts';

	let { id, value, min, max, step = 1, groupedInteger = false, label, onchange }: {
		id?: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		groupedInteger?: boolean;
		label: string;
		onchange: (value: number) => void;
	} = $props();
	let editing = $state(false);
	let draft = $state('');
	const precision = $derived(String(step).split('.')[1]?.length ?? 0);
	const formatted = $derived(groupedInteger ? value.toLocaleString() : value.toFixed(precision));

	function commit() {
		const next = parseSliderValue(draft, min, max, step, groupedInteger);
		editing = false;
		if (next !== null && next !== value) onchange(next);
	}
</script>

<input
	{id}
	type="text"
	inputmode={step < 1 ? 'decimal' : 'numeric'}
	class="slider-number input-base"
	aria-label={label}
	title="Type a value; press Enter or leave the field to apply"
	value={editing ? draft : formatted}
	onfocus={() => { draft = formatted; editing = true; }}
	oninput={(event) => (draft = event.currentTarget.value)}
	onblur={commit}
	onkeydown={(event) => {
		if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			draft = String(value);
			event.currentTarget.blur();
		}
	}}
/>

<style>
	.slider-number {
		width: 100%;
		min-width: 0;
		min-height: 2.4rem;
		padding: 0.4rem 0.65rem;
		border-radius: var(--radius-md);
		text-align: center;
		font-family: var(--font-mono);
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary);
	}
	@media (pointer: coarse) { .slider-number { min-height: 2.75rem; font-size: 1rem; } }
</style>
