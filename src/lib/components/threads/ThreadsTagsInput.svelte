<script lang="ts">
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import { dragHandle, dragHandleZone, SOURCES, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
	import Icon from '#lib/components/ui/Icon.svelte';

	type TagItem = { id: string; text: string; isDndShadowItem?: boolean };
	const flipDurationMs = 150;
	let { id, value, onchange }: { id: string; value: string; onchange: (value: string) => void } = $props();
	let draft = $state('');
	let input: HTMLInputElement | undefined = $state();
	let editing = $state<{ index: number; original: string; text: string } | null>(null);
	let editInput: HTMLInputElement | undefined = $state();
	let tagList: HTMLUListElement | undefined = $state();
	let drag = $state.raw<{ originalValue: string; items: TagItem[] } | null>(null);
	// Keep the existing comma-separated storage and prompt format, including older notes.
	const split = (text: string) => text.split(/[,\r\n]+/).map(tag => tag.trim()).filter(Boolean);
	const tags = $derived(split(value));
	const savedItems = $derived.by<TagItem[]>(() => {
		const occurrences = new Map<string, number>();
		return tags.map(text => {
			const occurrence = occurrences.get(text) ?? 0;
			occurrences.set(text, occurrence + 1);
			return { id: `${occurrence}:${text}`, text };
		});
	});
	const items = $derived(drag?.items ?? savedItems);

	function finishReorder(nextItems: TagItem[]) {
		const originalValue = drag?.originalValue;
		drag = null;
		if (originalValue !== value) return;
		const next = nextItems.map(item => item.text).join(', ');
		if (next !== tags.join(', ')) onchange(next);
	}

	function considerReorder({ detail: { items, info } }: CustomEvent<DndEvent<TagItem>>) {
		if (info.trigger === TRIGGERS.DRAG_STOPPED) finishReorder(items);
		else drag = { originalValue: drag?.originalValue ?? value, items };
	}

	function finalizeReorder({ detail: { items, info } }: CustomEvent<DndEvent<TagItem>>) {
		// The library emits finalize for each keyboard move and consider when the drag ends.
		if (info.source === SOURCES.KEYBOARD && drag) drag = { ...drag, items };
		else if (info.trigger === TRIGGERS.DROPPED_OUTSIDE_OF_ANY) drag = null;
		else finishReorder(items);
	}

	function commit(text = draft) {
		if (drag) return;
		const added = split(text);
		draft = '';
		if (!added.length) return;
		const next = [...new Set([...tags, ...added])];
		if (next.length !== tags.length) onchange(next.join(', '));
	}

	function finishEdit(): string[] {
		const edit = editing;
		editing = null;
		if (!edit || tags[edit.index] !== edit.original) return tags;
		const replacement = edit.text.trim();
		if (!replacement || /[,\r\n]/.test(replacement) || tags.includes(replacement)) return tags;
		return tags.map((tag, index) => index === edit.index ? replacement : tag);
	}

	function commitEdit() {
		const next = finishEdit();
		if (next !== tags) onchange(next.join(', '));
	}

	async function startEdit(index: number, tag: string) {
		commitEdit();
		editing = { index, original: tag, text: tag };
		await tick();
		editInput?.focus({ preventScroll: true });
		editInput?.select();
	}

	async function editKeydown(event: KeyboardEvent, index: number) {
		if (event.isComposing || !['Enter', ',', 'Escape'].includes(event.key)) return;
		event.preventDefault();
		if (event.key === 'Escape') {
			event.stopPropagation();
			editing = null;
		} else {
			commitEdit();
		}
		await tick();
		tagList?.children.item(index)?.querySelector<HTMLButtonElement>('.tag-text')?.focus({ preventScroll: true });
	}

	function remove(index: number) {
		if (editing?.index === index) editing = null;
		onchange(finishEdit().filter((_, i) => i !== index).join(', '));
		input?.focus();
	}

	function keydown(event: KeyboardEvent) {
		if (event.isComposing || drag) return;
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commit();
		} else if (event.key === 'Backspace' && !draft && tags.length) {
			event.preventDefault();
			remove(tags.length - 1);
		}
	}

	function paste(event: ClipboardEvent) {
		const text = event.clipboardData?.getData('text') ?? '';
		if (/[,\r\n]/.test(text)) {
			event.preventDefault();
			commit(draft + text);
		}
	}
