<script lang="ts">
	import type { Snippet } from 'svelte';
	import MessageAvatar from './MessageAvatar.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import type { PortraitFocus } from '$lib/utils/portrait-focus';

	interface Props {
		role: 'user' | 'assistant' | 'system';
		name: string;
		imagePath: string | null;
		focus?: PortraitFocus;
		children: Snippet;
	}

	let { role, name, imagePath, focus, children }: Props = $props();
	const withPortrait = $derived(
		themeStore.appearance.chatStyle === 'manuscript' && themeStore.appearance.showAvatars
	);
</script>

{#if withPortrait}
	<div class="manuscript-header">
		<MessageAvatar {role} {name} {imagePath} {focus} />
		{@render children()}
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.manuscript-header {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: var(--msg-pad-top, 0.72rem) var(--msg-pad-x, 0.98rem) 0.35rem;
		min-width: 0;
	}
	@media (max-width: 900px) {
		.manuscript-header {
			padding-inline: min(0.86rem, var(--msg-pad-x, 0.98rem));
		}
	}
</style>
