<script lang="ts">
	import { fly } from 'svelte/transition';
	import { toastStore, type ToastTone } from '$lib/stores/toast.svelte';
	import Icon from './Icon.svelte';

	let toasts = $derived(toastStore.toasts);

	// Per-tone tint layered over the float recipe (inline so it wins over .surface-float).
	const toneTints: Record<ToastTone, string> = {
		info: '',
		success:
			'background: color-mix(in srgb, var(--color-success) 10%, var(--color-float-bg)); border-color: color-mix(in srgb, var(--color-success) 30%, var(--glass-border));',
		error:
			'background: color-mix(in srgb, var(--color-error) 10%, var(--color-float-bg)); border-color: color-mix(in srgb, var(--color-error) 30%, var(--glass-border));',
		warning:
			'background: color-mix(in srgb, var(--color-warning) 10%, var(--color-float-bg)); border-color: color-mix(in srgb, var(--color-warning) 30%, var(--glass-border));'
	};

	const toneIcons: Record<ToastTone, 'info' | 'checkCircle' | 'warning'> = {
		info: 'info',
		success: 'checkCircle',
		error: 'warning',
		warning: 'warning'
	};

	// The glyph carries the tone, not just the tint behind it: error and warning share a shape,
	// so with a muted icon the two read as the same message in a palette that mutes the tint.
	const toneColors: Record<ToastTone, string> = {
		info: 'var(--color-text-muted)',
		success: 'var(--color-success)',
		error: 'var(--color-error)',
		warning: 'var(--color-warning)'
	};
</script>

<div class="toast-wrap fixed bottom-4 right-4 flex flex-col gap-2 pointer-events-none">
	{#each toasts as toast (toast.id)}
		<div
			class="surface-float pointer-events-auto max-w-sm px-4 py-3 rounded-[var(--radius-lg)] shadow-md
			       font-ui text-sm text-text-primary flex items-center gap-3"
			style={toneTints[toast.tone]}
			transition:fly={{ x: 100, duration: 200 }}
		>
			<Icon
				name={toneIcons[toast.tone]}
				class="w-5 h-5 flex-shrink-0"
				style="color: {toneColors[toast.tone]}"
			/>
			<span class="flex-1">{toast.message}</span>

			{#if toast.count > 1}
				<span class="toast-count">{toast.count}</span>
			{/if}

			<button
				type="button"
				class="p-1 text-text-muted hover:text-text-primary rounded transition-colors"
				onclick={() => toastStore.remove(toast.id)}
				aria-label="Dismiss"
			>
				<Icon name="close" class="w-4 h-4" />
			</button>
		</div>
	{/each}
</div>

<style>
	.toast-wrap {
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		/* Above every out-of-flow surface in the app: dialogs and the lightbox portal to z 300,
		   and tooltips reach 1000. A
		   message drawn behind the surface that raised it is a message nobody receives, which is
		   why half a dozen panels grew inline error lines of their own. `.app-shell` opens no
		   stacking context, so this value competes at the root and needs no portal of its own. */
		z-index: 1100;
	}

	/* How many times an identical line repeated while it was on screen. */
	.toast-count {
		flex-shrink: 0;
		min-width: 1.25rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-text-primary) 12%, transparent);
		color: var(--color-text-secondary);
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1.25rem;
		text-align: center;
	}

	/* Phones: the bottom edge is owned by the composer (send button), so the stack moves
	   under the title bar instead. */
	@media (max-width: 680px) {
		.toast-wrap {
			left: 0.65rem;
			right: 0.65rem;
			bottom: auto;
			top: calc(3rem + env(safe-area-inset-top, 0px));
		}
	}
</style>
