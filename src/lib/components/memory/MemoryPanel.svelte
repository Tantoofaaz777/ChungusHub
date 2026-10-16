<script lang="ts">
 import Icon from '$lib/components/ui/Icon.svelte';
 import Button from '$lib/components/ui/Button.svelte';
 import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
 import EmptyState from '$lib/components/ui/EmptyState.svelte';
 import { memoryStore } from '$lib/memory/scene-store.svelte';
 import { chatStore } from '$lib/stores/chat.svelte';
 import { messageStore } from '$lib/stores/messages.svelte';
 import { uiStore } from '$lib/stores/ui.svelte';
 import { toastStore } from '$lib/stores/toast.svelte';
 import type { MemoryScene } from '../../../../shared/memory-scenes';
 let removing = $state<MemoryScene | null>(null);
 function selectScene() { memoryStore.startSelection(); uiStore.closeOverlay(); }
 async function remove() {
  const scene = removing; removing = null;
  if (!scene) return;
  try { await memoryStore.removeScene(scene); } catch (error) { toastStore.failed('remove the summary', error); }
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
   <div class="memory-tools"><Button onclick={selectScene} disabled={!memoryStore.loaded || messageStore.isStreaming || !memoryStore.path.length}><Icon name="plus" class="w-4 h-4" />New summary</Button></div>
   <p class="memory-help">Select the first and last messages of a scene. Review and save its summary to use it in the prompt instead of those messages.</p>
   {#if !memoryStore.loaded}<p>Loading summaries…</p>
   {:else if !memoryStore.scenes.length}<EmptyState icon="brain" size="sm">No scene summaries yet.</EmptyState>
   {:else}
    {#each memoryStore.resolved as item (item.scene.id)}
     <article class="scene-card">
      <div class="scene-heading"><h3>{item.scene.title}</h3><span class:needs-review={item.status === 'review'}>{item.status === 'active' ? 'In prompt' : item.status === 'review' ? 'Needs review' : 'Other branch'}</span></div>
      {#if item.reason}<p class="scene-reason">{item.reason}</p>{/if}
      <p class="scene-text">{item.scene.content}</p>
      <div class="scene-actions"><span>{item.scene.source.length} messages</span>
       <Button variant="ghost" size="sm" onclick={() => memoryStore.editScene(item.scene)}>Review / edit</Button>
       <Button variant="ghost" size="sm" onclick={() => removing = item.scene} aria-label={`Remove summary: ${item.scene.title}`}><Icon name="trash" class="w-4 h-4" /></Button>
      </div>
     </article>
    {/each}
   {/if}
  {/if}
 </div>
</div>
<ConfirmDialog open={removing !== null} title="Remove summary?" message="The summary will be removed. Its original messages will return to the prompt." confirmLabel="Remove summary" variant="danger" destructive onConfirm={remove} onCancel={() => removing = null} />
<style>
 .memory-panel { font-family:var(--font-ui); display:flex; flex-direction:column; height:100%; min-height:0; }
 .memory-body { flex:1; min-height:0; padding:1rem; }
 .memory-tools { display:flex; justify-content:flex-start; }
 .memory-help,.scene-reason { color:var(--color-text-muted); font-size:.8rem; margin:.75rem 0 1rem; }
 .scene-card { border:1px solid var(--color-border); border-radius:var(--radius-lg); padding:.9rem; margin-bottom:.8rem; background:var(--color-bg-secondary); }
 .scene-heading { display:flex; align-items:center; justify-content:space-between; gap:.75rem; flex-wrap:wrap; }
 h3 { font-size:.95rem; font-weight:600; overflow-wrap:anywhere; }
 .scene-heading span { font-size:.7rem; color:var(--color-accent); }
 .scene-heading .needs-review { color:var(--color-warning); }
 .scene-text { white-space:pre-wrap; overflow-wrap:anywhere; font-size:.85rem; line-height:1.6; margin:.8rem 0; }
 .scene-actions { display:flex; align-items:center; justify-content:flex-end; gap:.3rem; flex-wrap:wrap; }
 .scene-actions>span { margin-right:auto; font-size:.72rem; color:var(--color-text-muted); }
</style>
