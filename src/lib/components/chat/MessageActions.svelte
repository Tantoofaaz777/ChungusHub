<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	interface Props {
		onEdit: () => void;
		onDelete: () => void;
		onCopy: () => Promise<void>;
		onTogglePrompt?: () => void;
		onToggleBookmark?: () => void;
		bookmarked?: boolean;
		bookmarkBusy?: boolean;
		onMemoryStart?: () => void;
		onMemoryEnd?: () => void;
		memoryStart?: boolean;
		memoryEnd?: boolean;
		memoryDisabled?: boolean;
		excludedFromPrompt?: boolean;
		onRegenerate?: () => void;
		showRegenerate?: boolean;
		/** Label for the regenerate button, and its accessible name: the word labels are
		 *  display:none on narrow screens, so a fixed one would name all three states wrong. */
		regenerateLabel?: string;
		/** Extend this reply from where it stopped. Sits beside Retry because the two are the
		 *  pair the hand reaches for after reading a reply: again, or more. */
		onContinue?: () => void;
		showContinue?: boolean;
		/** Copy the history through this turn into a separate chat. */
		onBranch?: () => void;
		showBranch?: boolean;
		disabled?: boolean;
	}

	let {
		onEdit,
		onDelete,
		onCopy,
		onTogglePrompt,
		onToggleBookmark,
		bookmarked = false,
		bookmarkBusy = false,
		onMemoryStart,
		onMemoryEnd,
		memoryStart = false,
		memoryEnd = false,
		memoryDisabled = false,
		excludedFromPrompt = false,
		onRegenerate,
		showRegenerate = false,
		regenerateLabel = 'Retry',
		onContinue,
		showContinue = false,
		onBranch,
		showBranch = false,
		disabled = false
	}: Props = $props();

	let justCopied = $state(false);

	// The checkmark waits for the copy: claiming it over an empty clipboard sends the
	// user off to paste nothing.
	async function handleCopy() {
		try {
			await onCopy();
		} catch {
			toastStore.error('Copy failed. Select the text and copy it by hand.');
			return;
		}
		justCopied = true;
		setTimeout(() => (justCopied = false), 1500);
	}
</script>

