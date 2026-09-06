<script lang="ts">
	/**
	 * The app's one asking surface for destructive acts on things not fully in front of the
	 * reader (the destructive-act ladder, architecture/ui-shell-settings.md). The message
	 * names the thing in quotes and states the real numbers of what goes.
	 *
	 * `holdMs` is the heavy rung: pass `holdMsForBlast(n)` with the same count the message
	 * states and a big enough loss turns the confirm into a press-and-hold, the identical
	 * gesture the transcript's subtree delete uses, so muscle memory alone can never fire
	 * it. Zero (the default, and everything under HOLD_THRESHOLD) stays a plain click.
	 *
	 * `destructive` puts the dialog on the ladder, which is what lets the reader's rung skip
	 * it entirely. It is opt-in on purpose: this component also carries cost confirmations
	 * and discard-draft prompts, neither of which is a delete, and a new one
	 * of those must not become skippable by inheriting a default it never asked for.
	 */
	import { untrack } from 'svelte';
	import Dialog from './Dialog.svelte';
	import Button from './Button.svelte';
	import HoldToConfirmButton from './HoldToConfirmButton.svelte';
	import { deleteGuard, QUICK_WINDOW_MS, WINDOW_CHOICES } from '$lib/stores/delete-guard.svelte';

	interface Props {
		open: boolean;
		title?: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'danger' | 'default';
		/** > 0 turns the confirm button into a press-and-hold of this length. */
		holdMs?: number;
		/** This dialog gates a destructive act, so the reader's rung decides whether it is
		 *  shown at all and it may offer the quiet window below. */
		destructive?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let {
		open,
		title = 'Confirm',
		message,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		variant = 'default',
		holdMs = 0,
		destructive = false,
		onConfirm,
		onCancel
	}: Props = $props();

	let armWindow = $state(false);

	let asked = $derived(!destructive || deleteGuard.asks);

	// Answered rather than hidden: the call site opened this because it needs a decision, so
	// with asking switched off the decision is yes, taken the moment it was raised. The read
	// happens once per opening, never again while the dialog stands, or a window armed from
	// inside it would pull the gate out from under the act standing on it.
	let raised = false;
	$effect(() => {
		if (!open) {
			raised = false;
			armWindow = false;
			return;
		}
		if (raised) return;
		raised = true;
		if (!untrack(() => asked)) untrack(() => onConfirm());
	});

	function confirm(): void {
		// The window opens behind this act, never in front of it: whatever is being confirmed
		// right now still pays the gate it was raised with, and a delete the reader backed out
		// of leaves no lowered guard behind.
		onConfirm();
		if (armWindow) deleteGuard.openWindow('off', QUICK_WINDOW_MS);
	}
</script>

<Dialog open={open && asked} onClose={onCancel} {title} size="sm">
	<p class="text-text-secondary font-ui text-sm mb-6">{message}</p>
	{#if destructive && deleteGuard.holds}
		<label class="skip-offer">
			<input type="checkbox" bind:checked={armWindow} />
			<span>Stop asking for {WINDOW_CHOICES[0].label} after this one</span>
		</label>
	{/if}
	<div class="actions">
		<Button variant="ghost" onclick={onCancel}>
			{cancelLabel}
		</Button>
		{#if holdMs > 0}
			<HoldToConfirmButton {holdMs} shape="inline" onconfirm={confirm}>
				{confirmLabel}
			</HoldToConfirmButton>
		{:else}
			<Button
				variant={variant === 'danger' ? 'danger' : 'primary'}
				onclick={confirm}
			>
				{confirmLabel}
			</Button>
		{/if}
	</div>
</Dialog>

<style>
	/* Both actions take the width of the wider one, so the footer reads as a pair whatever
	   the labels say: sized to their own text, a long confirm label squeezes Cancel down to
	   four letters beside it and then wraps itself onto a second line anyway. The grid
	   shrink-wraps to its content and the 1fr columns equalise inside that, so the footer
	   stays right-aligned and no width is spent on labels that do not need it. Under a
	   label too long for the dialog both columns give way together rather than one alone. */
	.actions {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: 0.75rem;
		width: max-content;
		max-width: 100%;
		margin-left: auto;
	}

	/* Offered here because this is where the intent to delete several things actually shows
	   up, and a trip to Settings and back is most of the time a cleanup pass costs. It is
	   deliberately the quietest thing in the dialog: an escape hatch printed louder than the
	   warning it escapes is an invitation rather than an option. */
	.skip-offer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: -0.75rem 0 1.25rem;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.75rem;
		cursor: pointer;
	}
	.skip-offer input {
		width: 0.85rem;
		height: 0.85rem;
		accent-color: var(--color-accent);
		cursor: pointer;
	}
	.skip-offer:hover {
		color: var(--color-text-secondary);
	}
</style>
