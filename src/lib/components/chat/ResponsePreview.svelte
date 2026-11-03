<script lang="ts">
	import type { Message } from '#lib/types/chat.ts';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
	import { openChatSetup } from '#lib/stores/openChatSetup.svelte.ts';
	import { regexRulesStore } from '#lib/stores/regex-rules.svelte.ts';
	import { storyRoleName } from '#lib/types/library.ts';
	import { displaySelfRefs } from '#lib/macros.ts';
	import { renderMarkdown } from '#lib/utils/markdown.ts';
	import { renderedHtml } from '#lib/actions/renderedHtml.ts';
	import { imageService } from '#lib/services/imageService.ts';
	import MessageReasoning from './MessageReasoning.svelte';
	import ImageLightbox from '#lib/components/ui/ImageLightbox.svelte';

	let { message, depth = 0 }: { message: Message; depth?: number } = $props();
	const character = $derived(characterLibraryStore.entries.find(entry => entry.id === chatStore.activeChat?.characterId));
	const charName = $derived(character ? storyRoleName(character.identity) || 'Character' : 'Character');
	const userName = $derived(openChatSetup.persona ? storyRoleName(openChatSetup.persona.identity) || 'You' : 'You');
	const preset = $derived(openChatSetup.preset);
	const html = $derived(renderMarkdown(displaySelfRefs(
		regexRulesStore.forDisplay(message.content, message.role, depth, preset), charName, userName, openChatSetup.persona?.identity.pronouns)));
	const images = $derived((message.attachments ?? []).filter(attachment => attachment.kind === 'image').map(attachment => attachment.path));
	let viewerIndex = $state<number | null>(null);
	$effect(() => { void message.selectedVariantId; viewerIndex = null; });
</script>

{#if message.thinking?.trim()}<MessageReasoning thinking={message.thinking} reasoningMs={message.reasoningMs} />{/if}
{#if images.length}
	<div class="preview-images">
		{#each images as path, index (path)}
			<button type="button" onclick={() => viewerIndex = index} aria-label={`Open attachment ${index + 1}`}>
				<img src={imageService.thumbnailUrl(path)} alt="Response attachment" loading="lazy" />
			</button>
		{/each}
	</div>
	<ImageLightbox {images} bind:index={viewerIndex} alt="Response attachment" onClose={() => viewerIndex = null} />
{/if}
<div class="prose-chat response-preview" use:renderedHtml={html}></div>

<style>
	.response-preview { overflow-wrap:anywhere; line-height:1.75; }
	.preview-images { display:flex; flex-wrap:wrap; gap:.6rem; margin-bottom:.8rem; }
	.preview-images button { border:1px solid var(--color-border); border-radius:var(--radius-md); overflow:hidden; cursor:pointer; }
	.preview-images img { width:9rem; max-height:10rem; object-fit:cover; }
</style>
