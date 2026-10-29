<script lang="ts">
	import { uiStore } from '#lib/stores/ui.svelte.ts';
	import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
	import LibraryEntryEditor from './LibraryEntryEditor.svelte';
	import PersonaEditor from './PersonaEditor.svelte';

	// The entry editor, lifted out of the Library dock so it opens wide and centered
	// over the chat while the browse list stays in the right dock. Both tabs point it
	// at an entry via uiStore.libraryEditorId; the entry's type picks the editor.
	let entryId = $derived(uiStore.libraryEditorId);
	let entry = $derived(
		entryId ? characterLibraryStore.entries.find((e) => e.id === entryId) : undefined
	);

	function close() {
		uiStore.libraryEditorId = null;
	}

	// If the entry being edited disappears (deleted from the list, in bulk, or
	// anywhere else), dismiss the editor so it can't point at a gone entry.
	// Guarded by `loading` so it never clears a deep link before the library loads.
	$effect(() => {
		if (entryId && !characterLibraryStore.loading && !entry) {
			uiStore.libraryEditorId = null;
		}
	});
</script>

{#if entryId && entry}
	<!-- Key on the id so switching entries remounts the editor fresh, matching the
	     old mount/unmount behaviour instead of mutating a live instance. -->
	{#key entryId}
		{#if entry.type === 'persona'}
			<PersonaEditor {entryId} onClose={close} />
		{:else}
			<LibraryEntryEditor {entryId} onClose={close} />
		{/if}
	{/key}
{/if}
