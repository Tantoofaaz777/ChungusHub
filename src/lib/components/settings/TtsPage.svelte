<script lang="ts">
	import SpeechRulesEditor from './SpeechRulesEditor.svelte';
	import { onMount } from 'svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { rangeReset } from '$lib/actions/rangeReset';
	import { isAndroidClient } from '$lib/services/android-client';
	import { speechSettingsStore as speech } from '$lib/stores/speech-settings.svelte';
	let language = $state('');
	const languages = $derived([...new Map((speech.data?.voices ?? []).map(voice => [voice.language, voice.languageLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1])));
	const voices = $derived((speech.data?.voices ?? []).filter(voice => !language || voice.language === language));
	onMount(() => { void speech.load(); });
</script>

<div class="tts-page" data-setting="tts">
	{#if !speech.available}
		<p class="help">{isAndroidClient() ? 'Install Android app 0.1.9 or newer to choose a voice and reading speed.' : 'Voice settings are available in the Android app.'}</p>
	{:else if speech.loading}
		<p class="help" role="status">Loading voices…</p>
	{:else if speech.data}
		<section class="card">
			<div class="card-head"><span class="card-title">Voice</span><span class="scope">This device</span></div>
			<div class="card-body">
				<p class="help">Voices from {speech.data.engineLabel || 'Android’s default speech engine'}. Changes apply the next time you start Read aloud.</p>
				<div class="field"><label for="tts-language" class="slider-label">Filter by language</label>
					<Select id="tts-language" bind:value={language}><option value="">All languages</option>{#each languages as [id, label] (id)}<option value={id}>{label}</option>{/each}</Select>
				</div>
				<div class="field"><label for="tts-voice" class="slider-label">Voice</label>
					<Select id="tts-voice" value={speech.data.voice} onchange={event => speech.update({ voice: event.currentTarget.value })}>
						<option value="">Android default</option>
						{#if !speech.data.selectionAvailable}<option value={speech.data.voice} disabled>Unavailable voice: choose another</option>
						{:else if speech.data.voice && !voices.some(voice => voice.id === speech.data!.voice)}{@const selected = speech.data.voices.find(voice => voice.id === speech.data!.voice)}<option value={speech.data.voice}>{selected?.languageLabel} · {speech.data.voice}</option>{/if}
						{#each voices as voice (voice.id)}<option value={voice.id}>{voice.languageLabel} · {voice.id} · {voice.network ? 'Online' : 'Offline'}</option>{/each}
					</Select>
				</div>
				{#if !speech.data.selectionAvailable}<p class="help">The saved voice is unavailable in the current engine. Choose another voice or Android default.</p>{/if}
				{#if !speech.data.voices.length}<p class="help">No selectable voices were reported. Android default is still available.</p>{/if}
				<p class="help">Online voices require an internet connection.</p>
			</div>
		</section>
		<section class="card">
			<div class="card-head"><span class="card-title">Reading speed</span></div>
			<div class="card-body">
				<div class="slider-top"><label for="tts-rate" class="slider-label">Speed</label><span class="slider-value">{speech.data.rate.toFixed(2)}×</span></div>
				<input id="tts-rate" type="range" class="slider" min="0.5" max="2" step="0.05" value={speech.data.rate}
					disabled={!speech.data.selectionAvailable} oninput={event => speech.update({ rate: Number(event.currentTarget.value) })}
					use:rangeReset={{ defaultValue: 1, apply: rate => speech.update({ rate }) }} />
				<p class="help">1.00× is normal speed. Double-click the slider to reset.</p>
			</div>
		</section>
		<SpeechRulesEditor />
		<div class="footer"><Button variant="ghost" size="sm" disabled={speech.saving || (speech.unsaved && !speech.error)} onclick={() => speech.load(true)}>Refresh voices</Button><span class="save-status" role="status">{speech.saving || (speech.unsaved && !speech.error) ? 'Saving…' : ''}</span></div>
	{/if}
	{#if speech.error}<div class="error" role="alert"><p>{speech.error}</p><Button variant="secondary" size="sm" disabled={speech.loading || speech.saving} onclick={() => speech.unsaved ? speech.save() : speech.load(true)}>Retry</Button></div>{/if}
</div>

<style>
	.tts-page { display:flex; flex-direction:column; gap:1rem; }
	.card-body { display:flex; flex-direction:column; gap:.85rem; }
	.field { display:flex; flex-direction:column; gap:.5rem; min-width:0; }
	.slider-top,.footer { display:flex; align-items:center; justify-content:space-between; gap:.75rem; }
	.scope,.save-status { font-size:.7rem; color:var(--color-text-muted); }
	.help { margin:0; font-size:.75rem; line-height:1.6; color:var(--color-text-muted); }
	.error { display:flex; align-items:center; gap:.75rem; font-size:.8rem; color:var(--color-error); }
	.error p { flex:1; overflow-wrap:anywhere; }
</style>
