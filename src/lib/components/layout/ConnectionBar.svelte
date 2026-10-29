<script lang="ts">
	/**
	 * The standing channel of the notification contract (architecture/ui-shell-settings.md).
	 *
	 * One condition, and it is the one the app could never say: the server is unreachable. A
	 * dropped connection breaks generations, stops other devices' changes from arriving and
	 * fails every write, and until this bar existed all of that happened behind an interface
	 * that looked perfectly healthy.
	 *
	 * It is a full-width row in normal flow rather than a corner badge, which is what makes it
	 * work identically on a phone and a desktop: it takes no corner to fight over, it costs
	 * zero pixels while the connection is fine, and it cannot be covered by a panel the way a
	 * floating mark can. The layout shift when it appears is the message, not a side effect.
	 *
	 * Individual write failures stay toasts and are NOT folded in here. The two say different
	 * things: this one says the server is gone, a toast names the one value that did not land,
	 * and only the toast tells the reader what to do again once the connection is back.
	 */
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { isReachable, onReachabilityChange } from '#lib/services/transport.ts';

	let reachable = $state(true);

	onMount(() => {
		// Seeded from the transport rather than assumed: a reload during an outage mounts
		// this after the state was already decided, and no handler would fire to correct it.
		reachable = isReachable();
		return onReachabilityChange((next) => (reachable = next));
	});
</script>

{#if !reachable}
	<div class="conn-bar font-ui" role="status" transition:slide={{ duration: 180 }}>
		<Icon name="cloud" class="w-4 h-4 shrink-0" strokeWidth={1.75} />
		<span class="conn-message">No connection to the server. Nothing you write now is being saved.</span>
		<span class="conn-retry">Reconnecting…</span>
	</div>
{/if}

<style>
	.conn-bar {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.4rem 0.75rem;
		background: color-mix(in srgb, var(--color-error) 16%, var(--color-bg-secondary));
		border-bottom: 1px solid color-mix(in srgb, var(--color-error) 40%, transparent);
		color: var(--color-error);
		font-size: 0.76rem;
		font-weight: 600;
		line-height: 1.3;
		text-align: center;
	}

	.conn-retry {
		flex-shrink: 0;
		color: color-mix(in srgb, var(--color-error) 70%, var(--color-text-muted));
		font-weight: 500;
	}

	/* Narrow screens keep the sentence that matters and drop the reassurance beside it. */
	@media (max-width: 560px) {
		.conn-retry {
			display: none;
		}
	}
</style>
