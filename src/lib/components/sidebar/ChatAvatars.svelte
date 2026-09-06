<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { imageService } from '$lib/services/imageService';
	import type { ChatCastMember } from '$lib/stores/chatCast.svelte';
	import { portraitFocusStyle } from '$lib/utils/portrait-focus';

	interface Props {
		members: ChatCastMember[];
		/** Avatar diameter in px. */
		size?: number;
		/** How many avatars to show before collapsing the rest into a "+N" chip. */
		max?: number;
	}

	let { members, size = 28, max = 3 }: Props = $props();

	let shown = $derived(members.slice(0, max));
	let overflow = $derived(Math.max(0, members.length - max));

</script>

<div class="chat-avatars" style="--avatar-size: {size}px;">
	{#each shown as member (member.libraryEntryId)}
		{@const url = imageService.thumbnailUrl(member.imageUrl ?? undefined)}
		<div
			class="chat-avatar"
			title={member.name || 'Unnamed'}
			role="img"
			aria-label={member.name || 'Unnamed'}
		>
			{#if url}
				<img
					src={url}
					alt={member.name}
					style={portraitFocusStyle(member.portraitFocus)}
				/>
			{:else}
				<div class="chat-avatar-fallback">
					<Icon name="user" class="w-1/2 h-1/2" />
				</div>
			{/if}
		</div>
	{/each}
	{#if overflow > 0}
		<div class="chat-avatar chat-avatar-more" title="{overflow} more">+{overflow}</div>
	{/if}
</div>

<style>
	.chat-avatars {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}

	.chat-avatar {
		width: var(--avatar-size);
		height: var(--avatar-size);
		border-radius: var(--radius-full);
		overflow: hidden;
		flex-shrink: 0;
		border: 1.5px solid var(--color-bg-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 88%, transparent);
	}

	/* Overlap the stack; first avatar keeps its full left edge. */
	.chat-avatar:not(:first-child) {
		margin-left: calc(var(--avatar-size) / -3.2);
	}

	.chat-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.chat-avatar-fallback {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
	}

	.chat-avatar-more {
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-ui);
		font-size: calc(var(--avatar-size) * 0.36);
		font-weight: 700;
		color: var(--color-text-secondary);
		background: var(--color-bg-tertiary);
	}
</style>
