<!--
  One reader-facing control on the Preset Controls page: a labelled card whose body is the
  widget the preset author picked (text, toggle, slider, range, …).

  The card is also where the author gets to speak. Its header carries their standing counsel
  ("recommended", "only if you hit trouble"), their help text (behind an info icon beside
  the label, or printed on the card where they asked for that) and, on the reader's side
  of the same line, whether this control has drifted from
  its baseline (the adopted setup's value where one names it, the author's default
  otherwise), with one click back. The footer prices the control in tokens, because what
  a knob costs is part of deciding whether to turn it.
-->
<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import InfoTip from '$lib/components/ui/InfoTip.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { autoResize } from '$lib/actions/autoResize';
	import { rangeReset } from '$lib/actions/rangeReset';
	import { countTokens } from '$lib/tokenizer';
	import { tokenEstimate } from '$lib/tokenizer/reactive.svelte';
	import { llmService } from '$lib/services/llm/provider';
	import {
		getControlValue,
		formatControlForPrompt,
		type RangeValue
	} from '$lib/utils/prompt-controls';
	import type { PromptControl, PromptControlAdvice } from '$lib/types/database';

	interface Props {
		control: PromptControl;
		/** Raw stored value (undefined falls back to the control default). */
		raw: unknown;
		/** Raw baseline value this card measures against: the adopted setup's, where it
		 *  names this control's macro, else undefined (the author's own default). */
		baseline?: unknown;
		onChange: (value: unknown) => void;
		/** Put the value back on the baseline. */
		onReset: () => void;
	}

	let { control, raw, baseline = undefined, onChange, onReset }: Props = $props();

	let value = $derived(getControlValue(control, raw));

	/** What "unchanged" means for this card, resolved through the same coercion as the
	 *  value: a setup captured under a since-changed control definition compares as what
	 *  it would actually show, not as its stale raw form. */
	let baselineValue = $derived(getControlValue(control, baseline));

	/** Compared as serialized values so a range's pair and a tag list compare by content. */
	let modified = $derived(JSON.stringify(value) !== JSON.stringify(baselineValue));

	// What this control actually adds to the prompt, in the model the chat is on, the same
	// text formatControlForPrompt hands the assembler, so the number is the real one.
	let tokens = $derived(tokenEstimate(() => countTokens(formatControlForPrompt(control, raw), llmService.getPrimaryModel())));

	// Worded to hold for every control type: most of these are a choice between options,
	// not a switch, so "leave this on" would be wrong on the majority of them.
	const ADVICE: Record<PromptControlAdvice, { label: string; title: string }> = {
		recommended: {
			label: 'Recommended',
			title: 'Core to how this preset works, and what it arrives on is the author’s deliberate pick.'
		},
		optional: { label: 'Optional', title: 'Taste rather than craft. Any setting here is a fine one.' },
		advanced: { label: 'Advanced', title: 'The author expects you to know what this does.' },
		troubleshooting: { label: 'If trouble', title: 'Only worth reaching for when something is going wrong.' }
	};

	let advice = $derived(control.advice ? ADVICE[control.advice] : null);

	// The author's prose, if they wrote any. Blank means blank: a control with nothing to
	// say draws neither the paragraph nor the info icon that would open on an empty bubble.
	let help = $derived(control.help?.trim() ? control.help : null);

	// --- tags -----------------------------------------------------------------------------

	let tags = $derived(value as string[]);
	let customEntry = $state('');

	/** Entries the reader typed: anything in the value that is not one of the author's options. */
	let customTags = $derived(
		control.allowCustom ? tags.filter((t) => !control.options?.some((o) => o.id === t)) : []
	);

	function toggleTag(id: string): void {
		onChange(tags.includes(id) ? tags.filter((x) => x !== id) : [...tags, id]);
	}

	function addCustomTag(): void {
		const entry = customEntry.trim();
		customEntry = '';
		if (!entry || tags.includes(entry)) return;
		onChange([...tags, entry]);
	}

	function onCustomKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		addCustomTag();
	}

	// --- range ----------------------------------------------------------------------------

	let range = $derived(value as RangeValue);
	let track = $derived({ min: control.min ?? 0, max: control.max ?? 100, step: control.step ?? 1 });

	/** Where a value sits along the track, 0–100, for the fill bar. */
	function percent(n: number): number {
		const span = track.max - track.min;
		return span <= 0 ? 0 : ((n - track.min) / span) * 100;
	}

	function setLow(n: number): void {
		onChange([Math.min(n, range[1]), range[1]]);
	}

	function setHigh(n: number): void {
		onChange([range[0], Math.max(n, range[0])]);
	}

	// With both thumbs stacked at one end, the one underneath can't be grabbed. Lift
	// whichever is in the far half so there is always a reachable thumb.
	let lowOnTop = $derived(percent(range?.[0] ?? 0) > 50);

	let selectedOption = $derived(control.options?.find((o) => o.id === value));
	/** Radio buttons grow into cards only when the author actually wrote rationales. */
	let optionsCarryReasons = $derived((control.options ?? []).some((o) => o.description));
