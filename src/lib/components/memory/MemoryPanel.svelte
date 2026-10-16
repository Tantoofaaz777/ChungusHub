<script lang="ts">
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import MemoryChapter from './MemoryChapter.svelte';
	import { memoryStore } from '$lib/memory/scene-store.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { resolvePromptTarget } from '$lib/utils/chat-setup';
	import type { MemoryScene } from '../../../../shared/memory-scenes';
	let removing = $state<MemoryScene | null>(null);
	let model = $derived(resolvePromptTarget(chatStore.activeChat).model);
	async function remove() {
		const chapter = removing; removing = null;
		if (!chapter) return;
		try { await memoryStore.removeScene(chapter); } catch (error) { toastStore.failed('remove the chapter', error); }
	}
</script>
<div class="memory-panel">
	<header class="overlay-header overlay-header--stacked">
		<h2 class="overlay-title">Memory</h2>
		<div class="overlay-crumb"><span class="overlay-subject">{chatStore.activeChat?.title ?? 'No chat open'}</span></div>
	</header>
	<div class="memory-body panel-scroll">
		{#if !chatStore.activeChat}
			<EmptyState icon="brain" size="sm">Open a chat to manage its memory.</EmptyState>
		{:else}
			<section aria-labelledby="memory-chapters-heading">
				<h3 id="memory-chapters-heading" class="memory-section-heading">Chapters</h3>
				{#if !memoryStore.loaded}<p class="memory-loading">Loading chapters…</p>
				{:else if !memoryStore.scenes.length}
					<EmptyState icon="brain" size="sm" title="No chapters yet">Use ↓ and ↑ in message actions to select a chapter.</EmptyState>
				{:else}
					{#each memoryStore.resolved as item (item.scene.id)}
						<MemoryChapter {item} {model} onEdit={(chapter) => memoryStore.editScene(chapter)} onRemove={(chapter) => removing = chapter} />
					{/each}
				{/if}
			</section>
		{/if}
	</div>
</div>
<ConfirmDialog open={removing !== null} title="Remove chapter?" message="The chapter will be removed. Its original messages will return to the prompt." confirmLabel="Remove chapter" variant="danger" destructive onConfirm={remove} onCancel={() => removing = null} />
<style>
	.memory-panel { font-family:var(--font-ui); display:flex; flex-direction:column; height:100%; min-height:0; }
	.memory-body { flex:1; min-height:0; padding:1rem; }
	.memory-section-heading { font-size:.8rem; font-weight:600; color:var(--color-text-secondary); margin-bottom:.8rem; }
	.memory-loading { color:var(--color-text-muted); font-size:.8rem; }
</style>
