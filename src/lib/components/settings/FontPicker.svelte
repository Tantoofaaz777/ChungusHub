<script lang="ts">
	import Select from '$lib/components/ui/Select.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';

	let { id, field }: { id: string; field: 'bodyFont' | 'uiFont' } = $props();
	let importing = $state(false);
	let family = $state('');
	let busy = $state(false);
	let error = $state('');
	const custom = '__google_fonts__';
	let options = $derived(field === 'bodyFont' ? themeStore.bodyFonts : themeStore.uiFonts);
	let selected = $derived(themeStore.appearance[field]);
	let removable = $derived(themeStore.customFonts.some(font => font.id === selected));

	async function add() {
		if (busy || !family.trim()) return;
		busy = true;
		error = '';
		try {
			const fontId = await themeStore.addFont(family);
			themeStore.update({ [field]: fontId });
			importing = false;
			family = '';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not import this font.';
		} finally { busy = false; }
	}

	async function remove() {
		busy = true;
		error = '';
		try { await themeStore.removeFont(selected); }
		catch (e) { error = e instanceof Error ? e.message : 'Could not remove this font.'; }
		finally { busy = false; }
	}
</script>

<div class="font-picker">
	<div class="selection">
		<Select {id} variant="compact" class="w-full" disabled={busy}
			value={importing ? custom : selected}
			onchange={(event) => {
				const value = (event.target as HTMLSelectElement).value;
				importing = value === custom;
				error = '';
				if (!importing) themeStore.update({ [field]: value });
			}}>
			{#each options as font (font.id)}
				<option value={font.id}>{font.label}</option>
			{/each}
			<option value={custom}>Custom: Google Fonts</option>
		</Select>
		{#if removable && !importing}
			<button type="button" class="icon-button remove" disabled={busy} onclick={remove}
				aria-label="Remove imported font" title="Remove this imported font from the app">
				<Icon name="trash" class="w-4 h-4" />
			</button>
		{/if}
	</div>
	{#if importing}
		<div class="importer">
			<label for={`${id}-family`} class="font-label">Google Fonts family</label>
			<div class="entry">
				<input id={`${id}-family`} class="input-base" type="text" bind:value={family}
					placeholder="e.g. Atkinson Hyperlegible" maxlength="100" disabled={busy}
					onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void add(); } }} />
				<button type="button" class="icon-button add" disabled={busy || !family.trim()} onclick={add}
					aria-label="Add Google Font" title="Download and add font">
					<Icon name={busy ? 'refresh' : 'plus'} class="w-4 h-4" />
				</button>
			</div>
			<p class="hint">{busy ? 'Downloading font to the server…' : 'Use the family name from'}
				{#if !busy}<a href="https://fonts.google.com/" target="_blank" rel="noopener noreferrer">Google Fonts <Icon name="externalLink" class="w-3 h-3 inline" /></a>.{/if}
			</p>
		</div>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
	.font-picker { display: grid; gap: 0.6rem; width: 100%; min-width: 0; }
	.selection, .entry { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
	.selection :global(.relative) { flex: 1; min-width: 0; }
	.selection :global(select) { width: 100%; text-overflow: ellipsis; }
	.importer { display: grid; gap: 0.45rem; }
	.font-label { font-size: 0.75rem; color: var(--color-text-secondary); }
	.entry input { min-width: 0; flex: 1; width: 100%; padding: 0.6rem; font-size: 0.8rem; }
	.icon-button { display: grid; place-items: center; flex-shrink: 0; width: 2.25rem; height: 2.25rem; border: 1px solid var(--color-border); border-radius: 0.4rem; color: var(--color-text-secondary); }
	.icon-button:hover { color: var(--color-accent); background: var(--color-bg-elevated); }
	.add { color: var(--color-accent); }
	.icon-button:disabled { opacity: 0.45; cursor: default; }
	.hint, .error { margin: 0; font-size: 0.72rem; line-height: 1.5; color: var(--color-text-muted); }
	.hint a { color: var(--color-accent); text-decoration: underline; text-underline-offset: 2px; }
	.error { color: var(--color-error); }
</style>
