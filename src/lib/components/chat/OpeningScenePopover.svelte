<script lang="ts">
	/**
	 * The one question an opening scene has: what should it be about.
	 *
	 * One box rather than a Random/Custom pair, because leaving the box empty IS the random
	 * answer and a choice that answers itself does not deserve a step of its own. It closes the
	 * moment generation starts: the scene streams into the transcript behind it, and the
	 * composer's Stop has to be reachable while it does.
	 *
	 * The shared centered Dialog keeps this identical to the other composer action windows:
	 * title and X in the same places, focus trapped inside, and one Escape/backdrop contract.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { autoResize } from '$lib/actions/autoResize';
	import { viewport } from '$lib/stores/viewport.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		onGenerate: (direction: string) => void;
	}

	let { open, onClose, onGenerate }: Props = $props();

	let direction = $state('');

	function submit() {
		onGenerate(direction);
		// Deliberately not cleared: rolling the same idea again is then one press. It is
		// component state and dies with the row, since a direction is not a draft.
		onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		// Enter submits on pointer devices only, the composer's own rule: on touch Enter is a
		// newline and the button is the way through.
		if (e.key === 'Enter' && !e.shiftKey && !viewport.isTouch) {
			e.preventDefault();
			submit();
		}
	}
</script>

<Dialog {open} {onClose} title="Opening scene" titleAlign="left" size="sm" placement="center">
	<div class="opening-form">
		<textarea
			class="opening-box"
			rows="3"
			bind:value={direction}
			use:autoResize={{ maxHeight: 220, value: direction, grip: false }}
			onkeydown={handleKeydown}
			aria-label="Direction for the opening scene"
			placeholder="Direction for the scene…"
			data-dialog-initial-focus
		></textarea>
		<div class="opening-actions">
			<Button variant="primary" onclick={submit}>
				<Icon name="sparkles" class="w-3.5 h-3.5" strokeWidth={1.75} />
				{direction.trim() ? 'Generate' : 'Surprise me'}
			</Button>
		</div>
	</div>
</Dialog>

<style>
	.opening-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	/* Kept identical to Steering's compact quick box: these two directions sit one gesture
	   apart even though their surrounding dialogs have different jobs. */
	.opening-box {
		width: 100%;
		padding: 0.45rem 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-primary) 65%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.82rem;
		line-height: 1.45;
	}

	.opening-box:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
	}

	.opening-box::placeholder {
		color: var(--color-text-muted);
	}

	.opening-actions {
		display: flex;
		justify-content: flex-end;
	}
</style>
