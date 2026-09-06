<script lang="ts">
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';
	import { autoResize } from '$lib/actions/autoResize';
	import { tokenizeEditorSyntax } from '$lib/utils/editor-syntax';

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
	let expandedMirror = $state<HTMLDivElement | null>(null);
	let selectionStart = 0;
	let selectionEnd = 0;
	let restoreSelection = false;
	let syntaxSegments = $derived(open ? tokenizeEditorSyntax(value) : []);

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

	function syncExpandedScroll(event: Event & { currentTarget: HTMLTextAreaElement }): void {
		if (!expandedMirror) return;
		expandedMirror.scrollTop = event.currentTarget.scrollTop;
		expandedMirror.scrollLeft = event.currentTarget.scrollLeft;
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
			<div
				bind:this={expandedMirror}
				aria-hidden="true"
				class="expanded-mirror panel-scroll {expandedClass}"
			>
				{#each syntaxSegments as segment}
					{#if segment.kind === 'plain'}
						{segment.text}
					{:else}
						<span class="syntax-{segment.kind}">{segment.text}</span>
					{/if}
				{/each}{'\u200b'}
			</div>
			<textarea
				{placeholder}
				{disabled}
				{readonly}
				{spellcheck}
				{value}
				oninput={(event) => onValueChange(event.currentTarget.value)}
				onfocus={restoreCaret}
				onscroll={syncExpandedScroll}
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
		--editor-syntax-tag: #e06c75;
		--editor-syntax-code: #56b6c2;
		--editor-syntax-macro: #d19a66;

		position: relative;
		flex: 1;
		display: flex;
		min-height: 0;
	}

	.expanded-mirror,
	.expanded-textarea {
		width: 100%;
		height: 100%;
		min-height: 0;
		padding: clamp(1rem, 2.5vw, 1.75rem);
		padding-bottom: max(clamp(1rem, 2.5vw, 1.75rem), env(safe-area-inset-bottom));
		line-height: 1.6;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		word-break: normal;
		tab-size: 4;
		text-align: left;
		scrollbar-gutter: stable;
	}

	.expanded-mirror {
		position: absolute;
		inset: 0;
		overflow-x: hidden;
		overflow-y: scroll;
		color: var(--color-text-primary);
		pointer-events: none;
		user-select: none;
		scrollbar-color: transparent transparent;
	}

	.expanded-textarea {
		position: relative;
		z-index: 1;
		flex: 1;
		border: 0;
		border-radius: 0;
		outline: 0;
		background: transparent;
		color: transparent !important;
		-webkit-text-fill-color: transparent;
		caret-color: var(--color-text-primary);
		resize: none;
		overscroll-behavior: contain;
	}

	.expanded-textarea::placeholder {
		color: var(--color-text-muted) !important;
		-webkit-text-fill-color: var(--color-text-muted);
	}

	.syntax-tag {
		color: var(--editor-syntax-tag) !important;
	}

	.syntax-code {
		color: var(--editor-syntax-code) !important;
	}

	.syntax-macro {
		color: var(--editor-syntax-macro) !important;
	}

	/* app.css raises touch form controls to 16px so iOS does not zoom the viewport on focus.
	   The visible text here belongs to the mirror rather than the textarea, so both layers
	   must take that same floor or the native caret wraps against different font metrics. */
	@media (pointer: coarse) {
		.expanded-mirror,
		.expanded-textarea {
			font-size: max(16px, 1em);
		}
	}

	@media (forced-colors: active) {
		.expanded-mirror {
			display: none;
		}

		.expanded-textarea {
			color: CanvasText !important;
			-webkit-text-fill-color: CanvasText;
			background: Canvas !important;
			caret-color: CanvasText;
		}

		.expanded-textarea::placeholder {
			color: GrayText !important;
			-webkit-text-fill-color: GrayText;
		}
	}
</style>
