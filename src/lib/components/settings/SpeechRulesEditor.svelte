<script lang="ts">
 import { onMount } from 'svelte';
 import { dragHandleZone, dragHandle, type DndEvent } from 'svelte-dnd-action';
 import Button from '$lib/components/ui/Button.svelte';
 import Select from '$lib/components/ui/Select.svelte';
 import Toggle from '$lib/components/ui/Toggle.svelte';
 import Icon from '$lib/components/ui/Icon.svelte';
 import { processSpeechText } from '$lib/services/speech-rules';
 import type { SpeechRule } from '$lib/utils/speech-rules';

 let rules = $state<SpeechRule[]>([]);
 let loading = $state(true);
 let loaded = $state(false);
 let busy = $state(false);
 let dirty = $state(false);
 let saved = $state(false);
 let error = $state('');
 let errors = $state<Record<string, string>>({});
 let source = $state('');
 let preview = $state<string | null>(null);
 let expandedId = $state<string | null>(null);
 const canNameRules = typeof window !== 'undefined' && window.ChungusAndroidClient?.readingRuleNames === true;
 const label = (rule: SpeechRule, index: number) => rule.name?.trim() || `Rule ${index + 1}`;
 function add() {
  const rule: SpeechRule = { id: crypto.randomUUID(), name: '', pattern: '', regex: false, caseSensitive: false, enabled: true };
  rules = [...rules, rule]; expandedId = rule.id; changed();
 }
 const available = typeof window !== 'undefined' && !!window.ChungusAndroidClient?.readingRules && !!window.ChungusAndroidClient?.saveReadingRules;
 function changed() { dirty = true; saved = false; preview = null; errors = {}; error = ''; }
 async function load() {
  loading = true; error = '';
  try { rules = await window.ChungusAndroidClient!.readingRules!(); loaded = true; }
  catch (e) { error = e instanceof Error ? e.message : 'Could not load text processing rules.'; }
  finally { loading = false; }
 }
 onMount(() => { if (available) void load(); else loading = false; });
 function reorder(event: CustomEvent<DndEvent<SpeechRule>>) { rules = event.detail.items; changed(); }
 async function run(save: boolean) {
  if (busy) return;
  busy = true; error = ''; errors = {}; preview = null;
  try {
   const result = await processSpeechText(save ? '' : source, $state.snapshot(rules));
   errors = result.errors;
   if (Object.keys(errors).length) { expandedId = rules.find(rule => errors[rule.id])?.id ?? null; error = 'Fix the highlighted rules before continuing.'; return; }
   if (save) { await window.ChungusAndroidClient!.saveReadingRules!($state.snapshot(rules)); dirty = false; saved = true; }
   else preview = result.text;
  } catch (e) { error = e instanceof Error ? e.message : 'Could not process speech rules.'; }
  finally { busy = false; }
 }
</script>

