<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { panelActivity } from '#lib/components/ui/panelActivity.ts';
	import Icon from '#lib/components/ui/Icon.svelte';
	import InfoTip from '#lib/components/ui/InfoTip.svelte';
	import ExpandableTextarea from '#lib/components/ui/ExpandableTextarea.svelte';
	import PromptDialog from '#lib/components/ui/PromptDialog.svelte';
	import ConfirmDialog from '#lib/components/ui/ConfirmDialog.svelte';
	import { featurePromptsStore, FEATURE_PROMPT_DEFAULTS } from '#lib/stores/featurePrompts.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import type { EnginePromptField } from '#lib/engines/registry.ts';
	import type { ThreadsPromptPreset } from '#shared/threads/presets.ts';

	let { field }: { field: EnginePromptField } = $props();
	let draftId = $state('');
	let draft = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;
	let naming = $state<{ kind: 'new' | 'rename'; target: ThreadsPromptPreset } | null>(null);
	let removing = $state<ThreadsPromptPreset | null>(null);
	const active = $derived(featurePromptsStore.activeThreadsPrompt);
	const library = $derived(featurePromptsStore.threadsPrompts);
	const modified = $derived(draft !== FEATURE_PROMPT_DEFAULTS.threads);

	function flush() {
		if (timer) clearTimeout(timer);
		timer = null;
		const saved = featurePromptsStore.threadsPrompts.prompts.find(p => p.id === draftId);
		if (saved && saved.content !== draft) featurePromptsStore.updateThreadsPrompt(draftId, draft);
	}
	$effect(() => {
		const id = active.id, content = active.content;
		untrack(() => {
			if (draftId !== id) { flush(); draftId = id; draft = content; }
			else if (!timer) draft = content;
		});
	});
	const panelActive = panelActivity();
	$effect(() => { if (!panelActive()) untrack(() => { if (timer) flush(); }); });
	onDestroy(flush);
	function edit(value: string) {
		draft = value;
		if (timer) clearTimeout(timer);
		timer = setTimeout(flush, 600);
	}
	function choose(id: string) {
		flush();
		try { featurePromptsStore.selectThreadsPrompt(id); }
		catch (error) { toastStore.failed('select the Threads prompt', error); }
	}
	function namePrompt(kind: 'new' | 'rename') {
		flush(); naming = { kind, target: { ...featurePromptsStore.activeThreadsPrompt } };
	}
	function confirmName(name: string) {
		if (!naming) return;
		try {
			if (naming.kind === 'new') featurePromptsStore.createThreadsPrompt(name, naming.target.content);
			else featurePromptsStore.renameThreadsPrompt(naming.target.id, name);
			naming = null;
		} catch (error) { toastStore.failed('save the Threads prompt', error); }
	}
	function confirmDelete() {
		if (!removing) return;
		flush();
		try { featurePromptsStore.deleteThreadsPrompt(removing.id); }
		catch (error) { toastStore.failed('delete the Threads prompt', error); }
		removing = null;
	}
</script>

<div class="threads-prompt-editor">
	<div class="threads-prompt-head">
		<label class="threads-prompt-label" for="engine-prompt-threads">{field.label}</label><InfoTip text={field.hint} />
		{#if modified}<span class="modified" title="Differs from the shipped default">Modified</span>{/if}
		<button class="link-btn reset" disabled={!modified} onclick={() => { draft = FEATURE_PROMPT_DEFAULTS.threads; flush(); }}>Reset</button>
	</div>
	<div class="prompt-presets">
		<select class="input-base" aria-label="Fandom instruction prompt" value={active.id} onchange={(event) => choose(event.currentTarget.value)}>
			{#each library.prompts as prompt (prompt.id)}<option value={prompt.id}>{prompt.name}</option>{/each}
		</select>
		<button class="preset-action" aria-label="New prompt" title="New prompt" onclick={() => namePrompt('new')}><Icon name="plus" class="w-4 h-4" /></button>
		<button class="preset-action" aria-label="Rename prompt" title="Rename prompt" onclick={() => namePrompt('rename')}><Icon name="pencil" class="w-4 h-4" /></button>
		<button class="preset-action" aria-label="Delete prompt" title={library.prompts.length === 1 ? 'Keep at least one prompt' : 'Delete prompt'} disabled={library.prompts.length === 1} onclick={() => { flush(); removing = { ...active }; }}><Icon name="trash" class="w-4 h-4" /></button>
	</div>
	<ExpandableTextarea id="engine-prompt-threads" value={draft} onValueChange={edit} dialogTitle={`Threads · ${field.label}`} expandLabel={`Expand ${field.label} prompt`} spellcheck={false} rows={Math.min(20, Math.max(3, draft.split('\n').length + 1))} class="input-base prompt-input" expandedClass="font-mono text-sm text-text-primary" />
</div>
<PromptDialog open={naming !== null} title={naming?.kind === 'rename' ? 'Rename prompt' : 'New prompt'} label="Prompt name" value={naming?.kind === 'rename' ? naming.target.name : ''} confirmLabel={naming?.kind === 'rename' ? 'Rename' : 'Create'} onConfirm={confirmName} onCancel={() => naming = null} />
<ConfirmDialog open={removing !== null} title="Delete prompt?" message={`Delete “${removing?.name ?? ''}” and its saved instructions? Your saved Threads will be kept.`} confirmLabel="Delete prompt" variant="danger" destructive onConfirm={confirmDelete} onCancel={() => removing = null} />

<style>
	.threads-prompt-editor { display:flex; flex-direction:column; gap:.5rem; min-width:0; }
	.threads-prompt-head { display:flex; align-items:center; gap:.4rem; }
	.threads-prompt-label { font-family:var(--font-ui); font-size:.76rem; font-weight:620; color:var(--color-text-primary); }
	.modified { padding:.02rem .35rem; border-radius:var(--radius-full); border:1px solid var(--color-border); font-family:var(--font-ui); font-size:.6rem; font-weight:620; color:var(--color-text-muted); }
	.reset { margin-left:auto; font-size:.72rem; }
	.reset:disabled { color:var(--color-text-muted); text-decoration:none; cursor:not-allowed; }
	.prompt-presets { display:flex; align-items:center; gap:.35rem; min-width:0; }
	.prompt-presets select { flex:1; min-width:0; padding:.45rem .6rem; font-family:var(--font-ui); font-size:.76rem; }
	.preset-action { display:flex; align-items:center; justify-content:center; width:2rem; height:2rem; flex-shrink:0; border:1px solid var(--color-border-subtle); border-radius:var(--radius-md); color:var(--color-text-secondary); }
	.preset-action:not(:disabled):hover { background:var(--color-bg-tertiary); color:var(--color-text-primary); }
	.preset-action:disabled { opacity:.35; cursor:default; }
</style>
