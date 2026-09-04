<script lang="ts">
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';
	import { autoResize } from '$lib/actions/autoResize';

	interface Props {
		/** The one live value used by both the inline field and the expanded editor. */
		value: string;
		onValueChange: (value: string) => void;
		dialogTitle: string;
		expandLabel?: string;
		id?: string;
		placeholder?: string;
		rows?: number;
		maxHeight?: number;
		class?: string;
		expandedClass?: string;
		disabled?: boolean;
		readonly?: boolean;
		spellcheck?: boolean;
	}

	let {
		value,
		onValueChange,
		dialogTitle,
		expandLabel = 'Expand text editor',
		id,
		placeholder,
		rows,
		maxHeight = 300,
		class: className = '',
		expandedClass = '',
		disabled = false,
		readonly = false,
		spellcheck
	}: Props = $props();

	let open = $state(false);
	let inlineTextarea = $state<HTMLTextAreaElement | null>(null);
	let selectionStart = 0;
	let selectionEnd = 0;
	let restoreSelection = false;

	function openEditor(): void {
		selectionStart = inlineTextarea?.selectionStart ?? 0;
		selectionEnd = inlineTextarea?.selectionEnd ?? selectionStart;
		restoreSelection = true;
		open = true;
	}

	function restoreCaret(event: FocusEvent & { currentTarget: HTMLTextAreaElement }): void {
		if (!restoreSelection) return;
		restoreSelection = false;
		event.currentTarget.setSelectionRange(selectionStart, selectionEnd);
	}
</script>

<div class="textarea-shell">
	<textarea
		bind:this={inlineTextarea}
		use:autoResize={{ maxHeight, value }}
		{id}
		{placeholder}
		{rows}
		{disabled}
		{readonly}
		{spellcheck}
		{value}
		oninput={(event) => onValueChange(event.currentTarget.value)}
		class="inline-textarea {className}"
	></textarea>
	<Button
		variant="secondary"
		size="sm"
		class="!absolute !top-2 !right-2 !w-8 !h-8 !p-0 z-[1] bg-bg-primary/90 backdrop-blur-sm"
		disabled={disabled}
		onclick={openEditor}
		aria-label={expandLabel}
		aria-haspopup="dialog"
		title={expandLabel}
	>
		<Icon name="expand" class="w-4 h-4" strokeWidth={1.75} />
	</Button>
</div>

<Dialog
	{open}
	onClose={() => (open = false)}
	title={dialogTitle}
	titleAlign="left"
	size="2xl"
	bare
	fill
	mobileFullscreen
>
	<div class="expanded-editor">
		<div class="expanded-body">
			<textarea
				{placeholder}
				{disabled}
				{readonly}
				{spellcheck}
				{value}
				oninput={(event) => onValueChange(event.currentTarget.value)}
				onfocus={restoreCaret}
				aria-label={dialogTitle}
				data-dialog-initial-focus
				class="expanded-textarea panel-scroll {expandedClass}"
			></textarea>
		</div>
	</div>
</Dialog>

<style>
	.textarea-shell {
		position: relative;
	}

	/* The trigger sits inside the field's quiet corner. Reserving its width keeps the first
	   line of authored text and the control from occupying the same pixels. */
	.inline-textarea {
		display: block;
		padding-right: 3.25rem !important;
	}

	/* The header stays put while the textarea owns the only scrollbar for the document. */
	.expanded-editor {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.expanded-body {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	.expanded-textarea {
		flex: 1;
		width: 100%;
		min-height: 0;
		padding: clamp(1rem, 2.5vw, 1.75rem);
		padding-bottom: max(clamp(1rem, 2.5vw, 1.75rem), env(safe-area-inset-bottom));
		border: 0;
		border-radius: 0;
		outline: 0;
		background: transparent;
		line-height: 1.6;
		resize: none;
		overscroll-behavior: contain;
	}
</style>
