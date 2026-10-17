<script lang="ts">
	import { panelActivity } from '$lib/components/ui/panelActivity';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { failureText } from '$lib/stores/toast.svelte';
	import { apiGet, fileUrl } from '$lib/services/transport';
	import { imageService } from '$lib/services/imageService';
	import { backgroundStore } from '$lib/stores/background.svelte';

	const panelActive = panelActivity();
	interface BackgroundEntry {
		path: string;
		name: string;
		source: 'default' | 'custom';
	}

	interface Props {
		open: boolean;
		onClose: () => void;
	}

	let { open, onClose }: Props = $props();

	let backgrounds = $state<BackgroundEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement | undefined>(undefined);

	let selectedPath = $derived(backgroundStore.config.path);

	async function refresh(): Promise<void> {
		loading = true;
		error = null;
		try {
			const data = (await apiGet('/api/backgrounds')) as { backgrounds: BackgroundEntry[] };
			backgrounds = data.backgrounds;
		} catch (e) {
			error = failureText('load the backgrounds', e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (panelActive() && open) void refresh();
	});

	function select(path: string): void {
		backgroundStore.setBackground(path);
	}

	function selectNone(): void {
		backgroundStore.setBackground(null);
	}

	async function handleUpload(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		uploading = true;
		error = null;
		try {
			const path = await imageService.saveImage(file, 'backgrounds');
			await refresh();
			backgroundStore.setBackground(path);
		} catch (e) {
			error = failureText(`upload "${file.name}"`, e);
		} finally {
			uploading = false;
		}
	}

	/** Custom background awaiting delete confirmation; null = closed. */
	let deleteTarget = $state<BackgroundEntry | null>(null);

	async function handleDelete(): Promise<void> {
		const entry = deleteTarget;
		deleteTarget = null;
		if (!entry) return;
		error = null;
		try {
			await imageService.deleteImage(entry.path);
			if (selectedPath === entry.path) backgroundStore.setBackground(null);
			await refresh();
		} catch (e) {
			error = failureText(`delete "${entry.name}"`, e);
		}
	}
</script>

<Dialog {open} {onClose} title="Workspace Background" size="xl">
	<div class="space-y-3">
		<Alert message={error} />

		{#if loading && backgrounds.length === 0}
			<p class="picker-note font-ui">Loading backgrounds…</p>
		{:else}
			<div class="bg-grid" role="radiogroup" aria-label="Workspace background">
				<button
					type="button"
					role="radio"
					aria-checked={selectedPath === null}
					class="bg-tile"
					class:active={selectedPath === null}
					onclick={selectNone}
				>
					<span class="bg-tile-image bg-tile-none" aria-hidden="true">
						<span class="bg-none-swatch"></span>
					</span>
					<span class="bg-tile-name">None</span>
				</button>

				{#each backgrounds as entry (entry.path)}
					<button
						type="button"
						role="radio"
						aria-checked={selectedPath === entry.path}
						class="bg-tile"
						class:active={selectedPath === entry.path}
						title={entry.name}
						onclick={() => select(entry.path)}
					>
						<span class="bg-tile-image">
							<img src={fileUrl(entry.path)} alt={entry.name} loading="lazy" />
							{#if selectedPath === entry.path}
								<span class="bg-tile-check"><Icon name="check" class="w-3.5 h-3.5" /></span>
							{/if}
							{#if entry.source === 'custom'}
								<!-- span, not a nested <button> (invalid HTML inside the tile button);
								     the keydown handler keeps it keyboard-operable all the same. -->
								<span
									class="bg-tile-delete"
									role="button"
									tabindex="-1"
									title="Delete this background"
									aria-label="Delete {entry.name}"
									onclick={(e) => {
										e.stopPropagation();
										deleteTarget = entry;
									}}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											e.stopPropagation();
											deleteTarget = entry;
										}
									}}
								>
									<Icon name="trash" class="w-3.5 h-3.5" />
								</span>
							{/if}
						</span>
						<span class="bg-tile-name">{entry.name}</span>
					</button>
				{/each}
			</div>

			{#if !loading && backgrounds.length === 0}
				<p class="picker-note font-ui">
					No backgrounds yet. Upload one below, or drop image files into the app's
					defaults/backgrounds folder.
				</p>
			{/if}
		{/if}
	</div>

	<!-- Sticky footer: the upload action stays visible no matter how long the grid
	     scrolls. Negative margins cancel the dialog's content padding so the bar
	     hugs the panel's edges. -->
	<div class="picker-footer">
		<span class="picker-note font-ui">PNG, JPG, JFIF, WebP, GIF or AVIF.</span>
		<Button variant="secondary" size="sm" disabled={uploading} onclick={() => fileInput?.click()}>
			<Icon name="upload" class="w-3.5 h-3.5" />
			{uploading ? 'Uploading…' : 'Upload image'}
		</Button>
	</div>
</Dialog>

<ConfirmDialog
	open={deleteTarget !== null}
	title="Delete background"
	message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
	confirmLabel="Delete"
	variant="danger"
	destructive
	onConfirm={handleDelete}
	onCancel={() => (deleteTarget = null)}
/>

<input
	bind:this={fileInput}
	type="file"
	accept="image/png,image/jpeg,.jfif,image/webp,image/gif,image/avif"
	class="hidden"
	onchange={handleUpload}
/>

<style>
	.picker-note {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.bg-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: 0.6rem;
	}

	.bg-tile {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.4rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-tertiary) 40%, transparent);
		cursor: pointer;
		text-align: left;
		transition: border-color 120ms ease, transform 120ms ease;
	}

	.bg-tile:hover {
		border-color: var(--color-border);
		transform: translateY(-1px);
	}

	.bg-tile.active {
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	.bg-tile-image {
		position: relative;
		display: block;
		aspect-ratio: 16 / 9;
		border-radius: calc(var(--radius-md) - 2px);
		overflow: hidden;
		background: var(--color-bg-primary);
	}

	.bg-tile-image img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.bg-tile-none {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border-subtle);
		color: var(--color-text-muted);
	}

	.bg-none-swatch {
		width: 60%;
		height: 55%;
		border-radius: calc(var(--radius-md) - 4px);
		background: var(--color-bg-secondary);
		border: 1px dashed var(--color-border);
	}

	.bg-tile-check {
		position: absolute;
		top: 0.35rem;
		left: 0.35rem;
		display: grid;
		place-items: center;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 999px;
		background: var(--color-accent);
		color: var(--color-on-accent);
	}

	.bg-tile-delete {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 999px;
		background: color-mix(in srgb, black 55%, transparent);
		color: white;
		opacity: 0;
		transition: opacity 120ms ease, background-color 120ms ease;
	}

	.bg-tile:hover .bg-tile-delete,
	.bg-tile:focus-visible .bg-tile-delete {
		opacity: 1;
	}

	.bg-tile-delete:hover {
		background: var(--color-error);
	}

	.bg-tile-name {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bg-tile.active .bg-tile-name {
		color: var(--color-accent);
	}

	/* Sticky action bar at the bottom of the dialog's scroll area. The negative
	   margins cancel the dialog's p-5 content padding so the bar spans edge to
	   edge and sits flush with the panel's bottom. Tiles scroll beneath it, so it
	   carries the float tier + blur instead of a plain translucent token. */
	.picker-footer {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin: 0.9rem -1.25rem -1.25rem;
		padding: 0.7rem 1.25rem;
		background: var(--color-float-bg);
		backdrop-filter: var(--backdrop-blur) saturate(140%);
		-webkit-backdrop-filter: var(--backdrop-blur) saturate(140%);
		border-top: 1px solid var(--glass-border);
		border-radius: 0 0 calc(var(--radius-xl) - 1px) calc(var(--radius-xl) - 1px);
	}
</style>
