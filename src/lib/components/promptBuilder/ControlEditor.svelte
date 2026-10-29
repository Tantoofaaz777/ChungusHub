<!--
  Editor body for one custom control, rendered inside a Prompt Builder row. It
  measures its own width (.ce is a container): field pairs sit side by side with
  room and stack in a tight dock, so nothing ever cramps at 360px.
-->
<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import { autoResize } from '#lib/actions/autoResize.ts';
	import type {
		PromptControl,
		PromptControlAdvice,
		PromptControlType,
		PromptControlOption,
		PromptSection
	} from '#lib/types/database.ts';

	interface Props {
		control: PromptControl;
		macroError?: string;
		/** The preset's declared sections, offered as suggestions for this control's home. */
		sections?: PromptSection[];
		onChange: (control: PromptControl) => void;
	}

	let { control, macroError, sections = [], onChange }: Props = $props();

	const typeOptions: { id: PromptControlType; label: string }[] = [
		{ id: 'text', label: 'Text (single line)' },
		{ id: 'textarea', label: 'Text (multi-line)' },
		{ id: 'toggle', label: 'Toggle (on/off)' },
		{ id: 'slider', label: 'Slider (number)' },
		{ id: 'range', label: 'Range (two numbers)' },
		{ id: 'select', label: 'Select (dropdown)' },
		{ id: 'radio', label: 'Radio (buttons)' },
		{ id: 'tags', label: 'Tags (many of)' }
	];

	const adviceOptions: { id: PromptControlAdvice | ''; label: string }[] = [
		{ id: '', label: 'No badge' },
		{ id: 'recommended', label: 'Recommended' },
		{ id: 'optional', label: 'Optional' },
		{ id: 'advanced', label: 'Advanced' },
		{ id: 'troubleshooting', label: 'Only if trouble' }
	];

	function update(patch: Partial<PromptControl>): void {
		onChange({ ...control, ...patch });
	}

	// A range moves along the slider's own track; only its ends and its template differ.
	let rangeDefault = $derived(control.defaultRange ?? [control.min ?? 0, control.max ?? 100]);

	function setRangeEnd(index: 0 | 1, value: number): void {
		const next: [number, number] = [...rangeDefault] as [number, number];
		next[index] = value;
		update({ defaultRange: next });
	}

	/** Macro names allow letters, digits and underscores only. Case is preserved: every reader
	 *  of a macro name matches it verbatim, so folding case here would silently rename the
	 *  control and cut it loose from the items that reference it. */
	function onMacroInput(value: string): void {
		update({ macro: value.replace(/[^A-Za-z0-9_]/g, '') });
	}

	function setOptions(options: PromptControlOption[]): void {
		update({ options });
	}

	function addOption(): void {
		const option: PromptControlOption = { id: crypto.randomUUID(), label: '', injectedText: '' };
		setOptions([...(control.options ?? []), option]);
	}

	function updateOption(id: string, patch: Partial<PromptControlOption>): void {
		setOptions((control.options ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)));
	}

	function removeOption(id: string): void {
		const next = (control.options ?? []).filter((o) => o.id !== id);
		// Clear defaults that pointed at the removed option.
		const patch: Partial<PromptControl> = { options: next };
		if (control.defaultOptionId === id) patch.defaultOptionId = '';
		if (control.defaultOptionIds?.includes(id)) {
			patch.defaultOptionIds = control.defaultOptionIds.filter((x) => x !== id);
		}
		update(patch);
	}

	function toggleDefaultTag(id: string): void {
		const current = control.defaultOptionIds ?? [];
		update({
			defaultOptionIds: current.includes(id)
				? current.filter((x) => x !== id)
				: [...current, id]
		});
	}
</script>

