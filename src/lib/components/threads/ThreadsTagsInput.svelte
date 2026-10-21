<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	let { id, value, onchange }: { id: string; value: string; onchange: (value: string) => void } = $props();
	let draft = $state('');
	let input: HTMLInputElement | undefined = $state();
	// Keep the existing comma-separated storage and prompt format, including older notes.
	const split = (text: string) => text.split(/[,\r\n]+/).map(tag => tag.trim()).filter(Boolean);
	const tags = $derived(split(value));

	function commit(text = draft) {
		const added = split(text);
		draft = '';
		if (!added.length) return;
		const next = [...new Set([...tags, ...added])];
		if (next.length !== tags.length) onchange(next.join(', '));
	}

	function remove(index: number) {
		onchange(tags.filter((_, i) => i !== index).join(', '));
		input?.focus();
	}

	function keydown(event: KeyboardEvent) {
		if (event.isComposing) return;
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

<div class="tags-input input-base">
	{#each tags as tag, index (index)}
		<span class="tag">
			<span class="tag-text" title={tag}>{tag}</span>
			<button type="button" class="tag-remove" aria-label={`Remove ${tag}`} onclick={() => remove(index)}>
				<Icon name="x" class="w-3 h-3" />
			</button>
		</span>
	{/each}
	<input {id} bind:this={input} bind:value={draft} onkeydown={keydown} onpaste={paste}
		onblur={() => commit()} placeholder="Add a tag and press Enter…" />
</div>

<style>
	.tags-input {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.625rem;
		min-width: 0;
	}
	.tags-input input {
		flex: 1;
		min-width: 8rem;
		max-width: 100%;
		background: transparent;
		border: 0;
		outline: none;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-text-primary);
	}
	.tags-input input::placeholder { color: var(--color-text-muted); }
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
	.tag-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
		.tag-remove { width: 1.75rem; height: 1.75rem; margin: -0.375rem; }
	}
</style>
