<script lang="ts">
 import Dialog from '$lib/components/ui/Dialog.svelte';
 import Button from '$lib/components/ui/Button.svelte';
 import Icon from '$lib/components/ui/Icon.svelte';
 import { memoryStore } from '$lib/memory/scene-store.svelte';
 import { uiStore } from '$lib/stores/ui.svelte';
 let draft = $derived(memoryStore.draft);
 function reselect() {
  memoryStore.reselectDraft(); uiStore.closeOverlay();
 }
</script>
<Dialog open={draft !== null} onClose={() => { if (!memoryStore.saving) memoryStore.cancelDraft(); }} title="Chapter" size="xl" titleAlign="left" placement="center" dismissible={!memoryStore.saving}>
 {#if draft}
  <div class="scene-draft">
   <label>Title<input class="input-base px-3 py-2 text-text-primary" bind:value={draft.title} maxlength="200" disabled={memoryStore.saving || draft.phase === 'generating'} /></label>
   <p>{draft.source.length} {draft.source.length === 1 ? 'message' : 'messages'} · Only a saved chapter replaces messages in the prompt.</p>
   {#if draft.phase === 'generating'}<div class="scene-progress" role="status"><Icon name="refresh" class="w-4 h-4 animate-spin" />Generating chapter…</div>{/if}
   <label>Content<textarea class="input-base px-3 py-2 text-text-primary" rows="10" bind:value={draft.content} disabled={memoryStore.saving || draft.phase === 'generating'} placeholder="Review the generated chapter or write your own."></textarea></label>
   {#if draft.error}<p class="scene-error" role="alert">{draft.error}</p>{/if}
   <div class="scene-draft-actions">
    <Button variant="ghost" size="sm" onclick={reselect} disabled={memoryStore.saving || draft.phase === 'generating'}>Reselect range</Button>
    <Button variant="secondary" size="sm" onclick={() => memoryStore.generateDraft()} disabled={memoryStore.saving || draft.phase === 'generating'}><Icon name="refresh" class="w-4 h-4" />{draft.content ? 'Regenerate' : 'Generate'}</Button>
    <Button variant="ghost" size="sm" onclick={() => memoryStore.cancelDraft()} disabled={memoryStore.saving}>Cancel</Button>
    <Button size="sm" onclick={() => memoryStore.saveDraft()} disabled={memoryStore.saving || draft.phase === 'generating' || !draft.content.trim() || !draft.title.trim()}>{memoryStore.saving ? 'Saving…' : 'Save chapter'}</Button>
   </div>
  </div>
 {/if}
</Dialog>
<style>
 .scene-draft { font-family:var(--font-ui); display:flex; flex-direction:column; gap:.8rem; }
 label { display:flex; flex-direction:column; gap:.4rem; font-size:.85rem; font-weight:600; }
 input,textarea { width:100%; font-weight:400; line-height:1.5; outline:none; }
 textarea { resize:vertical; min-height:10rem; max-height:45dvh; font-size:1rem; }
 p { color:var(--color-text-muted); font-size:.75rem; }
 .scene-error { color:var(--color-error); }
 .scene-progress { display:flex; align-items:center; gap:.5rem; font-size:.85rem; color:var(--color-accent); }
 .scene-draft-actions { display:flex; justify-content:flex-end; gap:.4rem; flex-wrap:wrap; }
</style>
