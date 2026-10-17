<script lang="ts">
	import { untrack } from 'svelte';
	import { panelActivity } from '$lib/components/ui/panelActivity';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import MemoryCompactionDialog from './MemoryCompactionDialog.svelte';
	import MemoryChapter from './MemoryChapter.svelte';
	import { memoryStore } from '$lib/memory/scene-store.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { resolvePromptTarget } from '$lib/utils/chat-setup';
	import { MEMORY_LEVELS, sceneLevel, memoryLabel, type MemoryScene, type MemoryLevel } from '../../../../shared/memory-scenes';
	const panelActive = panelActivity();
	const BATCH_SIZE = 50;
	let body = $state<HTMLDivElement | null>(null);
	let limits = $state<Record<MemoryLevel, number>>({ chapter: BATCH_SIZE, arc: BATCH_SIZE, volume: BATCH_SIZE });
	const sections = $derived(MEMORY_LEVELS.map(level => ({ level, items: memoryStore.resolved.filter(r => sceneLevel(r.scene) === level) })));
	function loadMore(level: MemoryLevel) {
		if (!panelActive() || !memoryStore.loaded || memoryStore.saving || memoryStore.activeChatId !== chatStore.activeChatId) return;
		const total = sections.find(section => section.level === level)?.items.length ?? 0;
		limits[level] = Math.min(total, limits[level] + BATCH_SIZE);
	}
	function observeMore(node: HTMLDivElement, level: MemoryLevel) {
		$effect(() => {
			if (!panelActive() || !memoryStore.loaded || memoryStore.saving || !body || typeof IntersectionObserver === 'undefined') return;
			let current = true;
			const observer = new IntersectionObserver(entries => {
				if (current && entries.some(entry => entry.isIntersecting)) untrack(() => loadMore(level));
			}, { root: body, rootMargin: '200px 0px' });
			observer.observe(node);
			return () => { current = false; observer.disconnect(); };
		});
	}
	let removing = $state<MemoryScene | null>(null);
	let model = $derived(resolvePromptTarget(chatStore.activeChat).model);
	async function remove() {
		const chapter = removing; removing = null;
		if (!chapter) return;
		try { await memoryStore.removeScene(chapter); } catch (error) { toastStore.failed('remove the memory', error); }
	}
</script>
<div class="memory-panel">
	<header class="overlay-header overlay-header--stacked">
		<h2 class="overlay-title">Memory</h2>
		<div class="overlay-crumb"><span class="overlay-subject">{chatStore.activeChat?.title ?? 'No chat open'}</span></div>
	</header>
	<div class="memory-body panel-scroll" bind:this={body}>
		{#if !chatStore.activeChat}
			<EmptyState icon="brain" size="sm">Open a chat to manage its memory.</EmptyState>
		{:else}
			{#if !memoryStore.loaded || memoryStore.activeChatId !== chatStore.activeChatId}<p class="memory-loading">Loading memory…</p>
			{:else}
				{#each sections as { level, items } (level)}
					<section aria-labelledby={`memory-${level}-heading`}>
						<div class="memory-section-header">
							<h3 id={`memory-${level}-heading`} class="memory-section-heading">{memoryLabel(level)}s</h3>
							{#if level !== 'chapter'}<Button variant="secondary" size="sm" onclick={() => memoryStore.openCompaction(level)} disabled={memoryStore.saving}>Create {level}</Button>{/if}
						</div>
						{#if !items.length}
							<EmptyState icon="brain" size="sm" title={`No ${level}s yet`}>{level === 'chapter' ? 'Use ↓ and ↑ in message actions to select a chapter.' : `Combine consecutive ${level === 'arc' ? 'chapters' : 'arcs'} here.`}</EmptyState>
						{:else}
							{#each items.slice(0, limits[level]) as item (item.scene.id)}
								<MemoryChapter {item} {model} onEdit={(chapter) => memoryStore.editScene(chapter)} onRemove={(chapter) => removing = chapter} />
							{/each}
							{#if items.length > limits[level]}
								<div class="memory-more" use:observeMore={level}>
									<Button variant="ghost" size="sm" disabled={memoryStore.saving} onclick={() => loadMore(level)}>Load more {memoryLabel(level).toLowerCase()}s</Button>
									<span>{limits[level].toLocaleString()} / {items.length.toLocaleString()}</span>
								</div>
							{/if}
						{/if}
					</section>
				{/each}
			{/if}
		{/if}
	</div>
</div>
{#if memoryStore.activeChatId === chatStore.activeChatId}<MemoryCompactionDialog />{/if}
<ConfirmDialog open={removing !== null} title={`Remove ${removing ? sceneLevel(removing) : 'memory'}?`} message="The summary will be removed. Its source memories or messages will return to the prompt. Any higher summaries that depend on it will need review." confirmLabel="Remove memory" variant="danger" destructive onConfirm={remove} onCancel={() => removing = null} />
<style>
	.memory-panel { font-family:var(--font-ui); display:flex; flex-direction:column; height:100%; min-height:0; }
	.memory-body { flex:1; min-height:0; padding:1rem; }
	section + section { margin-top:1.5rem; }
	.memory-section-header { display:flex; align-items:center; justify-content:space-between; gap:.7rem; margin-bottom:.8rem; }
	.memory-section-heading { font-size:.8rem; font-weight:600; color:var(--color-text-secondary); }
	.memory-loading { color:var(--color-text-muted); font-size:.8rem; }
	.memory-more { display:flex; align-items:center; justify-content:center; gap:.5rem; padding:.3rem 0 .8rem; color:var(--color-text-muted); font-size:.75rem; overflow-anchor:none; }
</style>