</script>

<div class="tags-input">
	<input {id} class="input-base new-tag" bind:this={input} bind:value={draft} onkeydown={keydown} onpaste={paste}
		onblur={() => commit()} readonly={drag !== null} placeholder="Add a tag and press Enter…" />
	{#if items.length}
		<ul class="tag-list" aria-label="Tags" bind:this={tagList}
			use:dragHandleZone={{ items, type: 'threads-ao3-tags', flipDurationMs, dropTargetStyle: {}, dropFromOthersDisabled: true, dragDisabled: editing !== null, delayTouchStart: 180, useCursorForDetection: true }}
			onconsider={considerReorder} onfinalize={finalizeReorder}>
			{#each items as { id: tagId, text: tag, isDndShadowItem }, index (isDndShadowItem ? `shadow:${tagId}` : tagId)}
				<li class="tag" aria-label={tag} data-is-dnd-shadow-item-hint={isDndShadowItem} animate:flip={{ duration: flipDurationMs }}>
					{#if tags.length > 1}
						<span class="tag-grip" use:dragHandle aria-label={`Drag to reorder ${tag}`} title="Drag to reorder">
							<Icon name="menu" class="w-3 h-3" />
						</span>
					{/if}
					{#if editing?.index === index}
						<input type="text" class="tag-edit" bind:this={editInput} value={editing.text} aria-label={`Edit ${tag}`}
							style:width={`${Math.max(4, editing.text.length + 1)}ch`} onkeydown={(event) => editKeydown(event, index)}
							oninput={(event) => { if (editing?.index === index) editing.text = event.currentTarget.value; }}
							onblur={() => { if (editing?.index === index) commitEdit(); }} />
					{:else}
						<button type="button" class="tag-text" aria-label={`Edit ${tag}`} title={tag}
							disabled={drag !== null} onclick={() => startEdit(index, tag)}>{tag}</button>
					{/if}
					<button type="button" class="tag-remove" aria-label={`Remove ${tag}`} disabled={drag !== null} onclick={() => remove(index)}>
						<Icon name="x" class="w-3 h-3" />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.tags-input { display: grid; gap: 0.5rem; min-width: 0; }
	.new-tag { width: 100%; min-width: 0; padding: 0.55rem 0.65rem; font: 0.8rem var(--font-ui); }
	.new-tag::placeholder { color: var(--color-text-muted); }
	.tag-list {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		padding: 0;
		margin: 0;
		min-width: 0;
		list-style: none;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		max-width: 100%;
		padding: 0.125rem 0.25rem 0.125rem 0.5rem;
		border-radius: var(--radius-full);
		background: var(--color-accent-muted);
		color: var(--color-accent);
		font-family: var(--font-ui);
		font-size: 0.75rem;
	}
	.tag-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; }
	.tag-text:hover, .tag-text:focus-visible { text-decoration: underline; }
	.tag-edit { min-width: 0; max-width: 24ch; background: transparent; border: 0; outline: none; color: var(--color-text-primary); font: inherit; }
	.tag-grip { display: grid; place-items: center; flex-shrink: 0; width: 1rem; height: 1rem; color: var(--color-text-muted); touch-action: none; }
	.tag-grip:hover, .tag-grip:focus-visible { color: var(--color-accent); }
	.tag-remove {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 1rem;
		height: 1rem;
		border-radius: var(--radius-full);
		color: color-mix(in srgb, var(--color-accent) 70%, transparent);
	}
	.tag-remove:hover { color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 15%, transparent); }
	@media (pointer: coarse) {
		.tag-grip { width: 1.25rem; height: 1.5rem; }
		.tag-remove { width: 1.75rem; height: 1.75rem; margin: -0.375rem; }
	}
</style>
