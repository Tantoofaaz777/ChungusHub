<script lang="ts">
	import { llmService } from '#lib/services/llm/provider.ts';
	import { countTokens } from '#lib/tokenizer/count.ts';
	import { withTokenizers } from '#lib/tokenizer/loader.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';

	let { value, label, entityId }: { value: string; label: string; entityId: string } = $props();
	let model = $derived(llmService.getPrimaryModel());
	let count = $state<number | null>(null);
	let counting = $state(false);
	let revision = 0;
	let previous: { value: string; model: string; entityId: string } | undefined;

	// Edits only forget the result. Tokenization runs exclusively on a button press.
	// Reset on model/entry changes too, including edits made in the expanded editor.
	$effect(() => {
		const current = { value, model, entityId };
		// The parent rebuilds its field descriptors together. An unchanged field must
		// retain its result when a different field is edited.
		if (!previous || previous.value !== value || previous.model !== model || previous.entityId !== entityId) {
			count = null;
			revision++; counting = false;
		}
		previous = current;
	});
	async function measure() {
		const ticket = ++revision, text = value, target = model;
		counting = true;
		try {
			const next = await withTokenizers(() => countTokens(text, target));
			if (ticket === revision) count = next;
		} catch (error) { if (ticket === revision) toastStore.failed('count tokens', error); }
		finally { if (ticket === revision) counting = false; }
	}
</script>

<button
	type="button"
	class="field-token-count"
	class:has-count={count !== null}
	onclick={measure}
	disabled={counting}
	aria-label={count === null
		? `Count tokens in ${label}`
		: `${label}: ${count.toLocaleString()} tokens. Count again`}
	aria-live="polite"
	title={`Count tokens in ${label}`}
>
	<span aria-hidden="true">#</span>
	{counting ? 'Counting…' : count === null ? 'Count tokens' : `${count.toLocaleString()} tokens`}
</button>

<style>
	.field-token-count {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		padding: 0.125rem 0.25rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		transition: color 140ms ease, background-color 140ms ease;
	}

	.field-token-count:hover {
		color: var(--color-text-primary);
		background: var(--color-bg-tertiary);
	}

	.field-token-count.has-count { color: var(--color-accent); }
</style>
