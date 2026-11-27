<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { panelActivity } from '#lib/components/ui/panelActivity.ts';
	import Icon from '#lib/components/ui/Icon.svelte';
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
	import RetainedView from '#lib/components/ui/RetainedView.svelte';
	import MemoryCompactionDialog from './MemoryCompactionDialog.svelte';
	import MemoryChapter from './MemoryChapter.svelte';
	import { memoryStore } from '#lib/memory/scene-store.svelte.ts';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { chatCursor } from '#lib/stores/chatCursor.svelte.ts';
	import { chatSearch } from '#lib/stores/chatSearch.svelte.ts';
	import { uiStore } from '#lib/stores/ui.svelte.ts';
	import { viewport } from '#lib/stores/viewport.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import { resolvePromptTarget } from '#lib/utils/chat-setup.ts';
	import { MEMORY_LEVELS, matchesSceneSourceTurn, sceneLevel, memoryLabel, type MemoryScene, type MemoryLevel, type SceneSource } from '../../../../shared/memory-scenes';
	const panelActive = panelActivity();
	const BATCH_SIZE = 50;
	const levelOptions = MEMORY_LEVELS.map(value => ({ value, label: `${memoryLabel(value)}s` }));
	let activeLevel = $state<MemoryLevel>('chapter');
	let limits = $state<Record<MemoryLevel, number>>({ chapter: BATCH_SIZE, arc: BATCH_SIZE, volume: BATCH_SIZE });
	const sections = $derived(MEMORY_LEVELS.map(level => ({ level, items: memoryStore.resolved.filter(r => sceneLevel(r.scene) === level) })));
	const activeMessages = $derived(new Map(chatStore.currentChatState?.activePath.map(message => [message.id, message])));
	function loadMore(level: MemoryLevel) {
		if (activeLevel !== level || !panelActive() || !memoryStore.loaded || memoryStore.saving || memoryStore.activeChatId !== chatStore.activeChatId) return;
		const total = sections.find(section => section.level === level)?.items.length ?? 0;
		limits[level] = Math.min(total, limits[level] + BATCH_SIZE);
	}
	function observeMore(node: HTMLDivElement, level: MemoryLevel) {
		$effect(() => {
			if (activeLevel !== level || !panelActive() || !memoryStore.loaded || memoryStore.saving || typeof IntersectionObserver === 'undefined') return;
			const root = node.closest('.memory-body');
			if (!root) return;
			let current = true;
			const observer = new IntersectionObserver(entries => {
				if (current && entries.some(entry => entry.isIntersecting)) untrack(() => loadMore(level));
			}, { root, rootMargin: '200px 0px' });
			observer.observe(node);
			return () => { current = false; observer.disconnect(); };
		});
	}
	let removing = $state<MemoryScene | null>(null);
	$effect(() => { if (removing && removing.chatId !== chatStore.activeChatId) removing = null; });
	let model = $derived(resolvePromptTarget(chatStore.activeChat).model);
	function settings() {
		uiStore.gotoSettingsPage('engines');
		uiStore.settingsEngineId = 'memory';
		uiStore.openSettings();
	}
	function canGoToSource(source: SceneSource) {
		const turn = activeMessages.get(source.id);
		return !!turn && matchesSceneSourceTurn(source, turn);
	}
	async function goToSource(chatId: string, source: SceneSource) {
		if (chatStore.activeChatId !== chatId || !canGoToSource(source)) return;
		if (!viewport.desktopLayout) {
			uiStore.closeOverlay();
			if (uiStore.activeOverlay) return;
		}
		chatSearch.close();
		await tick();
		if (chatStore.activeChatId === chatId && canGoToSource(source)) chatCursor.goTo(source.id, 'start');
	}
	async function retryLoad() {
		const id = chatStore.activeChatId;
		if (!id || memoryStore.activeChatId !== id) return;
		try {
			// A failed first load may have prevented the chat's path from reaching memory.
			// Restore that context before publishing loaded coverage and enabling swipes.
			if (!memoryStore.loaded) await chatStore.refreshCurrentChat();
			if (chatStore.activeChatId === id && memoryStore.activeChatId === id) await memoryStore.loadForChat(id);
		} catch (error) { toastStore.failed('reload the memory', error); }
	}
	async function remove() {
		const chapter = removing; removing = null;
		if (!chapter || chatStore.activeChatId !== chapter.chatId) return;
		try { await memoryStore.removeScene(chapter); } catch (error) { toastStore.failed('remove the memory', error); }
	}
