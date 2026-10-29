<script lang="ts">
	/**
	 * The one "Available macros" reference, rendered from the MACROS registry so it
	 * can never drift from what actually resolves. Macros are global: the same
	 * component appears in the Prompt Builder and expanded editors.
	 * Flow macros carry their availability in their group hint.
	 */
	import Icon from '#lib/components/ui/Icon.svelte';
	import Alert from './Alert.svelte';
	import { MACROS, MACRO_GROUPS } from '#lib/macros.ts';
	import { onDestroy } from 'svelte';
	import { copyText } from '#lib/utils/clipboard.ts';
	import { macroToken, matchesMacro, TEMPLATE_MACROS, type ReferenceMacro } from '#lib/utils/macro-reference.ts';

	interface Props {
		/** Dynamic per-preset control macros, rendered as their own group when provided. */
		controls?: { name: string; description: string }[];
		/** Expanded editors use the list directly inside their own dialog. */
		collapsible?: boolean;
		/** Template-only keys stay separate from the globally registered vocabulary. */
		templates?: boolean;
	}

	let { controls, collapsible = true, templates = false }: Props = $props();
	const referenceId = `macro-reference-${crypto.randomUUID()}`;
	let query = $state('');
	function descriptionId(macro: ReferenceMacro, tag?: string): string {
		return `${referenceId}-${encodeURIComponent(`${tag ?? ''}:${macro.name}`)}`;
	}

	let groups = $derived(MACRO_GROUPS.map((g) => ({
		...g,
		macros: MACROS.filter((m) => m.group === g.id && matchesMacro(m, query))
	})).filter((g) => g.macros.length > 0));
	let filteredControls = $derived(controls?.filter((macro) => matchesMacro(macro, query)) ?? []);
	let filteredTemplates = $derived(templates ? TEMPLATE_MACROS.filter((macro) => matchesMacro(macro, query)) : []);
	let resultCount = $derived(groups.reduce((count, group) => count + group.macros.length, 0)
		+ filteredControls.length + filteredTemplates.length);

	// Click-to-copy feedback: the macro name most recently copied, cleared after a beat.
	// It waits for the copy, so the tick never stands in for a clipboard that stayed empty.
	let copiedMacro = $state<string | null>(null);
	let copyError = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;
	onDestroy(() => { if (copyTimer) clearTimeout(copyTimer); });
	async function copyMacro(macro: ReferenceMacro) {
		copyError = null;
		copiedMacro = null;
		if (copyTimer) clearTimeout(copyTimer);
		const previousFocus = document.activeElement as HTMLElement | null;
		try {
			await copyText(macroToken(macro));
		} catch {
			copyError = 'Couldn’t copy the macro. Select and copy its text instead.';
			return;
		} finally {
			// The plain-HTTP clipboard fallback removes its temporary focused textarea.
			if (document.activeElement === document.body && previousFocus?.isConnected) {
				previousFocus.focus({ preventScroll: true });
			}
		}
		copiedMacro = macro.name;
		copyTimer = setTimeout(() => (copiedMacro = null), 1300);
	}
</script>

