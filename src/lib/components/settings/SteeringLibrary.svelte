<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { dragHandleZone, dragHandle, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
	import Icon from '#lib/components/ui/Icon.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import SteeringNoteEditor from '#lib/components/chat/SteeringNoteEditor.svelte';
	import { panelActivity } from '#lib/components/ui/panelActivity.ts';
	import { steeringStore } from '#lib/stores/steering.svelte.ts';
	import { uiStore } from '#lib/stores/ui.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import { bindingLabel } from '#lib/utils/steering-labels.ts';
	import { noteLabel, type SteeringNote } from '#lib/types/steering.ts';

	const panelActive = panelActivity();
	let section: HTMLElement | undefined;
	let editorElement = $state<HTMLElement | undefined>();
	let expandedId = $state<string | null>(null);
	let busy = $state(false);
	let dragging = $state(false);
	let list = $state<SteeringNote[]>(untrack(() => [...steeringStore.orderedNotes]));
	$effect(() => { if (!busy && !dragging) list = [...steeringStore.orderedNotes]; });
	function flush() { void steeringStore.flush().catch(error => toastStore.failed('save steering', error)); }
	$effect(() => { if (!panelActive()) untrack(flush); });
	onDestroy(flush);
	$effect(() => {
		if (panelActive() && uiStore.pendingSteeringLibrary && section) {
			uiStore.pendingSteeringLibrary = false;
			void tick().then(() => section?.scrollIntoView({ block: 'start' }));
		}
	});
	$effect(() => {
		if (editorElement) editorElement.scrollIntoView({ block: 'nearest' });
	});

	async function persistOrder(next: SteeringNote[]) {
		busy = true;
		list = next;
		try { await steeringStore.reorder(next.map(note => note.id)); }
		catch (error) { toastStore.failed('reorder steering', error); }
		finally { busy = false; }
	}
	function consider(event: CustomEvent<DndEvent<SteeringNote>>) {
		dragging = event.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
		list = event.detail.items;
	}
	function finalize(event: CustomEvent<DndEvent<SteeringNote>>) {
		dragging = false;
		void persistOrder(event.detail.items);
	}
	async function create() {
		busy = true;
		try {
			const previous = steeringStore.orderedNotes.map(note => note.id);
			const note = await steeringStore.create({ text: '', scope: 'global', scopeId: null, mode: 'pinned' });
			await steeringStore.reorder([...previous, note.id]);
			expandedId = note.id;
		} catch (error) { toastStore.failed('create steering', error); }
		finally { busy = false; }
	}
	async function remove(note: SteeringNote) {
		try { await steeringStore.remove(note.id); if (expandedId === note.id) expandedId = null; }
		catch (error) { toastStore.failed('delete steering', error); }
	}
	function toggle(note: SteeringNote, enabled: boolean) {
		void steeringStore.update(note.id, { enabled }).catch(error => toastStore.failed('update steering', error));
	}
</script>

<section class="card steering-library" aria-label="Steering library" bind:this={section}>
	<div class="card-head library-head">
		<span class="card-title">Steering library</span>
		<button type="button" class="library-add" disabled={busy} onclick={create}>
			<Icon name="plus" class="w-3.5 h-3.5" />New steering
		</button>
	</div>
	{#if list.length}
		<div class="library-list" use:dragHandleZone={{ items: list, type: 'steering-library', flipDurationMs: 160, dropTargetStyle: {}, delayTouchStart: 180, dragDisabled: busy }} onconsider={consider} onfinalize={finalize}>
			{#each list as note (note.id)}
				<div class="library-note" class:is-expanded={expandedId === note.id}>
					<div class="library-row">
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span class="library-grip" use:dragHandle aria-label="Drag to reorder {noteLabel(note)}" title="Drag to reorder"><Icon name="menu" class="w-4 h-4" /></span>
						<Toggle checked={note.enabled} size="sm" label={noteLabel(note)} disabled={busy} onchange={(on) => toggle(note, on)} />
						<button type="button" class="item-main" class:is-off={!note.enabled} aria-expanded={expandedId === note.id} aria-label="Edit {noteLabel(note)}" onclick={() => { flush(); expandedId = expandedId === note.id ? null : note.id; }}>
							<span class="item-name">{noteLabel(note)}</span>
							<span class="item-scope">{bindingLabel(note)}{note.mode === 'once' ? ' · Next reply' : ''}</span>
						</button>
						<button type="button" class="item-action item-delete" aria-label="Delete {noteLabel(note)}" title="Delete steering" disabled={busy} onclick={() => remove(note)}><Icon name="trash" class="w-3.5 h-3.5" /></button>
					</div>
					{#if expandedId === note.id}
						<div class="library-editor" bind:this={editorElement}>
							{#key note.id}<SteeringNoteEditor {note} rows={5} maxHeight={320} ondeleted={() => expandedId = null} />{/key}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<p class="library-empty">No saved steering yet. Create one to reuse its guidance in your chats.</p>
	{/if}
</section>

<style>
	.steering-library { scroll-margin-top: 1rem; }
	.library-head { justify-content: space-between; gap: .5rem; }
	.library-add { display:inline-flex; align-items:center; gap:.3rem; font-size:.74rem; color:var(--color-accent); cursor:pointer; }
	.library-list { padding:.65rem; display:flex; flex-direction:column; gap:.35rem; }
	.library-note { min-width:0; border-radius:var(--radius-md); }
	.library-note.is-expanded { background:var(--color-bg-secondary); }
	.library-row { display:flex; align-items:center; gap:.4rem; padding:.45rem .25rem; }
	.library-grip { display:flex; color:var(--color-text-muted); cursor:grab; touch-action:none; }
	.item-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:.1rem; text-align:left; cursor:pointer; }
	.item-main.is-off { opacity:.5; }
	.item-name { font-size:.8rem; font-weight:600; color:var(--color-text-primary); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.item-scope { font-size:.65rem; color:var(--color-text-muted); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
	.item-action { display:inline-flex; flex-shrink:0; align-items:center; justify-content:center; width:1.65rem; height:1.9rem; border-radius:var(--radius-sm); color:var(--color-text-muted); cursor:pointer; }
	.item-action:hover:not(:disabled) { color:var(--color-text-primary); background:var(--color-bg-tertiary); }
	.item-delete:hover:not(:disabled) { color:var(--color-error); }
	button:disabled { opacity:.35; cursor:default; }
	.library-editor { padding:.7rem; border-top:1px solid var(--color-border-subtle); }
	.library-empty { padding:1rem; font-size:.8rem; color:var(--color-text-muted); }
</style>