<div class="message-actions" role="toolbar" aria-label="Message actions">
	<button
		type="button"
		class="action-btn"
		onclick={onEdit}
		{disabled}
		aria-label="Edit message"
		title="Edit"
	>
		<Icon name="edit" class="w-3.5 h-3.5" strokeWidth={1.75} />
		<span class="action-label">Edit</span>
	</button>

	<button
		type="button"
		class="action-btn"
		onclick={handleCopy}
		aria-label="Copy message"
		title={justCopied ? 'Copied!' : 'Copy'}
	>
		<Icon name={justCopied ? 'check' : 'copy'} class="w-3.5 h-3.5" strokeWidth={1.75} />
		<span class="action-label">{justCopied ? 'Copied' : 'Copy'}</span>
	</button>

	{#if onToggleBookmark}
		<button type="button" class="action-btn" class:action-btn-active={bookmarked}
			onclick={onToggleBookmark} disabled={bookmarkBusy} aria-pressed={bookmarked}
			aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark message'}
			title={bookmarked ? 'Remove bookmark' : 'Bookmark message'}>
			<Icon name="star" class="w-3.5 h-3.5 {bookmarked ? 'fill-current' : ''}" strokeWidth={1.75} />
			<span class="action-label">Bookmark</span>
		</button>
	{/if}

	{#if showRegenerate && onRegenerate}
		<button
			type="button"
			class="action-btn"
			onclick={onRegenerate}
			{disabled}
			aria-label={regenerateLabel}
			title={regenerateLabel}
		>
			<Icon name="refresh" class="w-3.5 h-3.5" strokeWidth={1.75} />
			<span class="action-label">{regenerateLabel}</span>
		</button>
	{/if}

	{#if onMemoryStart && onMemoryEnd}
		<button type="button" class="action-btn" class:action-btn-active={memoryStart}
			onclick={onMemoryStart} disabled={disabled || memoryDisabled}
			aria-label="Start chapter range" aria-pressed={memoryStart} title="Start chapter here ↓">
			<Icon name="chevronDown" class="w-3.5 h-3.5" strokeWidth={1.75} />
		</button>
		<button type="button" class="action-btn" class:action-btn-active={memoryEnd}
			onclick={onMemoryEnd} disabled={disabled || memoryDisabled}
			aria-label="End chapter range" aria-pressed={memoryEnd} title="End chapter here ↑">
			<Icon name="chevronUp" class="w-3.5 h-3.5" strokeWidth={1.75} />
		</button>
	{/if}

	{#if showContinue && onContinue}
		<button
			type="button"
			class="action-btn"
			onclick={onContinue}
			{disabled}
			aria-label="Continue this reply"
			title="Continue: extend this reply from where it stopped"
		>
			<Icon name="feather" class="w-3.5 h-3.5" strokeWidth={1.75} />
			<span class="action-label">Continue</span>
		</button>
	{/if}

	{#if showBranch && onBranch}
		<button
			type="button"
			class="action-btn"
			onclick={onBranch}
			{disabled}
			aria-label="Branch this turn"
			title="Branch: create a new chat with the history up to this message"
		>
			<Icon name="branch" class="w-3.5 h-3.5" strokeWidth={1.75} />
			<span class="action-label">Branch</span>
		</button>
	{/if}

	{#if onTogglePrompt}
		<button
			type="button"
			class="action-btn"
			class:action-btn-active={excludedFromPrompt}
			onclick={onTogglePrompt}
			{disabled}
			aria-label={excludedFromPrompt ? 'Include message in prompt' : 'Exclude message from prompt'}
			aria-pressed={excludedFromPrompt}
			title={excludedFromPrompt ? 'Include in prompt' : 'Exclude from prompt'}
		>
			<Icon name={excludedFromPrompt ? 'eyeOff' : 'eye'} class="w-3.5 h-3.5" strokeWidth={1.75} />
			<span class="action-label">{excludedFromPrompt ? 'Include' : 'Exclude'}</span>
		</button>
	{/if}

	<button
		type="button"
		class="action-btn action-btn-danger"
		onclick={onDelete}
		{disabled}
		aria-label="Delete message"
		title="Delete"
	>
		<Icon name="trash" class="w-3.5 h-3.5" strokeWidth={1.75} />
		<span class="action-label">Delete</span>
	</button>
</div>

<style>
	.message-actions {
		display: flex;
		box-sizing: border-box;
		max-width: 100%;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
		align-items: center;
		gap: 0.2rem;
		padding: 0.16rem;
		border-radius: var(--radius-lg);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 92%, transparent);
		background: color-mix(in srgb, var(--color-bg-secondary) 76%, transparent);
	}

	.message-actions::-webkit-scrollbar {
		display: none;
	}

	/* Compact, icon-only actions at every viewport size. */
	.action-btn {
		flex-shrink: 0;
		height: 1.6rem;
		min-width: 1.6rem;
		padding: 0 0.4rem;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		display: inline-flex;
		align-items: center;
		gap: 0;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		cursor: pointer;
		transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
	}

	.action-btn:hover {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
		border-color: color-mix(in srgb, var(--color-border) 76%, transparent);
	}

	.action-btn:focus-visible {
		outline: 0;
		border-color: color-mix(in srgb, var(--color-accent) 85%, white 15%);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent-muted) 70%, transparent);
	}

	.action-btn-danger:hover {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 12%, transparent);
		border-color: color-mix(in srgb, var(--color-error) 45%, transparent);
	}

	.action-btn-active {
		color: var(--color-accent);
		background: var(--color-accent-muted);
	}

	.action-label {
		display: none;
		line-height: 1;
		white-space: nowrap;
	}

	/* Keep every touch target taller than desktop, including on a touch laptop. */
	@media (pointer: coarse) {
		.action-btn {
			height: 2.1rem;
			min-width: 2.1rem;
		}
	}

	/* Equal square targets keep the icons aligned on narrow touch screens. */
	@media (pointer: coarse) and (max-width: 900px) {
		.message-actions {
			gap: 0.08rem;
			padding: 0.1rem;
		}

		.action-btn {
			box-sizing: border-box;
			flex: 0 0 2.1rem;
			width: 2.1rem;
			height: 2.1rem;
			padding: 0;
			justify-content: center;
		}
	}
</style>