<!-- One clickable macro tile: shows the token + description, copies {{name}} on click. -->
{#snippet macroChip(macro: ReferenceMacro, tag?: string)}
	<button
		type="button"
		onclick={() => copyMacro(macro)}
		title={`Click to copy ${macroToken(macro)}`}
		aria-label={`Copy ${macroToken(macro)}`}
		aria-describedby={descriptionId(macro, tag)}
		class="group/chip relative flex flex-col items-start gap-1 text-left pl-2.5 pr-7 py-2 rounded-[var(--radius-md)] border border-border-subtle bg-bg-secondary/40 hover:border-accent/50 hover:bg-bg-secondary transition-colors"
	>
		<span class="flex items-center gap-1.5 flex-wrap">
			<code class="text-[11px] font-mono text-accent break-all">{macroToken(macro)}</code>
			{#if tag}
				<span class="shrink-0 text-[9px] uppercase tracking-wide font-ui font-semibold px-1 py-px rounded bg-bg-tertiary text-text-muted">
					{tag}
				</span>
			{/if}
		</span>
		<span id={descriptionId(macro, tag)} class="text-[11px] font-ui text-text-muted leading-snug">{macro.description}</span>
		<span
			class="absolute top-2 right-2 transition-opacity {copiedMacro === macro.name
				? 'opacity-100'
				: 'opacity-0 group-hover/chip:opacity-100'}"
		>
			<Icon
				name={copiedMacro === macro.name ? 'check' : 'copy'}
				class="w-3 h-3 {copiedMacro === macro.name ? 'text-success' : 'text-text-muted'}"
			/>
		</span>
	</button>
{/snippet}

{#if collapsible}
<details class="group/macros rounded-[var(--radius-lg)] border border-border-subtle bg-bg-secondary/30">
	<summary
		class="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden"
	>
		<Icon
			name="chevronDown"
			class="w-3.5 h-3.5 shrink-0 text-accent transition-transform -rotate-90 group-open/macros:rotate-0"
		/>
		<Icon name="sparkles" class="w-3.5 h-3.5 shrink-0 text-accent" />
		<span class="text-sm font-ui font-semibold text-text-primary">Available macros</span>
		<span class="hidden sm:inline text-xs font-ui text-text-muted">
			Click to copy · a macro resolves wherever its data exists
		</span>
	</summary>
	{@render reference()}
</details>
{:else}
	{@render reference()}
{/if}

{#snippet reference()}
<div class="macro-reference" class:macro-reference--panel={!collapsible}>
	<div class="macro-search">
		<label class="macro-search-field">
			<Icon name="search" class="w-4 h-4 shrink-0 text-text-muted" />
			<input type="search" bind:value={query} placeholder="Search macros or descriptions…" aria-label="Search macros"
				autocomplete="off" spellcheck="false" data-dialog-initial-focus />
		</label>
		<div class="macro-search-caption">
			<span>Click a macro to copy it. Edit example parameters after pasting.</span>
			<span aria-live="polite">{resultCount} {resultCount === 1 ? 'macro' : 'macros'}</span>
		</div>
		<span class="sr-only" role="status">{copiedMacro ? `Copied ${copiedMacro}` : ''}</span>
		<Alert message={copyError} />
	</div>
	<div class="macro-results panel-scroll space-y-4">
		{#if resultCount === 0}
			<p class="text-sm font-ui text-text-muted py-6 text-center">No macros match your search.</p>
		{/if}
		{#each groups as group (group.id)}
			<div class="space-y-2">
				<div class="flex items-baseline flex-wrap gap-2">
					<span class="text-xs font-ui font-semibold uppercase tracking-wide text-text-secondary">
						{group.label}
					</span>
					<span class="text-[11px] font-ui text-text-muted">{group.hint}</span>
					<span class="flex-1 border-t border-border-subtle/60"></span>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
					{#each group.macros as macro (macro.name)}
						{@render macroChip(
							macro,
							macro.structural ? 'structural' : macro.parameterized ? 'example' : undefined
						)}
					{/each}
				</div>
			</div>
		{/each}

		{#if filteredTemplates.length > 0}
			<section class="space-y-2" aria-label="Template-only macros">
				<h3 class="text-xs font-ui font-semibold uppercase tracking-wide text-text-secondary">Template-only macros</h3>
				<p class="text-[11px] font-ui text-text-muted">Each works only in the template named in its description.</p>
				<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
					{#each filteredTemplates as macro (macro.name)}
						{@render macroChip(macro, 'template only')}
					{/each}
				</div>
			</section>
		{/if}

		<!-- The preset's own control macros: dynamic, so they read as a distinct group. -->
		{#if controls && (filteredControls.length > 0 || (!query.trim() && controls.length === 0))}
			<div class="space-y-2">
				<div class="flex items-baseline flex-wrap gap-2">
					<span class="text-xs font-ui font-semibold uppercase tracking-wide text-text-secondary">
						This preset's controls
					</span>
					<span class="text-[11px] font-ui text-text-muted">widgets you wired up above</span>
					<span class="flex-1 border-t border-border-subtle/60"></span>
				</div>
				{#if filteredControls.length > 0}
					<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
						{#each filteredControls as control (control.name)}
							{@render macroChip(control, 'control')}
						{/each}
					</div>
				{:else}
					<p class="text-[11px] font-ui text-text-muted italic">
						No controls yet. Add one above to expose its macro here.
					</p>
				{/if}
			</div>
		{/if}

		<!-- The pruning rule, stated once where every macro author already looks. -->
		<p class="text-[11px] font-ui text-text-muted leading-snug border-t border-border-subtle/60 pt-2.5">
			<span class="font-semibold text-text-secondary">Empty blocks can prune themselves:</span>
			with the preset's “Prune empty blocks” toggle on, wrapping a macro in a plain tag
			(<code class="font-mono text-accent">&lt;memory&gt;{'{{memory}}'}&lt;/memory&gt;</code>) drops the whole
			block from the prompt only when its resolved content is empty after pruning child blocks.
			Written text keeps its block even when every macro is empty. Static-only blocks and unknown
			macro names are never touched.
		</p>
	</div>
</div>
{/snippet}

<style>
	.macro-reference { min-height: 0; }
	.macro-reference--panel { display: flex; flex-direction: column; flex: 1; }
	.macro-search { flex-shrink: 0; padding: 0.75rem 0.875rem; }
	.macro-search-field {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.5rem 0.65rem; border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md); background: var(--color-input-bg);
	}
	.macro-search-field:focus-within { outline: 1px solid var(--color-accent); }
	.macro-search-field input {
		width: 100%; min-width: 0; border: 0; outline: 0;
		background: transparent; color: var(--color-text-primary); font-size: 0.85rem;
	}
	.macro-search-field input::placeholder { color: var(--color-text-muted); }
	.macro-search-caption {
		display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem 0.75rem;
		margin-top: 0.5rem; color: var(--color-text-muted); font: 0.7rem var(--font-ui);
	}
	.macro-results { padding: 0.25rem 0.875rem 0.875rem; }
	.macro-reference--panel .macro-results { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
</style>
