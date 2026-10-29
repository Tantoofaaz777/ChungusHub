<script lang="ts">
	import { onMount } from 'svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { isAndroidClient, type AndroidSharedFile } from '#lib/services/android-client.ts';
	import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
	import { lorebookStore } from '#lib/lorebook/store.svelte.ts';
	import { uiStore } from '#lib/stores/ui.svelte.ts';
	import { toastStore, failureText } from '#lib/stores/toast.svelte.ts';

	let files = $state<AndroidSharedFile[]>([]);
	let busy = $state(false);
	let currentName = $state('');
	let includeBooks = $state(true);
	let failures = $state<string[]>([]);
	let refreshing = false;
	let refreshAgain = false;
	let active = true;
	const serverName = typeof location === 'undefined' ? 'this server' : location.host;
	const completed = new Set<string>();
	const client = () => isAndroidClient() ? window.ChungusAndroidClient : undefined;

	async function refresh() {
		if (!client()?.incomingFiles || busy) return;
		if (refreshing) { refreshAgain = true; return; }
		refreshing = true;
		try {
			const pending = await client()!.incomingFiles!();
			if (active) files = pending.filter(file => !completed.has(file.id));
		} catch (error) { if (active) toastStore.failed('load shared characters', error); }
		finally {
			refreshing = false;
			if (refreshAgain && active) { refreshAgain = false; void refresh(); }
		}
	}

	onMount(() => {
		void refresh();
		const incoming = () => { void refresh(); };
		const resume = () => { if (client()?.foreground !== false) void refresh(); };
		window.addEventListener('chungus-android-ready', incoming);
		window.addEventListener('chungus-android-incoming', incoming);
		window.addEventListener('chungus-android-lifecycle', resume);
		return () => {
			active = false;
			window.removeEventListener('chungus-android-ready', incoming);
			window.removeEventListener('chungus-android-incoming', incoming);
			window.removeEventListener('chungus-android-lifecycle', resume);
		};
	});

	async function cancel() {
		if (busy) return;
		busy = true;
		try {
			for (const file of files) await client()!.removeIncomingFile!(file.id);
			files = []; failures = [];
		} catch (error) { toastStore.failed('cancel the shared import', error); }
		finally { busy = false; void refresh(); }
	}

	async function importFiles() {
		if (busy) return;
		busy = true; failures = [];
		let imported = 0;
		let lastEntry: { id: string; type: 'character' | 'persona' } | null = null;
		try {
			// The normal card parser and persistence pipeline, loaded only after confirmation.
			const [{ importSillyTavernCard }, { createBookIndex }] = await Promise.all([
				import('#lib/services/sillyTavernImport.ts'), import('#lib/lorebook/identity.ts')
			]);
			await Promise.all([characterLibraryStore.load(), lorebookStore.load()]);
			const bookIndex = createBookIndex(lorebookStore.books);
			for (const file of [...files]) {
				currentName = file.name;
				try {
					const received = await client()!.readIncomingFile!(file);
					const result = await importSillyTavernCard(received);
					const { entry } = await characterLibraryStore.importFromSillyTavern(result, { importLorebook: includeBooks, bookIndex });
					completed.add(file.id); imported++; lastEntry = { id: entry.id, type: entry.type };
					for (const warning of result.warnings ?? []) toastStore.error(warning);
					await client()!.removeIncomingFile!(file.id).catch(error => toastStore.failed('clear the imported shared file', error));
				} catch (error) {
					failures = [...failures, failureText(`import "${file.name}"`, error)];
				}
			}
			if (imported) {
				toastStore.success(`Imported ${imported} shared character${imported === 1 ? '' : 's'}.`);
				if (lastEntry) uiStore.openLibraryEntry(lastEntry.id, lastEntry.type);
			}
		} catch (error) { toastStore.failed('import shared characters', error); }
		finally {
			files = files.filter(file => !completed.has(file.id));
			busy = false; currentName = ''; void refresh();
		}
	}
</script>

<Dialog open={files.length > 0} onClose={() => { void cancel(); }} title="Import shared characters" size="sm" dismissible={!busy}>
	<div class="shared-import">
		<p>Import these files into the character library on {serverName}?</p>
		<ul>{#each files as file (file.id)}<li><Icon name="upload" class="w-4 h-4" /><span>{file.name}</span></li>{/each}</ul>
		<div class="shared-option"><span>Include embedded lorebooks</span><Toggle label="Include embedded lorebooks" checked={includeBooks} onchange={value => includeBooks = value} disabled={busy} /></div>
		{#if busy}<p role="status">{currentName ? `Importing ${currentName}…` : 'Preparing…'}</p>{/if}
		{#if failures.length}<div role="alert" class="shared-errors">{#each failures as failure}<p>{failure}</p>{/each}</div>{/if}
		<div class="shared-actions">
			<Button variant="ghost" disabled={busy} onclick={cancel}>Cancel</Button>
			<Button disabled={busy} onclick={importFiles}><Icon name="upload" class="w-4 h-4" />{failures.length ? 'Retry import' : 'Import'}</Button>
		</div>
	</div>
</Dialog>

<style>
	.shared-import { display: flex; flex-direction: column; gap: 1rem; font-family: var(--font-ui); font-size: .85rem; color: var(--color-text-secondary); }
	ul { margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; list-style: none; }
	li { display: flex; align-items: center; gap: .5rem; }
	li span { overflow-wrap: anywhere; min-width: 0; }
	.shared-actions { display: flex; justify-content: flex-end; gap: .75rem; }
	.shared-option { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
	.shared-errors { color: var(--color-error); overflow-wrap: anywhere; }
</style>
