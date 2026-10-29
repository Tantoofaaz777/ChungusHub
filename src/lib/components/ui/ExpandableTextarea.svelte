<script lang="ts">
	import { tick, untrack } from 'svelte';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Icon from './Icon.svelte';
	import MacroReference from './MacroReference.svelte';
	import { autoResize } from '#lib/actions/autoResize.ts';
	import { tokenizeEditorSyntax } from '#lib/utils/editor-syntax.ts';
	import { MAX_MATCHES } from '#lib/utils/chat-search.ts';
	import { findEditorMatches, markEditorMatches, replaceAllEditorMatches } from '#lib/utils/editor-search.ts';

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
		macroControls?: { name: string; description: string }[];
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
		spellcheck,
		macroControls
	}: Props = $props();

	let open = $state(false);
	let inlineTextarea = $state<HTMLTextAreaElement | null>(null);
	let expandedMirror = $state<HTMLDivElement | null>(null);
	let expandedTextarea = $state<HTMLTextAreaElement | null>(null);
	let findInput = $state<HTMLInputElement | null>(null);
	let replaceInput = $state<HTMLInputElement | null>(null);
	let findOpen = $state(false);
	let macrosOpen = $state(false);
	let query = $state('');
	let replacement = $state('');
	let matchCase = $state(false);
	let wholeWord = $state(false);
	let activeStart = $state(0);
	let revealNonce = $state(0);
	let selectionStart = 0;
	let selectionEnd = 0;
	let restoreSelection = false;
	let syntaxSegments = $derived(open ? tokenizeEditorSyntax(value) : []);
	let searchOptions = $derived({ matchCase, wholeWord });
	let matches = $derived(open && findOpen ? findEditorMatches(value, query, searchOptions) : []);
	let current = $derived.by(() => {
		const index = matches.findIndex((match) => match.start >= activeStart);
		return index >= 0 ? index : 0;
	});
	let paintedSegments = $derived(markEditorMatches(syntaxSegments, matches));
	let countLabel = $derived(!query ? '' : matches.length
		? `${current + 1} / ${matches.length}${matches.length >= MAX_MATCHES ? '+' : ''}`
		: 'No matches');

	async function showFind(focusReplacement = false): Promise<void> {
		if (!findOpen && expandedTextarea) {
			const selected = value.slice(expandedTextarea.selectionStart, expandedTextarea.selectionEnd);
			if (selected && !/[\r\n]/.test(selected)) query = selected;
		}
		findOpen = true;
		activeStart = 0;
		revealNonce++;
		await tick();
		const input = focusReplacement && !readonly && !disabled ? replaceInput : findInput;
		input?.focus();
		input?.select();
	}

	function closeFind(): void {
		findOpen = false;
		expandedTextarea?.focus({ preventScroll: true });
	}

	function go(direction: 1 | -1): void {
		if (!matches.length) return;
		activeStart = matches[(current + direction + matches.length) % matches.length].start;
		revealNonce++;
	}

	/** Native insertion keeps replacements in the textarea's Undo history. */
	function insertReplacement(start: number, end: number, text: string): void {
		const textarea = expandedTextarea;
		if (!textarea || readonly || disabled) return;
		const previousFocus = document.activeElement as HTMLElement | null;
		textarea.focus({ preventScroll: true });
		textarea.setSelectionRange(start, end);
		if (!document.execCommand('insertText', false, text)) {
			textarea.setRangeText(text, start, end, 'end');
			textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
		}
		previousFocus?.focus({ preventScroll: true });
	}

	function replaceCurrent(): void {
		const match = matches[current];
		if (!match || readonly || disabled) return;
		insertReplacement(match.start, match.end, replacement);
		// Skip the inserted text even when it contains the query itself.
		activeStart = match.start + replacement.length;
		revealNonce++;
	}

	function replaceAll(): void {
		if (!matches.length || readonly || disabled) return;
		const updated = replaceAllEditorMatches(value, query, replacement, searchOptions);
		if (updated !== value) insertReplacement(0, value.length, updated);
		activeStart = 0;
		revealNonce++;
	}

	function handleEditorKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		if ((event.ctrlKey || event.metaKey) && !event.altKey && /^(f|h)$/i.test(event.key)) {
			event.preventDefault();
			event.stopPropagation();
			void showFind(event.key.toLowerCase() === 'h');
		} else if (event.key === 'Escape' && findOpen) {
			event.preventDefault();
			event.stopPropagation();
			closeFind();
		} else if (event.key === 'Enter' && (event.target === findInput || event.target === replaceInput)) {
			event.preventDefault();
			event.stopPropagation();
			if (event.target === replaceInput) replaceCurrent();
			else go(event.shiftKey ? -1 : 1);
		}
	}

	function editorShortcuts(node: HTMLElement) {
		node.addEventListener('keydown', handleEditorKeydown);
		return { destroy: () => node.removeEventListener('keydown', handleEditorKeydown) };
	}

	$effect(() => {
		// Counts stay live during editing; only an explicit search action moves the caret.
		void revealNonce;
		const textarea = expandedTextarea;
		const mirror = expandedMirror;
		if (!open || !findOpen || !textarea || !mirror) return;
		const { match, index, documentText } = untrack(() => ({ match: matches[current], index: current, documentText: value }));
		if (!match) return;
		let cancelled = false;
		void tick().then(() => {
			if (cancelled || value !== documentText) return;
			textarea.setSelectionRange(match.start, match.end);
			const marker = mirror.querySelector<HTMLElement>(`[data-editor-match="${index}"]`);
			if (!marker) return;
			const target = textarea.scrollTop + marker.getBoundingClientRect().top
				- mirror.getBoundingClientRect().top - textarea.clientHeight * 0.35;
			textarea.scrollTop = Math.max(0, Math.min(target, textarea.scrollHeight - textarea.clientHeight));
			mirror.scrollTop = textarea.scrollTop;
			mirror.scrollLeft = textarea.scrollLeft;
		});
		return () => { cancelled = true; };
	});

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
	onClose={() => { open = false; findOpen = false; macrosOpen = false; }}
	title={dialogTitle}
	titleAlign="left"
	titleDivider={false}
	size="2xl"
	bare
	fill
	mobileFullscreen