<div class="ce">
	<div class="ce-grid">
		<!-- Label -->
		<div class="ce-field">
			<label for="ctrl-label-{control.id}" class="ce-label">Label</label>
			<input
				id="ctrl-label-{control.id}"
				type="text"
				value={control.label}
				oninput={(e) => update({ label: (e.target as HTMLInputElement).value })}
				placeholder="Shown in Preset Controls"
				class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm"
			/>
		</div>

		<!-- Macro -->
		<div class="ce-field">
			<label for="ctrl-macro-{control.id}" class="ce-label">Macro</label>
			<div class="ce-macro-row">
				<span class="ce-brace">{'{{'}</span>
				<input
					id="ctrl-macro-{control.id}"
					type="text"
					value={control.macro}
					oninput={(e) => onMacroInput((e.target as HTMLInputElement).value)}
					placeholder="my_field"
					class="input-base flex-1 min-w-0 px-3 py-2 text-text-primary font-mono text-sm {macroError ? '!border-error' : ''}"
				/>
				<span class="ce-brace">{'}}'}</span>
			</div>
			{#if macroError}
				<p class="ce-error">{macroError}</p>
			{/if}
		</div>

		<!-- Type -->
		<div class="ce-field">
			<label for="ctrl-type-{control.id}" class="ce-label">Type</label>
			<Select
				id="ctrl-type-{control.id}"
				value={control.type}
				onchange={(e) => update({ type: (e.target as HTMLSelectElement).value as PromptControlType })}
				class="!px-3 !py-2 !text-sm"
			>
				{#each typeOptions as opt}
					<option value={opt.id}>{opt.label}</option>
				{/each}
			</Select>
		</div>

		<!-- Section. Free text with the declared sections offered: type a new name and the
		     control lands in an ad-hoc group, pick a declared one and it joins that section. -->
		<div class="ce-field">
			<label for="ctrl-group-{control.id}" class="ce-label">Section <span class="ce-optional">(optional)</span></label>
			<input
				id="ctrl-group-{control.id}"
				type="text"
				list="ctrl-sections-{control.id}"
				value={control.group ?? ''}
				oninput={(e) => update({ group: (e.target as HTMLInputElement).value })}
				placeholder="Heading in Preset Controls"
				class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm"
			/>
			<datalist id="ctrl-sections-{control.id}">
				{#each sections as section (section.id)}
					<option value={section.id}>{section.title}</option>
				{/each}
			</datalist>
		</div>
	</div>

	<!-- Help. Multi-line: what an author wants to say is usually a paragraph, and the
	     reader's card keeps the line breaks. -->
	<div class="ce-field">
		<label for="ctrl-help-{control.id}" class="ce-label">Help text <span class="ce-optional">(optional)</span></label>
		<textarea
			id="ctrl-help-{control.id}"
			value={control.help ?? ''}
			oninput={(e) => update({ help: (e.target as HTMLTextAreaElement).value })}
			use:autoResize={220}
			placeholder="Explain what this does for the reader, a sentence or a paragraph"
			class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm resize-none"
		></textarea>
		<!-- Where it is read. Folded away by default, so a section of cards stays scannable
		     however much every author wrote; switched on for the one control whose prose a
		     reader has to meet before they touch it. Offered only once there is prose. -->
		{#if control.help?.trim()}
			<div class="ce-inline">
				<span class="ce-label">Show it on the card</span>
				<Toggle
					checked={control.helpInline ?? false}
					onchange={(v) => update({ helpInline: v || undefined })}
					label="Show the help text on the card"
				/>
			</div>
			<p class="ce-note">Off, it hides behind an info icon beside the label.</p>
		{/if}
	</div>

	<!-- Standing counsel. The badge readers see beside the label. -->
	<div class="ce-field">
		<label for="ctrl-advice-{control.id}" class="ce-label">Advice badge</label>
		<Select
			id="ctrl-advice-{control.id}"
			value={control.advice ?? ''}
			onchange={(e) => {
				const picked = (e.target as HTMLSelectElement).value;
				update({ advice: picked ? (picked as PromptControlAdvice) : undefined });
			}}
			class="!px-3 !py-2 !text-sm"
		>
			{#each adviceOptions as opt}
				<option value={opt.id}>{opt.label}</option>
			{/each}
		</Select>
	</div>

	<!-- Type-specific settings -->
	{#if control.type === 'text' || control.type === 'textarea'}
		<div class="ce-grid">
			<div class="ce-field">
				<label for="ctrl-default-{control.id}" class="ce-label">Default value</label>
				<input
					id="ctrl-default-{control.id}"
					type="text"
					value={control.defaultText ?? ''}
					oninput={(e) => update({ defaultText: (e.target as HTMLInputElement).value })}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm"
				/>
			</div>
			<div class="ce-field">
				<label for="ctrl-ph-{control.id}" class="ce-label">Placeholder</label>
				<input
					id="ctrl-ph-{control.id}"
					type="text"
					value={control.placeholder ?? ''}
					oninput={(e) => update({ placeholder: (e.target as HTMLInputElement).value })}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm"
				/>
			</div>
		</div>
		<div class="ce-field">
			<label for="ctrl-texttmpl-{control.id}" class="ce-label">Inject template <span class="ce-optional">(optional)</span></label>
			<input
				id="ctrl-texttmpl-{control.id}"
				type="text"
				value={control.textTemplate ?? ''}
				oninput={(e) => update({ textTemplate: (e.target as HTMLInputElement).value })}
				placeholder={'e.g. Extra rules: {{value}}  (empty = inject the text as-is)'}
				class="input-base w-full px-3 py-2 text-text-primary font-mono text-sm"
			/>
			<p class="ce-note">
				Use <code class="text-accent">{'{{value}}'}</code> where the reader's text should appear.
				Applied only when they typed something, so an empty field injects nothing and the framing never dangles.
			</p>
		</div>
	{:else if control.type === 'toggle'}
		<div class="ce-inline">
			<span class="ce-label">Default</span>
			<Toggle checked={control.defaultOn ?? false} onchange={(v) => update({ defaultOn: v })} label="Default state" />
			<span class="ce-note">{control.defaultOn ? 'On' : 'Off'}</span>
		</div>
		<div class="ce-grid">
			<div class="ce-field">
				<label for="ctrl-onText-{control.id}" class="ce-label">Inject when ON</label>
				<textarea
					id="ctrl-onText-{control.id}"
					value={control.onText ?? ''}
					oninput={(e) => update({ onText: (e.target as HTMLTextAreaElement).value })}
					use:autoResize={200}
					placeholder="Text added to the prompt when on"
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm resize-none"
				></textarea>
			</div>
			<div class="ce-field">
				<label for="ctrl-offText-{control.id}" class="ce-label">Inject when OFF</label>
				<textarea
					id="ctrl-offText-{control.id}"
					value={control.offText ?? ''}
					oninput={(e) => update({ offText: (e.target as HTMLTextAreaElement).value })}
					use:autoResize={200}
					placeholder="Usually left empty"
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm resize-none"
				></textarea>
			</div>
		</div>
	{:else if control.type === 'slider'}
		<div class="ce-grid ce-grid--nums">
			<div class="ce-field">
				<label for="ctrl-min-{control.id}" class="ce-label">Min</label>
				<input id="ctrl-min-{control.id}" type="number" value={control.min ?? 0}
					oninput={(e) => update({ min: Number((e.target as HTMLInputElement).value) })}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm" />
			</div>
			<div class="ce-field">
				<label for="ctrl-max-{control.id}" class="ce-label">Max</label>
				<input id="ctrl-max-{control.id}" type="number" value={control.max ?? 100}
					oninput={(e) => update({ max: Number((e.target as HTMLInputElement).value) })}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm" />
			</div>
			<div class="ce-field">
				<label for="ctrl-step-{control.id}" class="ce-label">Step</label>
				<input id="ctrl-step-{control.id}" type="number" value={control.step ?? 1}
					oninput={(e) => update({ step: Number((e.target as HTMLInputElement).value) })}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm" />
			</div>
			<div class="ce-field">
				<label for="ctrl-defnum-{control.id}" class="ce-label">Default</label>
				<input id="ctrl-defnum-{control.id}" type="number" value={control.defaultNumber ?? control.min ?? 0}
					oninput={(e) => update({ defaultNumber: Number((e.target as HTMLInputElement).value) })}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm" />
			</div>
		</div>
		<div class="ce-field">
			<label for="ctrl-tmpl-{control.id}" class="ce-label">Inject template</label>
			<input
				id="ctrl-tmpl-{control.id}"
				type="text"
				value={control.sliderTemplate ?? ''}
				oninput={(e) => update({ sliderTemplate: (e.target as HTMLInputElement).value })}
				placeholder={'e.g. Spice level: {{value}}/10  (empty = inject the raw number)'}
				class="input-base w-full px-3 py-2 text-text-primary font-mono text-sm"
			/>
			<p class="ce-note">Use <code class="text-accent">{'{{value}}'}</code> where the number should appear.</p>
		</div>
	{:else if control.type === 'range'}
		<div class="ce-grid ce-grid--nums">
			<div class="ce-field">
				<label for="ctrl-rmin-{control.id}" class="ce-label">Track min</label>
				<input id="ctrl-rmin-{control.id}" type="number" value={control.min ?? 0}
					oninput={(e) => update({ min: Number((e.target as HTMLInputElement).value) })}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm" />
			</div>
			<div class="ce-field">
				<label for="ctrl-rmax-{control.id}" class="ce-label">Track max</label>
				<input id="ctrl-rmax-{control.id}" type="number" value={control.max ?? 100}
					oninput={(e) => update({ max: Number((e.target as HTMLInputElement).value) })}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm" />
			</div>
			<div class="ce-field">
				<label for="ctrl-rlow-{control.id}" class="ce-label">Starts at</label>
				<input id="ctrl-rlow-{control.id}" type="number" value={rangeDefault[0]}
					oninput={(e) => setRangeEnd(0, Number((e.target as HTMLInputElement).value))}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm" />
			</div>
			<div class="ce-field">
				<label for="ctrl-rhigh-{control.id}" class="ce-label">…up to</label>
				<input id="ctrl-rhigh-{control.id}" type="number" value={rangeDefault[1]}
					oninput={(e) => setRangeEnd(1, Number((e.target as HTMLInputElement).value))}
					class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm" />
			</div>
		</div>
		<div class="ce-field">
			<label for="ctrl-rstep-{control.id}" class="ce-label">Step</label>
			<input id="ctrl-rstep-{control.id}" type="number" value={control.step ?? 1}
				oninput={(e) => update({ step: Number((e.target as HTMLInputElement).value) })}
				class="input-base w-40 px-3 py-2 text-text-primary font-ui text-sm" />
		</div>
		<div class="ce-field">
			<label for="ctrl-rtmpl-{control.id}" class="ce-label">Inject template</label>
			<input
				id="ctrl-rtmpl-{control.id}"
				type="text"
				value={control.rangeTemplate ?? ''}
				oninput={(e) => update({ rangeTemplate: (e.target as HTMLInputElement).value })}
				placeholder={'e.g. Write between {{min}} and {{max}} words.  (empty = "min to max")'}
				class="input-base w-full px-3 py-2 text-text-primary font-mono text-sm"
			/>
			<p class="ce-note">
				Use <code class="text-accent">{'{{min}}'}</code> and <code class="text-accent">{'{{max}}'}</code>
				for the two ends the reader picked.
			</p>
		</div>
	{:else if control.type === 'select' || control.type === 'radio' || control.type === 'tags'}
		<div class="ce-field">
			<div class="ce-inline ce-inline--between">
				<span class="ce-label">Options</span>
				<button type="button" class="ce-add-option" onclick={addOption}>+ Add option</button>
			</div>
			{#if control.type === 'tags'}
				<div class="ce-field">
					<label for="ctrl-sep-{control.id}" class="ce-note">Separator between selected texts</label>
					<input id="ctrl-sep-{control.id}" type="text" value={control.tagSeparator ?? ', '}
						oninput={(e) => update({ tagSeparator: (e.target as HTMLInputElement).value })}
						class="input-base w-40 px-3 py-2 text-text-primary font-ui text-sm" />
				</div>
				<!-- Your list and theirs in one control: suggest the twenty-five you'd ban,
				     and let them add the one that keeps ruining their story. -->
				<div class="ce-inline">
					<span class="ce-label">Let readers add their own</span>
					<Toggle
						checked={control.allowCustom ?? false}
						onchange={(v) => update({ allowCustom: v })}
						label="Allow custom entries"
					/>
				</div>
				{#if control.allowCustom}
					<div class="ce-field">
						<label for="ctrl-custph-{control.id}" class="ce-note">Placeholder for their field</label>
						<input id="ctrl-custph-{control.id}" type="text" value={control.customPlaceholder ?? ''}
							oninput={(e) => update({ customPlaceholder: (e.target as HTMLInputElement).value })}
							placeholder="Add your own…"
							class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm" />
						<p class="ce-note">
							What they type is injected exactly as written, alongside your options' texts.
						</p>
					</div>
				{/if}
			{/if}
			{#if (control.options ?? []).length === 0}
				<p class="ce-note ce-note--italic">No options yet.</p>
			{:else}
				<div class="ce-options">
					{#each control.options ?? [] as option (option.id)}
						<div class="ce-option">
							<!-- Default marker -->
							{#if control.type === 'select' || control.type === 'radio'}
								<button
									type="button"
									title="Make default"
									onclick={() => update({ defaultOptionId: option.id })}
									class="ce-default-radio {control.defaultOptionId === option.id ? 'is-default' : ''}"
								>
									{#if control.defaultOptionId === option.id}
										<span class="ce-default-dot"></span>
									{/if}
								</button>
							{:else}
								<button
									type="button"
									title="Selected by default"
									onclick={() => toggleDefaultTag(option.id)}
									class="ce-default-tag {control.defaultOptionIds?.includes(option.id) ? 'is-default' : ''}"
								>
									<Icon name={control.defaultOptionIds?.includes(option.id) ? 'check' : 'plus'} class="w-4 h-4" />
								</button>
							{/if}
							<div class="ce-option-inputs">
								<input
									type="text"
									value={option.label}
									oninput={(e) => updateOption(option.id, { label: (e.target as HTMLInputElement).value })}
									placeholder="Label (shown)"
									class="input-base w-full px-2.5 py-1.5 text-text-primary font-ui text-sm"
								/>
								<input
									type="text"
									value={option.injectedText}
									oninput={(e) => updateOption(option.id, { injectedText: (e.target as HTMLInputElement).value })}
									placeholder="Injected into prompt"
									class="input-base w-full px-2.5 py-1.5 text-text-primary font-ui text-sm"
								/>
								<!-- Why a reader would pick this one. Never reaches the prompt; it is the
								     sentence that turns four names in a list into a real choice. -->
								<input
									type="text"
									value={option.description ?? ''}
									oninput={(e) => updateOption(option.id, { description: (e.target as HTMLInputElement).value })}
									placeholder="Why pick this one? (shown to the reader, never sent)"
									class="input-base w-full px-2.5 py-1.5 text-text-primary font-ui text-sm ce-option-why"
								/>
							</div>
							<button type="button" class="ce-option-del" title="Remove option" aria-label="Remove option" onclick={() => removeOption(option.id)}>
								<Icon name="trash" class="w-4 h-4" strokeWidth={1.5} />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* Self-measuring: the editor stacks or pairs its fields by its own width, so it
	   behaves in the dock, the overlay and any future host without viewport lies. */
	.ce {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.ce-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}

	/* Min/Max/Step/Default: 2×2 in a tight dock, one row with room. */
	.ce-grid--nums {
		grid-template-columns: 1fr 1fr;
	}

	@container (min-width: 420px) {
		.ce-grid {
			grid-template-columns: 1fr 1fr;
		}

		.ce-grid--nums {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.ce-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.ce-label {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.ce-optional {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.ce-macro-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.ce-brace {
		font-family: var(--font-mono);
		font-size: 0.82rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.ce-error {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--color-error);
	}

	.ce-note {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	.ce-note--italic {
		font-style: italic;
	}

	.ce-inline {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}

	.ce-inline--between {
		justify-content: space-between;
	}

	.ce-add-option {
		padding: 0;
		border: 0;
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-accent);
		cursor: pointer;
	}

	.ce-add-option:hover {
		text-decoration: underline;
		text-underline-offset: 0.18em;
	}

	.ce-options {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ce-option {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.5rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 84%, transparent);
	}

	/* Label + injected text stack in a tight dock, pair with room. */
	.ce-option-inputs {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.5rem;
	}

	@container (min-width: 460px) {
		.ce-option-inputs {
			grid-template-columns: 1fr 1fr;
		}

		/* The rationale is a sentence, not a field pair, so it gets the whole row. */
		.ce-option-why {
			grid-column: 1 / -1;
		}
	}

	.ce-default-radio {
		margin-top: 0.55rem;
		flex-shrink: 0;
		width: 1rem;
		height: 1rem;
		padding: 0;
		border-radius: 9999px;
		border: 1px solid var(--color-border);
		background: transparent;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: border-color 120ms ease, background-color 120ms ease;
	}

	.ce-default-radio.is-default {
		border-color: var(--color-accent);
		background: var(--color-accent);
	}

	.ce-default-dot {
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 9999px;
		background: var(--color-on-accent);
	}

	.ce-default-tag {
		margin-top: 0.45rem;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease;
	}

	.ce-default-tag:hover {
		color: var(--color-text-secondary);
	}

	.ce-default-tag.is-default {
		color: var(--color-accent);
	}

	.ce-option-del {
		margin-top: 0.35rem;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease, background-color 120ms ease;
	}

	.ce-option-del:hover {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
	}
</style>
