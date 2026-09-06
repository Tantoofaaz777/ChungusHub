<script lang="ts">
	/**
	 * One message of a logged request, rendered whole: role, position, every image attachment
	 * it carried, and its text. Nothing here is shortened: the panel exists to show what was
	 * actually sent, and a preview would answer a different question than the one asked.
	 *
	 * Folding is CONTROLLED by the panel so its fold-all control and this chevron can never
	 * disagree about whether a card is open.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import CopyButton from './CopyButton.svelte';
	import { imageService } from '$lib/services/imageService';
	import { messageTokens, roleColor } from '$lib/debug/format';
	import type { PromptLogMessage } from '$lib/debug/types';

	interface Props {
		message: PromptLogMessage;
		/** Position in the prompt transcript; absent for the synthesized response cards. */
		index?: number;
		model?: string;
		collapsed: boolean;
		onToggle: () => void;
		/** Opens the panel's single full-size viewer on an attachment. */
		onViewImage: (path: string) => void;
	}

	let { message, index, model, collapsed, onToggle, onViewImage }: Props = $props();

	let color = $derived(roleColor(message.role));
	let content = $derived(message.content ?? '');
	let tokens = $derived(messageTokens(message, model));
	let lineCount = $derived(content ? content.split('\n').length : 0);
	let images = $derived(message.images ?? []);

	/** Thumbnails are derived paths, so one that fails to load means the PREVIEW is gone,
	 *  not that the image never rode the request: the path in this logged message is the
	 *  proof it did. Say exactly that instead of leaving a broken tile. */
	let previewFailed = $state<string[]>([]);

	function fileName(path: string): string {
		return path.slice(path.lastIndexOf('/') + 1);
	}
</script>

<div class="msg" style={`--role-color: ${color}`}>
	<div class="head">
		<button class="toggle" type="button" onclick={onToggle} aria-expanded={!collapsed}>
			<Icon name={collapsed ? 'chevronRight' : 'chevronDown'} class="w-3 h-3 shrink-0" strokeWidth={2.25} />
			<span class="role">{message.role}</span>
			{#if index !== undefined}<span class="num">#{index + 1}</span>{/if}
			{#if images.length}
				<span class="img-chip" title={`${images.length} image attachment(s) sent with this message`}>
					<Icon name="image" class="w-3 h-3 shrink-0" strokeWidth={1.75} />
					{images.length}
				</span>
			{/if}
			<span class="meta">{lineCount.toLocaleString()} ln · ~{tokens.toLocaleString()} tok</span>
		</button>
		<CopyButton quiet text={() => content} title="Copy this message's text" />
	</div>

	{#if !collapsed}
		{#if images.length}
			<div class="images">
				{#each images as path (path)}
					<button class="shot" type="button" onclick={() => onViewImage(path)} title={`${path} (click to view full size)`}>
						{#if previewFailed.includes(path)}
							<span class="shot-fallback"><Icon name="image" class="w-4 h-4" strokeWidth={1.5} /></span>
						{:else}
							<img
								src={imageService.thumbnailUrl(path)}
								alt=""
								loading="lazy"
								onerror={() => (previewFailed = [...previewFailed, path])}
							/>
						{/if}
						<span class="shot-name">{fileName(path)}</span>
						{#if previewFailed.includes(path)}<span class="shot-note">preview unavailable</span>{/if}
					</button>
				{/each}
			</div>
		{/if}

		{#if content}
			<pre class="body">{content}</pre>
		{:else}
			<p class="empty">(no text content)</p>
		{/if}
	{/if}
</div>

<style>
	.msg {
		border-left: 2px solid var(--role-color);
		border-bottom: 1px solid var(--color-border-subtle);
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-right: 0.35rem;
	}

	.toggle {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.32rem 0.5rem;
		border: 0;
		background: transparent;
		cursor: pointer;
		text-align: left;
		color: var(--color-text-muted);
		transition: background-color 110ms ease;
	}

	.toggle:hover {
		background: color-mix(in srgb, var(--role-color) 8%, transparent);
	}

	.role {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.66rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--role-color);
	}

	.num {
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.64rem;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.img-chip {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.64rem;
		color: var(--role-color);
	}

	.meta {
		margin-left: auto;
		flex-shrink: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.64rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.images {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0.15rem 0.6rem 0.5rem 0.95rem;
	}

	.shot {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		width: 7rem;
		padding: 0.3rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-tertiary) 35%, transparent);
		cursor: pointer;
		text-align: left;
	}

	.shot:hover {
		border-color: var(--color-accent);
	}

	.shot img,
	.shot-fallback {
		width: 100%;
		height: 4.5rem;
		border-radius: calc(var(--radius-sm) - 0.2rem);
		object-fit: cover;
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
	}

	.shot-fallback {
		display: grid;
		place-items: center;
		color: var(--color-text-muted);
	}

	.shot-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono, monospace);
		font-size: 0.6rem;
		color: var(--color-text-secondary);
	}

	.shot-note {
		font-family: var(--font-ui);
		font-size: 0.58rem;
		color: var(--color-warning);
	}

	.body {
		margin: 0;
		padding: 0.1rem 0.6rem 0.55rem 0.95rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-family: var(--font-mono, monospace);
		font-size: 0.76rem;
		line-height: 1.55;
		color: var(--color-text-secondary);
	}

	.empty {
		margin: 0;
		padding: 0.1rem 0.6rem 0.55rem 0.95rem;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		font-style: italic;
		color: var(--color-text-muted);
	}

</style>