>
	<div class="expanded-editor" use:editorShortcuts>
		<div class="editor-tools">
			<div class="editor-tool-buttons">
				<Button variant="ghost" size="sm" aria-expanded={findOpen} onclick={() => findOpen ? closeFind() : void showFind()}>
					<Icon name="search" class="w-3.5 h-3.5" />
					Find &amp; replace
				</Button>
				<Button variant="ghost" size="sm" aria-haspopup="dialog" onclick={() => { macrosOpen = true; }}>
					<Icon name="sparkles" class="w-3.5 h-3.5" />
					Macros
				</Button>
			</div>
			{#if findOpen}
				<div class="editor-find" role="search" aria-label="Find and replace in {dialogTitle}">
					<div class="editor-find-row">
						<input bind:this={findInput} value={query} oninput={(event) => { query = event.currentTarget.value; activeStart = 0; revealNonce++; }}
							type="text" class="editor-find-input" placeholder="Find in this field…" aria-label="Find text" autocomplete="off" spellcheck="false" />
						<span class="editor-find-count" aria-live="polite">{countLabel}</span>
						<button type="button" class="editor-find-nav" disabled={!matches.length} aria-label="Previous match" title="Previous match (Shift+Enter)" onclick={() => go(-1)}><Icon name="chevronUp" class="w-4 h-4" /></button>
						<button type="button" class="editor-find-nav" disabled={!matches.length} aria-label="Next match" title="Next match (Enter)" onclick={() => go(1)}><Icon name="chevronDown" class="w-4 h-4" /></button>
						<button type="button" class="editor-find-nav" aria-label="Close search" title="Close search (Esc)" onclick={closeFind}><Icon name="close" class="w-4 h-4" /></button>
					</div>
					<div class="editor-find-row">
						<input bind:this={replaceInput} bind:value={replacement} type="text" class="editor-find-input" placeholder="Replace with…" aria-label="Replace with" autocomplete="off" spellcheck="false" disabled={readonly || disabled} />
						<Button variant="secondary" size="sm" disabled={readonly || disabled || !matches.length} onclick={replaceCurrent}>Replace</Button>
						<Button variant="secondary" size="sm" disabled={readonly || disabled || !matches.length} onclick={replaceAll} title="Replace every match in this field">Replace all</Button>
					</div>
					<div class="editor-find-options">
						<button type="button" class="editor-find-option" class:is-on={matchCase} aria-pressed={matchCase} onclick={() => { matchCase = !matchCase; activeStart = 0; revealNonce++; }}>Match case</button>
						<button type="button" class="editor-find-option" class:is-on={wholeWord} aria-pressed={wholeWord} onclick={() => { wholeWord = !wholeWord; activeStart = 0; revealNonce++; }}>Whole words</button>
					</div>
				</div>
			{/if}
		</div>
		<div class="expanded-body">
			<div
				bind:this={expandedMirror}
				aria-hidden="true"
				class="expanded-mirror panel-scroll {expandedClass}"
			>
				{#each paintedSegments as segment}
					<span class="syntax-{segment.kind}" class:editor-match={segment.match !== null}
						class:is-current={segment.match !== null && segment.match === current}
						data-editor-match={segment.match ?? undefined}>{segment.text}</span>
				{/each}{'\u200b'}
			</div>
			<textarea
				bind:this={expandedTextarea}
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

{#if open && macrosOpen}
	<Dialog open onClose={() => { macrosOpen = false; }} title="Macros" titleAlign="left" size="xl" bare fill mobileFullscreen>
		<MacroReference collapsible={false} templates controls={macroControls} />
	</Dialog>
{/if}

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

	.editor-tools {
		flex-shrink: 0;
		padding: 0.4rem 0.65rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.editor-tool-buttons { display: flex; flex-wrap: wrap; gap: 0.25rem; }

	.editor-find {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.45rem 0.1rem 0.15rem;
	}

	.editor-find-row, .editor-find-options {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.editor-find-input {
		flex: 1;
		min-width: 0;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		background: var(--color-input-bg);
		color: var(--color-text-primary);
		font-size: 0.8rem;
	}

	.editor-find-input::placeholder { color: var(--color-text-muted); }
	.editor-find-input:focus { outline: 1px solid var(--color-accent); }
	.editor-find-count {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.editor-find-nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.85rem;
		height: 1.85rem;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
	}
	.editor-find-nav:hover:not(:disabled) { background: var(--color-bg-tertiary); }
	.editor-find-nav:disabled { opacity: 0.35; cursor: not-allowed; }
	.editor-find-options { flex-wrap: wrap; }
	.editor-find-option {
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.editor-find-option.is-on {
		color: var(--color-accent);
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}
	.editor-match {
		background: color-mix(in srgb, var(--color-accent) 25%, transparent);
	}
	.editor-match.is-current {
		background: color-mix(in srgb, var(--color-accent) 48%, transparent);
		outline: 1px solid var(--color-accent);
	}

	.expanded-body {
		--editor-syntax-tag: #82aaff;
		--editor-syntax-code: #c3e88d;
		--editor-syntax-macro: var(--color-accent);
		--editor-syntax-bracket: #c792ea;
		--editor-syntax-heading: #f78c6c;

		position: relative;
		flex: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		min-height: 0;
	}

	.expanded-mirror,
	.expanded-textarea {
		/* Both layers occupy one grid cell: identical rounding, wrapping and glyph metrics.
		   Splitting text into colored spans must never move the native textarea's caret. */
		grid-area: 1 / 1;
		box-sizing: border-box;
		min-width: 0;
		font-family: var(--font-mono) !important;
		font-size: inherit;
		font-weight: 400;
		font-style: normal;
		font-kerning: none;
		font-variant-ligatures: none !important;
		font-variant-numeric: normal;
		font-feature-settings: "liga" 0, "calt" 0;
		font-synthesis: none;
		letter-spacing: 0;
		word-spacing: 0;
		text-indent: 0;
		text-transform: none;
		text-rendering: auto;
		-webkit-text-size-adjust: 100%;
		text-size-adjust: 100%;
		border: 0;
		overflow-anchor: none;
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
		overflow-x: hidden;
		overflow-y: auto;
		color: var(--color-text-primary);
		pointer-events: none;
		user-select: none;
		scrollbar-color: transparent transparent;
	}

	.expanded-textarea {
		position: relative;
		z-index: 1;
		overflow-x: hidden;
		overflow-y: auto;
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

	.syntax-bracket { color: var(--editor-syntax-bracket) !important; }
	.syntax-heading { color: var(--editor-syntax-heading) !important; }
	.syntax-link { color: var(--editor-syntax-tag) !important; }
	.syntax-separator { color: color-mix(in srgb, var(--color-text-muted) 60%, transparent) !important; }
	.syntax-delimiter { color: color-mix(in srgb, var(--color-text-muted) 55%, transparent) !important; }

	/* app.css raises touch form controls to 16px so iOS does not zoom the viewport on focus.
	   The visible text here belongs to the mirror rather than the textarea, so both layers
	   must take that same floor or the native caret wraps against different font metrics. */
	@media (pointer: coarse) {
		.editor-find-nav { width: 2.3rem; height: 2.3rem; }
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
