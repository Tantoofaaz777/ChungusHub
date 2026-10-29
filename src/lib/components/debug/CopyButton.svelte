<script lang="ts">
	/**
	 * Copy affordance shared by every debug surface. `text` is a getter, not a string: the
	 * payloads here are whole message arrays and tool schemas, and building them on every
	 * render would serialize the entire log while the user is only looking at it.
	 *
	 * A blocked clipboard is SHOWN, never swallowed: an unresponsive button is the worst
	 * outcome for a control whose whole job is getting the payload out of the panel.
	 */
	import Icon from '#lib/components/ui/Icon.svelte';
	import { copyText } from '#lib/utils/clipboard.ts';

	interface Props {
		text: () => string;
		title: string;
		/** Optional text beside the icon; icon-only without it. */
		label?: string;
		/** Icon-only buttons in a message header fade in on hover, like the row's own controls. */
		quiet?: boolean;
	}

	let { text, title, label, quiet = false }: Props = $props();

	let phase = $state<'idle' | 'copied' | 'failed'>('idle');
	let failure = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function copy(): Promise<void> {
		clearTimeout(timer);
		try {
			await copyText(text());
			phase = 'copied';
			failure = '';
			timer = setTimeout(() => (phase = 'idle'), 1200);
		} catch (e) {
			phase = 'failed';
			failure = e instanceof Error ? e.message : String(e);
			timer = setTimeout(() => (phase = 'idle'), 3000);
		}
	}
</script>

<button
	class="copy-btn"
	class:quiet
	class:failed={phase === 'failed'}
	type="button"
	onclick={copy}
	title={phase === 'failed' ? `Copy failed: ${failure}` : title}
	aria-label={title}
>
	<Icon
		name={phase === 'copied' ? 'check' : phase === 'failed' ? 'warning' : 'copy'}
		class="w-3.5 h-3.5 shrink-0"
		strokeWidth={1.75}
	/>
	{#if label}<span class="copy-label">{phase === 'failed' ? 'failed' : label}</span>{/if}
</button>

<style>
	.copy-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.22rem 0.35rem;
		border-radius: var(--radius-sm);
		border: 0;
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 600;
		line-height: 1;
		cursor: pointer;
		transition: background-color 110ms ease, color 110ms ease, opacity 110ms ease;
	}

	.copy-btn:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
		color: var(--color-text-primary);
	}

	.copy-btn.failed {
		color: var(--color-error);
	}

	/* Revealed by the hosting row on hover/focus; always visible on coarse pointers, where
	   there is no hover to reveal it with. */
	.copy-btn.quiet {
		opacity: 0;
	}

	.copy-btn.quiet:focus-visible {
		opacity: 1;
	}

	:global(.msg:hover) .copy-btn.quiet,
	:global(.tool-def:hover) .copy-btn.quiet {
		opacity: 1;
	}

	@media (pointer: coarse) {
		.copy-btn.quiet {
			opacity: 1;
		}
	}

	.copy-label {
		white-space: nowrap;
	}
</style>