</script>
<div class="memory-panel">
	<header class="overlay-header overlay-header--stacked">
		<div class="heading"><h2 class="overlay-title">Memory</h2><button type="button" class="icon-btn" title="Chat memory settings" aria-label="Chat memory settings" onclick={settings}><Icon name="settings" class="w-4 h-4" /></button></div>
		<div class="overlay-crumb"><span class="overlay-subject">{chatStore.activeChat?.title ?? 'No chat open'}</span></div>
	</header>
	{#if chatStore.activeChat}
		<div class="memory-tabs">
			<SegmentedControl label="Memory view" bind:current={activeLevel} options={levelOptions} />
		</div>
	{/if}
	<div class="memory-content">
		{#if chatStore.activeChat}
			{#if memoryStore.activeChatId === chatStore.activeChatId && memoryStore.loadError}
				<div class="memory-error" role="alert">Could not {memoryStore.loaded ? 'refresh' : 'load'} memory. {memoryStore.loadError}<Button variant="secondary" size="sm" onclick={retryLoad}>{memoryStore.loaded ? 'Retry updating' : 'Retry loading'}</Button></div>
			{/if}
			{#if memoryStore.activeChatId !== chatStore.activeChatId || (!memoryStore.loaded && !memoryStore.loadError)}<p class="memory-loading">Loading memory…</p>
			{/if}
			{#if memoryStore.loaded && memoryStore.activeChatId === chatStore.activeChatId}
				{#each sections as { level, items } (level)}
					<RetainedView active={activeLevel === level}>
						<section class="memory-body panel-scroll" aria-label={`${memoryLabel(level)}s`}>
							{#if level !== 'chapter'}
								<div class="memory-actions">
									<Button variant="secondary" size="sm" onclick={() => memoryStore.openCompaction(level)} disabled={memoryStore.saving}>Create {level}</Button>
								</div>
							{/if}
							{#if !items.length}
								<EmptyState icon="brain" size="sm" title={`No ${level}s yet`}>{level === 'chapter' ? 'Use ↓ and ↑ in message actions to select a chapter.' : `Combine consecutive ${level === 'arc' ? 'chapters' : 'arcs'} here.`}</EmptyState>
							{:else}
								{#each items.slice(0, limits[level]) as item (item.scene.id)}
									{@const lastSource = item.scene.source.at(-1)}
									<MemoryChapter {item} {model} busy={memoryStore.saving}
										onGoTo={lastSource && canGoToSource(lastSource) ? () => goToSource(item.scene.chatId, lastSource) : undefined}
										onEdit={(chapter) => memoryStore.editScene(chapter)} onRemove={(chapter) => removing = chapter} />
								{/each}
								{#if items.length > limits[level]}
									<div class="memory-more" use:observeMore={level}>
										<Button variant="ghost" size="sm" disabled={memoryStore.saving} onclick={() => loadMore(level)}>Load more {level}s</Button>
										<span>{limits[level].toLocaleString()} / {items.length.toLocaleString()}</span>
									</div>
								{/if}
							{/if}
						</section>
					</RetainedView>
				{/each}
			{/if}
		{:else}
			<EmptyState icon="brain" size="sm">Open a chat to manage its memory.</EmptyState>
		{/if}
	</div>
</div>
{#if memoryStore.activeChatId === chatStore.activeChatId}<MemoryCompactionDialog />{/if}
<ConfirmDialog open={removing !== null} title={`Remove ${removing ? sceneLevel(removing) : 'memory'}?`} message="The summary will be removed. Its source memories or messages will return to the prompt. Any higher summaries that depend on it will need review." confirmLabel="Remove memory" variant="danger" destructive onConfirm={remove} onCancel={() => removing = null} />
<style>
	.memory-panel { font-family:var(--font-ui); display:flex; flex-direction:column; height:100%; min-height:0; }
	.heading { display:grid; grid-template-columns:2rem minmax(0,1fr) 2rem; align-items:center; width:100%; }
	.heading h2 { grid-column:2; text-align:center; }
	.heading > button { grid-column:3; justify-self:end; }
	.icon-btn { display:inline-flex; align-items:center; justify-content:center; width:2rem; height:2rem; border-radius:var(--radius-md); color:var(--color-text-secondary); flex-shrink:0; }
	.icon-btn:hover { background:var(--color-bg-tertiary); color:var(--color-text-primary); }
	.memory-tabs { display:flex; justify-content:center; padding:1rem 1rem 0; }
	.memory-content { flex:1; min-height:0; display:flex; flex-direction:column; }
	.memory-content > :global(.retained-view) { flex:1; }
	.memory-body { height:100%; padding:1rem; }
	.memory-actions { display:flex; justify-content:flex-end; margin-bottom:.8rem; }
	.memory-loading { padding:1rem; color:var(--color-text-muted); font-size:.8rem; }
	.memory-error { display:flex; align-items:center; flex-wrap:wrap; gap:.5rem; padding:1rem 1rem 0; color:var(--color-error); font-size:.8rem; }
	.memory-more { display:flex; align-items:center; justify-content:center; gap:.5rem; padding:.3rem 0 .8rem; color:var(--color-text-muted); font-size:.75rem; overflow-anchor:none; }
</style>
