<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { EditAction } from '#lib/types/chat.ts';

	interface Props {
		initialContent: string;
		draftContent: string;
		focusOnMount: boolean;
		role: 'user' | 'assistant' | 'system';
		/** Which of the two edits this is. 'save_only' rewrites the turn in place; 'create_branch'
		 *  copies its history into a new chat ending at this turn. Chosen by the caller BEFORE the
		 *  editor opens (Edit vs Branch), never asked for afterwards: asking at save time makes
		 *  you decide what you meant while still holding the prose in your head, and hides a
		 *  subtree delete behind a Save button. Cancel in branch mode costs nothing, because
		 *  the new chat is only created on save. */
		mode?: EditAction;
		onSave: (content: string, action: EditAction) => void;
		onCancel: () => void;
		onChange: (content: string) => void;
	}

	let { initialContent, draftContent, focusOnMount, role, mode = 'save_only', onSave, onCancel, onChange }: Props = $props();

	let content = $state(untrack(() => draftContent));
	let textareaElement: HTMLTextAreaElement;
	let buttonsElement = $state<HTMLDivElement | undefined>(undefined);

	const isBranch = $derived(mode === 'create_branch');

	function autoResize() {
		if (textareaElement) {
			textareaElement.style.height = 'auto';
			textareaElement.style.height = textareaElement.scrollHeight + 'px';
		}
	}

	onMount(() => {
		autoResize();
		if (focusOnMount) {
			textareaElement.focus();
			buttonsElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	});

	function handleSaveClick() {
		if (content.trim() === '') return;
		// An in-place save of untouched text is a no-op, so it just closes. A branch of
		// untouched text is NOT: a verbatim copy is a legitimate chat to continue later.
		if (!isBranch && content === initialContent) {
			onCancel();
			return;
		}
		onSave(content, mode);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			// Claim the key so the workspace's global Esc doesn't also close the
			// hosting panel on the same press.
			e.preventDefault();
			onCancel();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="space-y-3">
	{#if isBranch}
		<p class="text-xs font-ui text-text-muted">
			Create a new chat with the history up to this {role === 'user' ? 'turn' : 'reply'}. The original chat stays unchanged.
		</p>
	{/if}

	<textarea
		bind:this={textareaElement}
		bind:value={content}
		oninput={(event) => { autoResize(); onChange(event.currentTarget.value); }}
		class="w-full font-body text-text-primary resize-none overflow-hidden border border-text-muted/30 outline-none placeholder:text-text-muted"
		style="font-size: inherit; line-height: 1.55; padding: 0.5rem; background: rgb(0 0 0 / 0.3);"
		placeholder="Enter your message…"
	></textarea>

	<div class="flex justify-end">
		<div
			bind:this={buttonsElement}
			class="inline-flex items-center gap-0.5 bg-bg-secondary rounded-[var(--radius-lg)] p-1 shadow-[var(--shadow-sm)] border border-border-subtle"
		>
			<button
				class="px-3 py-1.5 text-sm font-ui font-medium text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-[var(--radius-md)] transition-all duration-150"
				onclick={onCancel}
			>
				Cancel
			</button>
			<button
				class="px-3 py-1.5 text-sm font-ui font-medium text-accent hover:bg-accent/10 rounded-[var(--radius-md)] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
				onclick={handleSaveClick}
				disabled={content.trim() === ''}
			>
				{isBranch ? 'Create branch' : 'Save'}
			</button>
		</div>
	</div>
</div>
