<script lang="ts">
 import { onMount } from 'svelte';
 import { dragHandleZone, dragHandle, type DndEvent } from 'svelte-dnd-action';
 import Button from '#lib/components/ui/Button.svelte';
 import Select from '#lib/components/ui/Select.svelte';
 import Toggle from '#lib/components/ui/Toggle.svelte';
 import Icon from '#lib/components/ui/Icon.svelte';
 import { processSpeechText } from '#lib/services/speech-rules.ts';
 import { saveGeneratedDownload } from '#lib/services/libraryExport.ts';
 import { appendSpeechRules, parseSpeechRulesImport, serializeSpeechRules, SPEECH_RULE_FILE_LIMIT } from '#lib/utils/speech-rules-io.ts';
 import type { SpeechRule } from '#lib/utils/speech-rules.ts';

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
 let fileInput = $state<HTMLInputElement>();
 let pendingImport = $state<SpeechRule[] | null>(null);
 const canNameRules = typeof window !== 'undefined' && window.ChungusAndroidClient?.readingRuleNames === true;
 const canReplace = typeof window !== 'undefined' && window.ChungusAndroidClient?.readingRuleReplacements === true;
 const label = (rule: SpeechRule, index: number) => rule.name?.trim() || `Rule ${index + 1}`;
 function add() {
  const rule: SpeechRule = { id: crypto.randomUUID(), name: '', pattern: '', replacement: '', regex: false, caseSensitive: false, enabled: true };
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
 async function importFile(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0]; input.value = '';
  if (!file || busy) return;
  busy = true; error = ''; pendingImport = null;
  try {
   if (file.size > SPEECH_RULE_FILE_LIMIT) throw new Error('Rule files must be smaller than 512 KB.');
   const imported = parseSpeechRulesImport(await file.text());
   if (!canNameRules && imported.some(rule => rule.name)) throw new Error('Update the Android app to import rule names.');
   if (!canReplace && imported.some(rule => rule.replacement)) throw new Error('Update the Android app to import replacements.');
   const result = await processSpeechText('', imported);
   const invalid = imported.find(rule => result.errors[rule.id]);
   if (invalid) throw new Error(`${invalid.name?.trim() || `Rule ${imported.indexOf(invalid) + 1}`}: ${result.errors[invalid.id]}`);
   pendingImport = imported;
  } catch (e) { error = e instanceof Error ? e.message : 'Could not import speech rules.'; }
  finally { busy = false; }
 }
 function applyImport(append: boolean) {
  if (!pendingImport || busy) return;
  try {
   rules = append ? appendSpeechRules($state.snapshot(rules), $state.snapshot(pendingImport)) : $state.snapshot(pendingImport);
   pendingImport = null; expandedId = null; changed();
  } catch (e) { error = e instanceof Error ? e.message : 'Could not import speech rules.'; }
 }
 async function exportRules() {
  if (busy) return;
  busy = true; error = ''; errors = {};
  try {
   const snapshot = $state.snapshot(rules);
   const result = await processSpeechText('', snapshot);
   errors = result.errors;
   if (Object.keys(errors).length) { expandedId = snapshot.find(rule => errors[rule.id])?.id ?? null; throw new Error('Fix the highlighted rules before exporting.'); }
   const json = serializeSpeechRules(snapshot);
   await saveGeneratedDownload('chungus-speech-rules.json', 'application/json', async () => new Blob([json], { type: 'application/json' }));
  } catch (e) { error = e instanceof Error ? e.message : 'Could not export speech rules.'; }
  finally { busy = false; }
 }
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
  <p class="help">Replace or remove words and patterns from speech only. Rules run from top to bottom, each using the previous result. Saved changes apply to the next reading.</p>
  {#if !available}<p class="help">Update the Android app to use text processing.</p>
  {:else if loading}<p class="help" role="status">Loading rules…</p>
  {:else if !loaded}<Button variant="ghost" size="sm" onclick={load}>Retry loading</Button>
  {:else}
   <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={importFile} aria-label="Import speech rules file" />
   <div class="transfer-actions">
    <Button variant="ghost" size="sm" disabled={busy} onclick={() => fileInput?.click()}><Icon name="upload" class="w-3.5 h-3.5" />Import</Button>
    <Button variant="ghost" size="sm" disabled={busy} onclick={exportRules}><Icon name="download" class="w-3.5 h-3.5" />Export</Button>
   </div>
   <p class="help">Export the current draft as JSON. Imported rules stay in the draft until you save them.</p>
   {#if pendingImport}
    <div class="import-choice" role="region" aria-label="Imported speech rules">
     <p class="help">{pendingImport.length} rule{pendingImport.length === 1 ? '' : 's'} ready to import. Add to the end of this draft or replace it.</p>
     <div class="transfer-actions">
      <Button variant="secondary" size="sm" disabled={busy || rules.length + pendingImport.length > 30 || !pendingImport.length} onclick={() => applyImport(true)}>Add to rules</Button>
      <Button variant="secondary" size="sm" disabled={busy} onclick={() => applyImport(false)}>Replace rules</Button>
      <Button variant="ghost" size="sm" disabled={busy} onclick={() => { pendingImport = null; error = ''; }}>Cancel import</Button>
     </div>
     {#if rules.length + pendingImport.length > 30}<p class="help">Adding would exceed the limit of 30 rules. Replace the draft or import fewer rules.</p>{/if}
    </div>
   {/if}
   {#if !canNameRules}<p class="help">Update the Android app to 0.1.10 or newer to save rule names.</p>{/if}
   {#if !canReplace}<p class="help">Update the Android app to 0.1.13 or newer to save replacements.</p>{/if}
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
        <label class="slider-label" for="speech-rule-{rule.id}">Match text</label>
        <textarea id="speech-rule-{rule.id}" class="pattern" rows="2" maxlength="1000" disabled={busy} bind:value={rule.pattern} oninput={changed} spellcheck="false" aria-invalid={!!errors[rule.id]} placeholder={rule.regex ? 'Regex pattern, without / delimiters' : 'Word or phrase to match'}></textarea>
        <label class="slider-label" for="speech-rule-replacement-{rule.id}">Replace to</label>
        <textarea id="speech-rule-replacement-{rule.id}" class="pattern" rows="2" maxlength="1000" disabled={busy || !canReplace} value={rule.replacement ?? ''} oninput={event => { rule.replacement = event.currentTarget.value; changed(); }} spellcheck="false" aria-describedby="speech-rule-replacement-help-{rule.id}" placeholder="Leave empty to remove matched text"></textarea>
        <p class="help" id="speech-rule-replacement-help-{rule.id}">Leave empty to remove matches.{rule.regex ? ' Use $1, $2 or $<name> to insert captured groups.' : ''}</p>
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
 .transfer-actions { display:flex; flex-wrap:wrap; gap:.4rem; }
 .import-choice { display:flex; flex-direction:column; gap:.5rem; padding:.75rem; border:1px solid var(--color-border); border-radius:var(--radius-md); }
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