</script>

<div class="pcf-card" class:is-modified={modified}>
	<!-- Toggles act right in the header row: no lonely switch floating in a card body. -->
	<div class="pcf-head" class:pcf-head--inline={control.type === 'toggle'}>
		<div class="pcf-head-text">
			<span class="pcf-label-row">
				<span class="pcf-label">{control.label || 'Untitled'}</span>
				<!-- Help sits next to the name it explains, and stays folded away unless the
				     author asked for it on the card. -->
				{#if help && !control.helpInline}
					<InfoTip text={help} />
				{/if}
				{#if advice}
					<span class="pcf-advice pcf-advice--{control.advice}" title={advice.title}>{advice.label}</span>
				{/if}
				{#if modified}
					<button
						type="button"
						class="pcf-reset"
						onclick={onReset}
						title={baseline === undefined
							? 'Changed from what the author set, click to put it back'
							: 'Changed from the setup you applied, click to put it back'}
					>
						<span class="pcf-reset-dot"></span>
						<span class="pcf-reset-label">Reset</span>
					</button>
				{/if}
			</span>
			{#if help && control.helpInline}
				<p class="pcf-help">{help}</p>
			{/if}
		</div>
		{#if control.type === 'toggle'}
			<Toggle checked={value as boolean} onchange={onChange} label={control.label || 'Untitled'} />
		{/if}
	</div>

	{#if control.type === 'text'}
		<input
			type="text"
			value={value as string}
			oninput={(e) => onChange((e.target as HTMLInputElement).value)}
			placeholder={control.placeholder ?? ''}
			class="input-base w-full px-4 py-2.5 text-text-primary font-ui text-sm placeholder:text-text-muted"
		/>
	{:else if control.type === 'textarea'}
		<textarea
			use:autoResize={300}
			value={value as string}
			oninput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
			placeholder={control.placeholder ?? ''}
			class="input-base w-full px-4 py-3 text-text-primary font-ui text-sm placeholder:text-text-muted resize-none min-h-[4.5rem]"
		></textarea>
	{:else if control.type === 'slider'}
		<div class="pcf-slider">
			<input
				type="range"
				min={track.min}
				max={track.max}
				step={track.step}
				value={value as number}
				aria-label={control.label || 'Untitled'}
				oninput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
				use:rangeReset={{ defaultValue: baselineValue as number, apply: (v) => onChange(v) }}
				class="flex-1 h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
			/>
			<span class="pcf-slider-value">{value}</span>
		</div>
	{:else if control.type === 'range'}
		<div class="pcf-slider">
			<div class="pcf-range" class:low-on-top={lowOnTop}>
				<span class="pcf-range-rail"></span>
				<span
					class="pcf-range-fill"
					style="left: {percent(range[0])}%; right: {100 - percent(range[1])}%"
				></span>
				<input
					type="range"
					min={track.min}
					max={track.max}
					step={track.step}
					value={range[0]}
					aria-label="{control.label || 'Untitled'}, lower end"
					oninput={(e) => setLow(Number((e.target as HTMLInputElement).value))}
				/>
				<input
					type="range"
					min={track.min}
					max={track.max}
					step={track.step}
					value={range[1]}
					aria-label="{control.label || 'Untitled'}, upper end"
					oninput={(e) => setHigh(Number((e.target as HTMLInputElement).value))}
				/>
			</div>
			<span class="pcf-slider-value">{range[0]} to {range[1]}</span>
		</div>
	{:else if control.type === 'select'}
		<Select value={value as string} onchange={(e) => onChange((e.target as HTMLSelectElement).value)} aria-label={control.label || 'Untitled'}>
			{#each control.options ?? [] as option (option.id)}
				<option value={option.id}>{option.label || 'Untitled'}</option>
			{/each}
		</Select>
		{#if selectedOption?.description}
			<p class="pcf-option-note">{selectedOption.description}</p>
		{/if}
	{:else if control.type === 'radio'}
		<div class="pcf-radios" class:pcf-radios--reasoned={optionsCarryReasons}>
			{#each control.options ?? [] as option (option.id)}
				{@const selected = value === option.id}
				<button
					type="button"
					class="pcf-radio"
					class:is-selected={selected}
					onclick={() => onChange(option.id)}
				>
					<span class="pcf-radio-label">{option.label || 'Untitled'}</span>
					{#if optionsCarryReasons}
						<span class="pcf-radio-note">{option.description ?? ''}</span>
					{/if}
				</button>
			{/each}
		</div>
	{:else if control.type === 'tags'}
		<div class="pcf-tags">
			{#each control.options ?? [] as option (option.id)}
				{@const selected = tags.includes(option.id)}
				<button
					type="button"
					class="pcf-tag"
					class:is-selected={selected}
					title={option.description}
					onclick={() => toggleTag(option.id)}
				>
					{option.label || 'Untitled'}
				</button>
			{/each}
			<!-- The reader's own entries sit in the same row as the author's suggestions,
			     because to the prompt they are the same thing. Only these can be removed. -->
			{#each customTags as entry (entry)}
				<button
					type="button"
					class="pcf-tag is-selected is-custom"
					title="Yours, click to remove"
					onclick={() => toggleTag(entry)}
				>
					{entry}
					<Icon name="close" class="w-3 h-3 flex-shrink-0 opacity-70" />
				</button>
			{/each}
		</div>
		{#if control.allowCustom}
			<div class="pcf-custom">
				<input
					type="text"
					bind:value={customEntry}
					onkeydown={onCustomKeydown}
					placeholder={control.customPlaceholder ?? 'Add your own…'}
					aria-label="Add your own entry"
					class="input-base flex-1 min-w-0 px-3 py-1.5 text-text-primary font-ui text-sm placeholder:text-text-muted"
				/>
				<button type="button" class="pcf-custom-add" onclick={addCustomTag} disabled={!customEntry.trim()}>
					Add
				</button>
			</div>
		{/if}
	{/if}

	{#if tokens === null || tokens > 0}
		<p class="pcf-cost" title="What this control adds to every prompt">
			{tokens?.toLocaleString() ?? '…'} token{tokens === 1 ? '' : 's'}
		</p>
	{/if}
</div>

<style>
	.pcf-card {
		display: flex;
		flex-direction: column;
		padding: 1rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-secondary) 92%, transparent);
		transition: border-color 140ms ease;
	}

	/* A card the reader has moved off the author's setting says so quietly, on its edge. */
	.pcf-card.is-modified {
		border-color: color-mix(in srgb, var(--color-accent) 34%, var(--color-border-subtle));
	}

	.pcf-head {
		margin-bottom: 0.5rem;
	}

	.pcf-head--inline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0;
	}

	.pcf-head-text {
		min-width: 0;
	}

	.pcf-label-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.pcf-label {
		font-family: var(--font-ui);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.pcf-advice {
		flex-shrink: 0;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-full);
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		cursor: help;
	}

	.pcf-advice--recommended {
		background: color-mix(in srgb, var(--color-success) 16%, transparent);
		color: var(--color-success);
	}

	.pcf-advice--optional {
		background: color-mix(in srgb, var(--color-text-muted) 16%, transparent);
		color: var(--color-text-muted);
	}

	.pcf-advice--advanced {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		color: var(--color-accent);
	}

	.pcf-advice--troubleshooting {
		background: color-mix(in srgb, var(--color-warning) 16%, transparent);
		color: var(--color-warning);
	}

	.pcf-reset {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-left: auto;
		padding: 0;
		border: 0;
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 140ms ease;
	}

	.pcf-reset:hover {
		color: var(--color-accent);
	}

	.pcf-reset-dot {
		width: 0.36rem;
		height: 0.36rem;
		border-radius: 9999px;
		background: var(--color-accent);
	}

	.pcf-reset-label {
		text-decoration: underline;
		text-underline-offset: 0.18em;
	}

	/* Author's prose, at the length they wrote it: a paragraph is as valid as a line. */
	.pcf-help {
		margin: 0.2rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.5;
		white-space: pre-line;
		color: var(--color-text-muted);
	}

	.pcf-slider {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.pcf-slider-value {
		min-width: 3.6rem;
		text-align: right;
		font-family: var(--font-ui);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
		font-variant-numeric: tabular-nums;
	}

	/* --- Range: two thumbs over one shared rail ---------------------------------------
	   Both inputs are transparent and stacked; only their thumbs take the pointer, so the
	   rail and the fill below stay visible through them. */
	.pcf-range {
		position: relative;
		flex: 1;
		height: 1.15rem;
		display: flex;
		align-items: center;
	}

	.pcf-range-rail,
	.pcf-range-fill {
		position: absolute;
		height: 0.5rem;
		border-radius: var(--radius-full);
		pointer-events: none;
	}

	.pcf-range-rail {
		left: 0;
		right: 0;
		background: var(--color-bg-tertiary);
	}

	.pcf-range-fill {
		background: var(--color-accent);
	}

	.pcf-range input {
		position: absolute;
		left: 0;
		width: 100%;
		height: 1.15rem;
		margin: 0;
		background: transparent;
		appearance: none;
		pointer-events: none;
	}

	.pcf-range input::-webkit-slider-thumb {
		appearance: none;
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--color-bg-primary);
		border-radius: 9999px;
		background: var(--color-accent);
		box-shadow: var(--shadow-sm);
		cursor: grab;
		pointer-events: auto;
	}

	.pcf-range input::-moz-range-thumb {
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--color-bg-primary);
		border-radius: 9999px;
		background: var(--color-accent);
		cursor: grab;
		pointer-events: auto;
	}

	/* Stacking order follows the thumbs: whichever ran into the far half comes forward,
	   so two thumbs sitting on the same value never trap each other. */
	.pcf-range input:first-of-type {
		z-index: 1;
	}

	.pcf-range.low-on-top input:first-of-type {
		z-index: 3;
	}

	.pcf-range input:last-of-type {
		z-index: 2;
	}

	/* --- Options ---------------------------------------------------------------------- */

	.pcf-option-note {
		margin: 0.45rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	.pcf-radios {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	/* Once the author has said why each option exists, the options need room to say it:
	   a row of pills with paragraphs in them is unreadable, so they become a column. */
	.pcf-radios--reasoned {
		flex-direction: column;
		flex-wrap: nowrap;
	}

	.pcf-radio {
		flex: 1;
		min-width: 6rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.62rem 1rem;
		border: 1px solid transparent;
		border-radius: var(--radius-lg);
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		text-align: left;
		cursor: pointer;
		transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
	}

	.pcf-radios:not(.pcf-radios--reasoned) .pcf-radio {
		align-items: center;
		text-align: center;
	}

	.pcf-radio:hover {
		color: var(--color-text-primary);
	}

	.pcf-radio.is-selected {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		color: var(--color-accent);
	}

	.pcf-radio-label {
		font-size: 0.85rem;
		font-weight: 500;
	}

	.pcf-radio-note {
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--color-text-muted);
	}

	.pcf-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.pcf-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.62rem;
		border: 1px solid transparent;
		border-radius: var(--radius-full);
		background: var(--color-bg-tertiary);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
	}

	.pcf-tag:hover {
		color: var(--color-text-primary);
	}

	.pcf-tag.is-selected {
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		color: var(--color-accent);
	}

	.pcf-tag.is-custom {
		border-style: dashed;
	}

	.pcf-custom {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.pcf-custom-add {
		flex-shrink: 0;
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: background-color 140ms ease, color 140ms ease;
	}

	.pcf-custom-add:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.pcf-custom-add:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.pcf-cost {
		margin: 0.6rem 0 0;
		text-align: right;
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		cursor: help;
	}
</style>
