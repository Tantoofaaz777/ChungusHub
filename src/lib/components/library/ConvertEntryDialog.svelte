<script lang="ts">
	/**
	 * Create the other kind of entry from the one being edited: a persona from a character,
	 * a character from a persona. The source is never touched (the store's `convertEntry`
	 * explains why a copy is the only safe shape), so this dialog is about one thing: the
	 * text the new entry starts with. A character's descriptive fields are folded into the
	 * single field a persona has, and the reader edits the result here rather than finding
	 * out afterwards what was dropped.
	 */
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import { personaDescriptionFromCharacter } from '#lib/utils/entry-conversion.ts';
	import type { LibraryEntry } from '#lib/types/library.ts';

	interface Props {
		open: boolean;
		entry: LibraryEntry;
		onClose: () => void;
	}

	let { open, entry, onClose }: Props = $props();

	let toPersona = $derived(entry.type === 'character');
	let targetLabel = $derived(toPersona ? 'persona' : 'character');
	let description = $state('');
	let busy = $state(false);

	// Refold on every open: the editor behind this dialog may have moved since last time.
	$effect(() => {
		if (open) {
			description = toPersona
				? personaDescriptionFromCharacter(entry.data.traits)
				: (entry.data.traits.description ?? '').trim();
		}
	});

	async function handleConvert() {
		if (busy) return;
		busy = true;
		try {
			const created = await characterLibraryStore.convertEntry(entry.id, description);
			toastStore.success(`Created the ${targetLabel} "${created.identity.name || 'Unnamed'}"`);
			onClose();
		} catch (error) {
			console.error('Converting the entry failed:', error);
			toastStore.failed(`create a ${targetLabel} from this`, error);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	{open}
	{onClose}
	title={toPersona ? 'Save as persona' : 'Save as character'}
	size="lg"
>
	<div class="flex flex-col gap-4">
		<p class="cv-hint">
			{entry.identity.name || 'This entry'} stays exactly as it is. A new {targetLabel} is created
			with the portrait and the linked lorebooks, starting from this text.
		</p>

		<div class="flex flex-col gap-2">
			<label class="cv-label" for="convert-description">
				{toPersona ? 'Persona Description' : 'Description'}
			</label>
			<textarea
				id="convert-description"
				bind:value={description}
				placeholder={toPersona
					? 'Who you are: appearance, presence, how you carry yourself, how you speak…'
					: 'Who the character is: appearance, presence, how they carry themselves…'}
				class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm placeholder:text-text-muted resize-none min-h-[16rem] max-h-[26rem] overflow-y-auto"
			></textarea>
		</div>

		{#if toPersona}
			<p class="cv-hint">
				A persona is this one field. The scenario, the opening message, the example dialogue, the
				card metadata, versions and tags are the character's own and do not
				come along.
			</p>
		{/if}

		<div class="flex gap-3 justify-end pt-1">
			<Button variant="ghost" onclick={onClose} disabled={busy}>Cancel</Button>
			<Button variant="primary" onclick={handleConvert} disabled={busy}>
				<Icon name={toPersona ? 'user' : 'users'} class="w-4 h-4" />
				Create {targetLabel}
			</Button>
		</div>
	</div>
</Dialog>

<style>
	.cv-label {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.cv-hint {
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}
</style>
