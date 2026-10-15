<script lang="ts">
	import type { LibraryEntry } from '$lib/types/library';
	import type { CharacterCardMetadata, CardAsset } from '$lib/types/character-card';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { localizedCreatorNotes } from '$lib/services/characterCard';
	import { dataUrlBytes } from '$lib/services/charx';
	import { triggerDownload } from '$lib/services/libraryExport';
	import { imageService } from '$lib/services/imageService';
	let { entry }: { entry: LibraryEntry } = $props();
	let metadata = $derived(entry.data.cardMetadata);
	let locale = $state('');
	let selectedLocale = $state('');
	let notes = $derived(metadata?.creatorNotesMultilingual ?? {});
	const inputClass = 'w-full rounded border border-border-subtle bg-bg-secondary px-2 py-1.5 text-sm text-text-primary';
	function save(patch: Partial<CharacterCardMetadata>) {
		void characterLibraryStore.updateData(entry.id, { cardMetadata: {
			version: 3, extensions: {}, ...metadata, ...patch
		} }).catch((error) => toastStore.failed('save card metadata', error));
	}
	function addLanguage() {
		const language = locale.trim().toLowerCase();
		if (!/^[a-z]{2}$/.test(language)) { toastStore.error('Use a two-letter language code, such as en or pt.'); return; }
		save({ creatorNotesMultilingual: { ...notes, [language]: notes[language] ?? '' } });
		selectedLocale = language; locale = '';
	}
	function preview(asset: CardAsset) { return /^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(asset.uri) ? asset.uri : undefined; }
	function download(asset: CardAsset) {
		try {
			const data = dataUrlBytes(asset.uri);
			if (data) triggerDownload(`${asset.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}.${asset.ext.replace(/[^a-z0-9]/gi, '') || 'bin'}`, new Blob([data.bytes as BlobPart], { type: 'application/octet-stream' }));
			else toastStore.error('This asset is a reference; its bytes were not available during import.');
		} catch (error) { toastStore.failed('download card asset', error); }
	}
	async function usePersona(asset: CardAsset) {
		try {
			const data = dataUrlBytes(asset.uri);
			if (!data || !preview(asset)) return;
			const imageUrl = await imageService.saveImage(new File([data.bytes as BlobPart], `${asset.name}.${asset.ext}`, { type: data.mime }), 'personas');
			await characterLibraryStore.savePersona({ id: crypto.randomUUID(), name: asset.name, imageUrl, traits: { description: '', personality: '', background: '' }, cardMetadata: { version: 3, extensions: {}, userIconName: asset.name } });
			toastStore.success(`Persona "${asset.name}" added. Select it in the chat's persona picker.`);
		} catch (error) { toastStore.failed('create a persona from this icon', error); }
	}
</script>

<details class="mx-4 mb-5 rounded-lg border border-border-subtle p-3 font-ui text-sm text-text-secondary">
	<summary class="cursor-pointer text-text-primary">Character Card V3</summary>
	<div class="mt-3 space-y-4">
		{#if metadata?.creationDate || metadata?.modificationDate}
			<p class="text-xs text-text-muted">
				{#if metadata.creationDate}Created {new Date(metadata.creationDate * 1000).toLocaleString()}. {/if}
				{#if metadata.modificationDate}Card last modified {new Date(metadata.modificationDate * 1000).toLocaleString()}.{/if}
			</p>
		{/if}
		{#if metadata?.source?.length}
			<div><p class="mb-1 font-medium">Original sources</p>
				{#each metadata.source as source}
					<p class="break-all text-xs">{#if /^https?:\/\//i.test(source)}<a class="underline" href={source} target="_blank" rel="noopener noreferrer">{source}</a>{:else}{source}{/if}</p>
				{/each}
			</div>
		{/if}
		<div class="space-y-2">
			<label class="block" for="card-notes-{entry.id}">Creator notes language</label>
			<select id="card-notes-{entry.id}" class={inputClass} bind:value={selectedLocale}>
				<option value="">Automatic</option>
				{#each Object.keys(notes) as language}<option value={language}>{language}</option>{/each}
			</select>
			{#if selectedLocale && Object.hasOwn(notes, selectedLocale)}
				<textarea aria-label="Translated creator notes" class={inputClass} rows="4" value={notes[selectedLocale]} onchange={(event) => save({ creatorNotesMultilingual: { ...notes, [selectedLocale]: event.currentTarget.value } })}></textarea>
			{:else}
				<p class="whitespace-pre-wrap">{localizedCreatorNotes(notes, entry.data.traits.creatorNotes ?? '') || 'No creator notes.'}</p>
			{/if}
			<div class="flex gap-2"><input class={inputClass} aria-label="Language code" placeholder="Language code (pt, en…)" bind:value={locale} maxlength="2" /><button class="shrink-0 underline" onclick={addLanguage}>Add language</button></div>
		</div>
		<div class="space-y-2">
			<p class="font-medium">Group-only greetings</p>
			<p class="text-xs text-text-muted">Preserved for compatible group-chat apps. ChungusHub uses First Message and Alternate Greetings for its chats.</p>
			{#each metadata?.groupOnlyGreetings ?? [] as greeting, i}
				<div class="flex gap-2"><textarea aria-label="Group greeting {i + 1}" class={inputClass} rows="3" value={greeting} onchange={(event) => save({ groupOnlyGreetings: metadata!.groupOnlyGreetings!.map((text, index) => index === i ? event.currentTarget.value : text) })}></textarea><button aria-label="Remove group greeting {i + 1}" onclick={() => save({ groupOnlyGreetings: metadata!.groupOnlyGreetings!.filter((_, index) => index !== i) })}>Remove</button></div>
			{/each}
			<button class="underline" onclick={() => save({ groupOnlyGreetings: [...(metadata?.groupOnlyGreetings ?? []), ''] })}>Add greeting</button>
		</div>
		{#if metadata?.assets?.length}
			<div class="space-y-2"><p class="font-medium">Card assets ({metadata.assets.length})</p>
				<p class="text-xs text-text-muted">Portraits and backgrounds can be used in chats. Other assets are preserved for export.</p>
				{#each metadata.assets as asset, i}
					<div class="flex items-center gap-3 rounded border border-border-subtle p-2">
						{#if (asset.type === 'icon' || asset.type === 'user_icon' || asset.type === 'background') && preview(asset)}<img src={preview(asset)} alt={asset.name} class="h-12 w-12 rounded object-cover" />{/if}
						<div class="min-w-0 flex-1"><p class="break-all">{asset.name}</p><p class="text-xs text-text-muted">{asset.type} · {asset.ext}</p></div>
						{#if asset.type === 'user_icon' && preview(asset)}<button class="text-xs underline" onclick={() => usePersona(asset)}>Create persona</button>{/if}
						{#if asset.type === 'background' && metadata.assetPaths?.[i]}<button class="text-xs underline" onclick={() => save({ backgroundPath: metadata!.assetPaths![i] })}>Use in new chats</button>{/if}
						<button class="text-xs underline" onclick={() => download(asset)}>Download</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</details>
