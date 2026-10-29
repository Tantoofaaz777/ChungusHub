<script lang="ts">
	/**
	 * Character export options: SillyTavern PNG or JSON. For a single versioned character it also
	 * asks which version to surface ("All versions" shows the active one and embeds the rest for a
	 * lossless round-trip; see sillyTavernExport.ts). For several characters at once the version is
	 * always "all" and they download bundled in one `.zip`.
	 */
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import { lorebookStore } from '#lib/lorebook/store.svelte.ts';
	import { canShareNativeFiles } from '#lib/services/android-client.ts';
	import type { ExportDestination } from '#lib/services/libraryExport.ts';
	import {
		exportEntryAsSillyTavern,
		exportEntriesAsSillyTavernZip,
		type ExportFormat,
		type CardSchema,
		type ExportTarget,
		type VersionSelection
	} from '#lib/services/sillyTavernExport.ts';

	interface Props {
		open: boolean;
		/** One or many characters to export, each paired with its versions. */
		targets: ExportTarget[];
		onClose: () => void;
	}

	let { open, targets, onClose }: Props = $props();

	// A single target unlocks the per-version picker; several always export every version.
	let single = $derived(targets.length === 1 ? targets[0] : null);
	let format = $state<ExportFormat>('png');
	let schema = $state<CardSchema>('v3');
	let versionSel = $state<VersionSelection>('all');
	let busy = $state(false);

	// Reset the choices whenever the dialog reopens.
	$effect(() => {
		if (open) {
			format = 'png';
			schema = 'v3';
			versionSel = 'all';
		}
	});

	async function handleExport(destination: ExportDestination = 'download') {
		if (busy) return;
		busy = true;
		try {
			const opts = { format, schema, lorebooks: lorebookStore.books, destination };
			if (single) {
				await exportEntryAsSillyTavern(single.entry, single.versions, versionSel, opts);
			} else {
				await exportEntriesAsSillyTavernZip(targets, opts);
			}
			onClose();
		} catch (error) {
			console.error('Failed to export character:', error);
			toastStore.failed(destination === 'share' ? 'share that entry' : 'export that entry', error);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog {open} {onClose} title={single ? 'Export character' : `Export ${targets.length} characters`} size="sm">
	<div class="flex flex-col gap-5">
		<!-- Format -->
		<div class="flex flex-col gap-2">
			<span class="ex-label">Format</span>
			<div class="ex-segment" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
				<button
					type="button"
					class="ex-seg-btn"
					class:is-active={format === 'png'}
					onclick={() => (format = 'png')}
				>
					<Icon name="image" class="w-4 h-4" />
					PNG
				</button>
				<button
					type="button"
					class="ex-seg-btn"
					class:is-active={format === 'json'}
					onclick={() => (format = 'json')}
				>
					<Icon name="download" class="w-4 h-4" />
					JSON
				</button>
				<button type="button" class="ex-seg-btn" class:is-active={format === 'charx'} onclick={() => { format = 'charx'; schema = 'v3'; }}>
					<Icon name="download" class="w-4 h-4" /> CHARX
				</button>
			</div>
			<p class="ex-hint">
				{format === 'charx' ? 'The character and its assets together in one portable file.' : format === 'png'
					? 'A character card with the portrait as its art.'
					: 'A JSON character card with its portable metadata.'}
			</p>
		</div>
		{#if format !== 'charx'}
			<div class="flex flex-col gap-2">
				<span class="ex-label">Card version</span>
				<div class="ex-segment">
					<button type="button" class="ex-seg-btn" class:is-active={schema === 'v3'} onclick={() => (schema = 'v3')}>V3</button>
					<button type="button" class="ex-seg-btn" class:is-active={schema === 'v2'} onclick={() => (schema = 'v2')}>V2 compatibility</button>
				</div>
			</div>
		{/if}

		{#if single}
			<!-- Version picker: versioned characters only -->
			{#if single.versions.length > 0}
				<div class="flex flex-col gap-2">
					<span class="ex-label">Version</span>
					<div class="flex flex-col gap-1">
						<label class="ex-radio" class:is-active={versionSel === 'all'}>
							<input type="radio" name="version" value="all" bind:group={versionSel} />
							<span class="ex-radio-body">
								<span class="ex-radio-name">All versions</span>
								<span class="ex-radio-note">
									SillyTavern reads the active version; every version is kept for re-import.
								</span>
							</span>
						</label>
						{#each single.versions as version (version.id)}
							{@const isActive = version.id === single.entry.activeVersionId}
							<label class="ex-radio" class:is-active={versionSel === version.id}>
								<input type="radio" name="version" value={version.id} bind:group={versionSel} />
								<span class="ex-radio-body">
									<span class="ex-radio-name">
										{version.name}{#if isActive}<span class="ex-radio-tag">active</span>{/if}
									</span>
								</span>
							</label>
						{/each}
					</div>
				</div>
			{/if}
		{:else}
			<p class="ex-hint">
				{targets.length} characters download as one <b>.zip</b>. Each keeps its latest version on
				the surface and every version embedded for re-import.
			</p>
		{/if}

		<div class="flex flex-wrap gap-3 justify-end pt-1">
			<Button variant="ghost" onclick={onClose} disabled={busy}>Cancel</Button>
			{#if canShareNativeFiles()}
				<Button variant="secondary" onclick={() => handleExport('share')} disabled={busy}>
					<Icon name="share" class="w-4 h-4" /> Share
				</Button>
			{/if}
			<Button variant="primary" onclick={() => handleExport()} disabled={busy}>
				<Icon name="download" class="w-4 h-4" />
				Export
			</Button>
		</div>
	</div>
</Dialog>

<style>
	.ex-label {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.ex-hint {
		font-family: var(--font-ui);
		font-size: 0.74rem;
		color: var(--color-text-muted);
	}

	.ex-segment {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}

	.ex-seg-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.55rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: color 140ms ease, border-color 140ms ease, background-color 140ms ease;
	}

	.ex-seg-btn:hover {
		color: var(--color-text-primary);
	}

	.ex-seg-btn.is-active {
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	.ex-radio {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-tertiary) 35%, transparent);
		cursor: pointer;
		transition: border-color 140ms ease, background-color 140ms ease;
	}

	.ex-radio:hover {
		border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
	}

	.ex-radio.is-active {
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.ex-radio input {
		margin-top: 0.15rem;
		accent-color: var(--color-accent);
	}

	.ex-radio-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.ex-radio-name {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-ui);
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.ex-radio-tag {
		font-size: 0.6rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.05rem 0.3rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-accent) 20%, transparent);
		color: var(--color-accent);
	}

	.ex-radio-note {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}
</style>
