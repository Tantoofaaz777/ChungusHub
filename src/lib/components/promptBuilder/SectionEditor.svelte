<!--
  Editor body for one section, rendered inside a Prompt Builder row, the same split as
  ControlEditor: the view owns the row anatomy and the drag, this owns the fields.

  The key is deliberately read-only. Controls point at it by name, so renaming it would cut
  every one of them loose at once with nothing to warn anybody; the title is the part that
  is meant to be edited, and it can say anything.
-->
<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import { SECTION_ICONS, isSectionIcon } from '#lib/config/section-icons.ts';
	import type { PromptSection } from '#lib/types/database.ts';

	interface Props {
		section: PromptSection;
		/** How many controls actually name this section. Zero means it never renders. */
		used: number;
		onChange: (section: PromptSection) => void;
	}

	let { section, used, onChange }: Props = $props();

	function update(patch: Partial<PromptSection>): void {
		onChange({ ...section, ...patch });
	}
</script>

<div class="se">
	<div class="se-grid">
		<div class="se-field">
			<label for="sec-title-{section.id}" class="se-label">Title</label>
			<input
				id="sec-title-{section.id}"
				type="text"
				value={section.title}
				oninput={(e) => update({ title: (e.target as HTMLInputElement).value })}
				placeholder="Shown as the heading"
				class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm"
			/>
		</div>
		<div class="se-field">
			<label for="sec-key-{section.id}" class="se-label">
				Key <span class="se-optional">(what controls name)</span>
			</label>
			<input
				id="sec-key-{section.id}"
				type="text"
				value={section.id}
				readonly
				title="Controls point at this. Renaming it would cut them all loose at once, so it is fixed once created."
				class="input-base w-full px-3 py-2 text-text-muted font-mono text-sm"
			/>
		</div>
	</div>

	<div class="se-field">
		<label for="sec-note-{section.id}" class="se-label">Note <span class="se-optional">(optional)</span></label>
		<input
			id="sec-note-{section.id}"
			type="text"
			value={section.description ?? ''}
			oninput={(e) => update({ description: (e.target as HTMLInputElement).value || undefined })}
			placeholder="One sentence under the heading"
			class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm"
		/>
	</div>

	<div class="se-field">
		<span class="se-label">Icon</span>
		<div class="se-icons">
			<button
				type="button"
				class="se-icon"
				class:is-picked={!isSectionIcon(section.icon)}
				title="No icon"
				aria-label="No icon"
				onclick={() => update({ icon: undefined })}
			>
				<Icon name="close" class="w-4 h-4" strokeWidth={1.5} />
			</button>
			{#each SECTION_ICONS as name (name)}
				<button
					type="button"
					class="se-icon"
					class:is-picked={section.icon === name}
					title={name}
					aria-label={name}
					onclick={() => update({ icon: name })}
				>
					<Icon {name} class="w-4 h-4" strokeWidth={1.5} />
				</button>
			{/each}
		</div>
	</div>

	<div class="se-inline">
		<div class="se-inline-text">
			<span class="se-label">Starts folded</span>
			<p class="se-note">
				For a section a reader should only open on purpose. They can fold and unfold
				whatever they like afterwards, and this only decides where it starts.
			</p>
		</div>
		<Toggle
			checked={section.collapsed ?? false}
			onchange={(v) => update({ collapsed: v || undefined })}
			label="Starts folded"
		/>
	</div>

	{#if used === 0}
		<p class="se-warn">
			<Icon name="warning" class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
			<span>
				No control names “{section.id}” yet, so this heading doesn't appear for readers.
				Set a control's Section to this key.
			</span>
		</p>
	{/if}
</div>

<style>
	.se {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.se-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}

	@container builder (min-width: 430px) {
		.se-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.se-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.se-label {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.se-optional {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.se-icons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.se-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.85rem;
		height: 1.85rem;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.se-icon:hover {
		color: var(--color-text-primary);
	}

	.se-icon.is-picked {
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		color: var(--color-accent);
	}

	.se-inline {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.se-inline-text {
		flex: 1;
		min-width: 0;
	}

	.se-note {
		margin: 0.15rem 0 0;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	.se-warn {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--color-warning);
	}
</style>
