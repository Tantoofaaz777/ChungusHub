<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import ExpandableTextarea from '#lib/components/ui/ExpandableTextarea.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import { normalizeCharacterAuthorsNote, type CharacterAuthorsNote } from '../../../../shared/character-authors-note';

	let { chatId, onClose }: { chatId: string; onClose: () => void } = $props();

	// Capture the owning chat so navigation cannot send a pending edit to another story.
	const targetChatId = untrack(() => chatId);
	const targetCharacterId = untrack(() => chatStore.activeChat?.id === targetChatId
		? chatStore.activeChat.characterId : null);
	let character = $derived(characterLibraryStore.entries.find(entry =>
		entry.id === targetCharacterId && entry.type === 'character') ?? null);
	const initial = untrack(() => chatStore.featureState(targetChatId).authorsNote);
	let text = $state(initial.text);
	let characterNote = $state(normalizeCharacterAuthorsNote(untrack(() => character?.characterAuthorsNote)));
	let characterDirty = $state(false);
	let pendingWrites = $state(0);
	let closing = $state(false);
	let mounted = true;
	let dirty = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastWrite: Promise<void> = Promise.resolve();
	// Another chat/device can update the shared note while this dialog is open.
	// Refresh idle editors, preserving text this editor has not saved yet.
	$effect(() => {
		const saved = character?.characterAuthorsNote;
		if (!characterDirty && pendingWrites === 0) characterNote = normalizeCharacterAuthorsNote(saved);
	});

	function flush(): Promise<void> {
		clearTimeout(timer);
		timer = undefined;
		if (!dirty && !characterDirty) return lastWrite;
		const saveChat = dirty;
		const saveCharacter = characterDirty;
		const chatText = text;
		const privateNote = { ...characterNote };
		dirty = false;
		characterDirty = false;
		pendingWrites++;
		// Serialize snapshots: a delayed request must never overwrite newer typing.
		lastWrite = lastWrite.catch(() => undefined).then(async () => {
			const writes: Promise<unknown>[] = [];
			if (saveChat) writes.push(chatStore.updateChatFeatureState(targetChatId, { authorsNote: { text: chatText } })
				.catch(error => { dirty = true; throw error; }));
			if (saveCharacter && targetCharacterId) writes.push(characterLibraryStore.updateCharacterAuthorsNote(targetCharacterId, privateNote)
				.catch(error => { characterDirty = true; throw error; }));
			const results = await Promise.allSettled(writes);
			const failed = results.find(result => result.status === 'rejected');
			if (failed?.status === 'rejected') throw failed.reason;
		}).finally(() => { pendingWrites--; });
		return lastWrite;
	}

	function persist(): void {
		void flush().catch((error) => {
			toastStore.failed("save author's notes", error);
		});
	}

	function edit(value: string): void {
		text = value;
		dirty = true;
		clearTimeout(timer);
		timer = setTimeout(persist, 400);
	}

	function editCharacter(updates: Partial<CharacterAuthorsNote>, immediate = false): void {
		characterNote = { ...characterNote, ...updates };
		characterDirty = true;
		clearTimeout(timer);
		if (immediate) persist();
		else timer = setTimeout(persist, 400);
	}

	async function close(): Promise<void> {
		if (closing) return;
		closing = true;
		try {
			await flush();
			if (mounted) onClose();
		} catch (error) {
			toastStore.failed("save author's notes", error);
		} finally {
			closing = false;
		}
	}

	// Also commit when navigation unmounts the editor or the browser backgrounds it.
	onDestroy(() => {
		mounted = false;
		if (dirty || characterDirty) persist();
		else clearTimeout(timer);
	});
	onMount(() => {
		const hide = () => { if (dirty || characterDirty) persist(); };
		const visibility = () => { if (document.hidden) hide(); };
		window.addEventListener('pagehide', hide);
		document.addEventListener('visibilitychange', visibility);
		return () => {
			window.removeEventListener('pagehide', hide);
			document.removeEventListener('visibilitychange', visibility);
		};
	});
</script>

<Dialog open={true} onClose={close} title="Author's notes" titleAlign="left" size="lg" placement="center" bare>
	<div class="notes-form panel-scroll">
		<section class="notes-section" aria-labelledby="chat-notes-heading">
		<h3 id="chat-notes-heading">This chat</h3>
		<p>Notes for this conversation only.</p>
		<label class="sr-only" for="authors-notes-text">Author's notes</label>
		<ExpandableTextarea
			id="authors-notes-text"
			value={text}
			onValueChange={edit}
			dialogTitle="Author's notes"
			placeholder="Tone, pacing, or direction for this story…"
			rows={5}
			maxHeight={260}
			class="input-base w-full px-3 py-2 text-sm text-text-primary"
			disabled={closing}
		/>
		</section>
		{#if character}
			<section class="notes-section character-notes" aria-labelledby="character-notes-heading">
				<h3 id="character-notes-heading">Character Author's Note <span>(Private)</span></h3>
				<p>Shared by all chats with {character.identity.name}. Not included in character card exports.</p>
				<label class="sr-only" for="character-authors-note">Character Author's Note</label>
				<ExpandableTextarea
					id="character-authors-note" value={characterNote.text}
					onValueChange={(value) => editCharacter({ text: value })}
					dialogTitle="Character Author's Note" placeholder="Persistent direction for this character…"
					rows={5} maxHeight={260} class="input-base w-full px-3 py-2 text-sm text-text-primary" disabled={closing}
				/>
				<div class="notes-toggle">
					<span>Use character author's note</span>
					<Toggle checked={characterNote.enabled} onchange={(enabled) => editCharacter({ enabled }, true)}
						disabled={closing} label="Use character author's note" size="sm" />
				</div>
				<fieldset disabled={closing || !characterNote.enabled}>
					<legend class="sr-only">Combine with this chat's author's notes</legend>
					{#each [
						{ value: 'replace', label: "Replace Author's Note" },
						{ value: 'before', label: "Top of Author's Note" },
						{ value: 'after', label: "Bottom of Author's Note" }
					] as option}
						<label class="notes-position">
							<input type="radio" name="character-note-position" value={option.value}
								checked={characterNote.position === option.value}
								onchange={() => editCharacter({ position: option.value as CharacterAuthorsNote['position'] }, true)} />
							{option.label}
						</label>
					{/each}
				</fieldset>
			</section>
		{/if}
	</div>
</Dialog>

<style>
	.notes-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
		padding: 1.25rem;
		/* Match the header's inset without reserving an unused scrollbar on the right. */
		scrollbar-gutter: auto;
	}
	.notes-section { display: flex; flex-direction: column; gap: 0.65rem; min-width: 0; }
	.notes-section h3 { margin: 0; font-family: var(--font-ui); font-size: 0.85rem; font-weight: 600; }
	.notes-section h3 span, .notes-section p { color: var(--color-text-muted); }
	.notes-section p { margin: 0; font-family: var(--font-ui); font-size: 0.75rem; line-height: 1.5; }
	.character-notes { border-top: 1px solid var(--color-border); padding-top: 1rem; margin-top: 0.25rem; }
	.notes-toggle { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; font-family: var(--font-ui); font-size: 0.8rem; }
	.notes-section fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.6rem; }
	.notes-section fieldset:disabled { opacity: 0.5; }
	.notes-position { display: flex; align-items: center; gap: 0.5rem; font-family: var(--font-ui); font-size: 0.8rem; }
	.notes-position input { accent-color: var(--color-accent); }

</style>