<section class="card" aria-label="Text processing">
 <div class="card-head"><span class="card-title">Text processing</span><span class="scope">This device</span></div>
 <div class="card-body">
  <p class="help">Remove words or patterns from speech only. Rules run from top to bottom, each using the previous result. Saved changes apply to the next reading.</p>
  {#if !available}<p class="help">Update the Android app to use text processing.</p>
  {:else if loading}<p class="help" role="status">Loading rules…</p>
  {:else if !loaded}<Button variant="ghost" size="sm" onclick={load}>Retry loading</Button>
  {:else}
   {#if !canNameRules}<p class="help">Update the Android app to 0.1.10 or newer to save rule names.</p>{/if}
   <div class="rules" use:dragHandleZone={{ items: rules, type: 'speech-rules', flipDurationMs: 160, dropTargetStyle: {}, delayTouchStart: 180, dragDisabled: busy }} onconsider={event => rules = event.detail.items} onfinalize={reorder}>
    {#each rules as rule, index (rule.id)}
     <div class="rule" class:off={!rule.enabled} class:has-error={!!errors[rule.id]}>
      <div class="rule-head">
       <!-- svelte-ignore a11y_no_static_element_interactions -->
       <span class="grip" use:dragHandle aria-label="Drag to reorder {label(rule, index)}" title="Drag to reorder"><Icon name="menu" class="w-4 h-4" /></span>
       <button type="button" class="rule-toggle" disabled={busy} aria-expanded={expandedId === rule.id} aria-controls="speech-rule-editor-{rule.id}" aria-label="Edit {label(rule, index)}" onclick={() => expandedId = expandedId === rule.id ? null : rule.id}>
        <Icon name={expandedId === rule.id ? 'chevronDown' : 'chevronRight'} class="w-3.5 h-3.5 shrink-0" />
        <span class="rule-label"><span class="rule-name" title={label(rule, index)}>{label(rule, index)}</span><span class="rule-kind">{rule.regex ? 'Regex' : 'Text'}</span></span>
       </button>
       <Toggle checked={rule.enabled} size="sm" label="Enable {label(rule, index)}" disabled={busy} onchange={value => { rule.enabled = value; changed(); }} />
       <button type="button" class="delete" disabled={busy} aria-label="Delete {label(rule, index)}" onclick={() => { rules = rules.filter(item => item.id !== rule.id); if (expandedId === rule.id) expandedId = null; changed(); }}><Icon name="trash" class="w-4 h-4" /></button>
      </div>
      {#if expandedId === rule.id}
       <div class="rule-editor" id="speech-rule-editor-{rule.id}">
        <div class="name-field"><label class="slider-label" for="speech-rule-name-{rule.id}">Name</label><input id="speech-rule-name-{rule.id}" type="text" maxlength="120" disabled={busy || !canNameRules} value={rule.name ?? ''} oninput={event => { rule.name = event.currentTarget.value; changed(); }} placeholder="Rule name" /></div>
        <div class="options">
         <Select value={rule.regex ? 'regex' : 'text'} disabled={busy} aria-label="Rule {index + 1} type" onchange={event => { rule.regex = event.currentTarget.value === 'regex'; changed(); }}><option value="text">Text</option><option value="regex">Regex</option></Select>
         <label class="case"><input type="checkbox" disabled={busy} bind:checked={rule.caseSensitive} onchange={changed} />Match case</label>
        </div>
        <label class="sr-only" for="speech-rule-{rule.id}">Rule {index + 1} pattern</label>
        <textarea id="speech-rule-{rule.id}" class="pattern" rows="2" maxlength="1000" disabled={busy} bind:value={rule.pattern} oninput={changed} spellcheck="false" aria-invalid={!!errors[rule.id]} placeholder={rule.regex ? 'Regex pattern, without / delimiters' : 'Word or phrase to skip'}></textarea>
       </div>
      {/if}
      {#if errors[rule.id]}<p class="rule-error">{errors[rule.id]}</p>{/if}
     </div>
    {/each}
   </div>
   {#if !rules.length}<p class="help">No rules. All spoken text is kept.</p>{/if}
   <p class="help">Text matches every occurrence, including inside words. Regex uses JavaScript syntax and runs globally. Example: \[[^\]]*\] removes text in square brackets.</p>
   <div class="actions">
    <Button variant="ghost" size="sm" disabled={busy || rules.length >= 30} onclick={add}>+ Add rule</Button>
    <Button variant="secondary" size="sm" disabled={busy || !dirty} onclick={() => run(true)}>Save rules</Button>
   </div>
   <p class="help" role="status">{busy ? 'Processing…' : dirty ? 'Unsaved changes' : saved ? 'Rules saved' : ''}</p>
   <div class="preview">
    <label class="slider-label" for="tts-preview-source">Preview draft rules</label>
    <p class="help">Paste plain text as it would be spoken, without Markdown formatting.</p>
    <textarea id="tts-preview-source" rows="4" maxlength="80000" disabled={busy} bind:value={source} oninput={() => preview = null} placeholder="Paste text to test…"></textarea>
    <Button variant="ghost" size="sm" disabled={busy || !source.trim()} onclick={() => run(false)}>Preview text</Button>
    {#if preview !== null}<div class="result"><span class="slider-label">Text to read</span><pre>{preview || 'Nothing remains to read.'}</pre></div>{/if}
   </div>
  {/if}
  {#if error}<div role="alert" class="rule-error">{error}</div>{/if}
 </div>
</section>

<style>
 .card-body,.rules,.preview { display:flex; flex-direction:column; gap:.75rem; }
 .rules { min-height:.5rem; }
 .rule { padding:.75rem; border:1px solid var(--color-border-subtle); border-radius:var(--radius-md); background:var(--color-bg-secondary); min-width:0; }
 .rule.off .pattern { opacity:.5; }
 .rule-head,.options,.actions { display:flex; align-items:center; gap:.65rem; }
 .rule-toggle { display:flex; align-items:center; gap:.4rem; flex:1; min-width:0; text-align:left; padding:.25rem 0; cursor:pointer; color:var(--color-text-primary); }
 .rule-label { display:flex; flex-direction:column; gap:.1rem; min-width:0; }
 .rule-name { font-size:.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
 .rule-kind { font-size:.65rem; color:var(--color-text-muted); }
 .rule.off .rule-label { opacity:.5; }
 .rule.has-error { border-color:var(--color-error); }
 .rule-editor { display:flex; flex-direction:column; gap:.65rem; margin-top:.65rem; padding-top:.65rem; border-top:1px solid var(--color-border-subtle); }
 .name-field { display:flex; flex-direction:column; gap:.4rem; }
 button:disabled { cursor:default; }
 .grip { display:flex; cursor:grab; touch-action:none; color:var(--color-text-muted); padding:.35rem; }
 .delete { display:flex; padding:.35rem; color:var(--color-text-muted); cursor:pointer; }
 .delete:hover { color:var(--color-error); }
 .options { flex-wrap:wrap; }
 .case { display:flex; align-items:center; gap:.35rem; font-size:.72rem; white-space:nowrap; }
 input[type="checkbox"] { accent-color:var(--color-accent); }
 textarea,input[type="text"] { width:100%; min-width:0; box-sizing:border-box; padding:.65rem; border:1px solid var(--color-border); border-radius:var(--radius-sm); background:var(--color-bg-primary); color:var(--color-text-primary); font-family:var(--font-ui); font-size:.8rem; resize:vertical; }
 textarea:focus,input[type="text"]:focus { outline:1px solid var(--color-accent); }
 .actions { justify-content:space-between; flex-wrap:wrap; }
 .preview { border-top:1px solid var(--color-border-subtle); padding-top:1rem; }
 .result pre { white-space:pre-wrap; overflow-wrap:anywhere; max-height:20rem; overflow-y:auto; font-family:var(--font-ui); font-size:.8rem; margin-top:.5rem; }
 .scope,.help { color:var(--color-text-muted); font-size:.72rem; line-height:1.6; margin:0; }
 .rule-error { color:var(--color-error); font-size:.75rem; overflow-wrap:anywhere; margin-top:.3rem; }
</style>
