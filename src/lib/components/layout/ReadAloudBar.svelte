<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { readAloudStore as reader } from '$lib/stores/read-aloud.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { lorebookStore } from '$lib/lorebook/store.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import type { ReadingCommand } from '$lib/services/android-client';
	function settings() {
		if (uiStore.guardBlocksNav()) return;
		uiStore.gotoSettingsPage('tts');
		uiStore.openSettings(() => lorebookStore.flush());
	}
	const active = $derived(reader.state.phase === 'playing' || reader.state.phase === 'preparing');
	async function command(value: ReadingCommand) {
		try { await reader.command(value); }
		catch (error) { toastStore.failed('control the reader', error); }
	}
	onMount(() => {
		let stopped = false;
		let polling = false;
		let dirty = false;
		const visible = () => document.visibilityState !== 'hidden' && window.ChungusAndroidClient?.foreground !== false;
		async function poll() {
			if (stopped || !visible()) return;
			if (polling) { dirty = true; return; }
			polling = true;
			try {
				do { dirty = false; await reader.refresh(); } while (dirty && !stopped && visible());
			} catch { /* A locked or suspended WebView refreshes on return. */ }
			finally {
				polling = false;
			}
		}
		void poll();
		window.addEventListener('chungus-android-ready', poll);
		window.addEventListener('chungus-android-lifecycle', poll);
		window.addEventListener('chungus-android-reading', poll);
		document.addEventListener('visibilitychange', poll);
		return () => {
			stopped = true;
			window.removeEventListener('chungus-android-ready', poll);
			window.removeEventListener('chungus-android-lifecycle', poll);
			window.removeEventListener('chungus-android-reading', poll);
			document.removeEventListener('visibilitychange', poll);
		};
	});
</script>

{#if reader.available && reader.state.phase !== 'idle'}
	<div class="read-aloud-bar" role="region" aria-label="Read aloud player">
		<div class="reading-row">
			<button type="button" class="reading-settings" onclick={settings} title="TTS settings" aria-label="TTS settings"><Icon name="settings" class="w-3.5 h-3.5" /></button>
			<div class="reading-controls" role="group" aria-label="Reading controls">
				<button type="button" disabled={reader.busy || reader.state.phase === 'error'} onclick={() => command('previous')} title="Previous sentence" aria-label="Previous sentence"><Icon name="skipBack" class="w-3.5 h-3.5" /></button>
				<button type="button" disabled={reader.busy || reader.state.phase === 'error'} onclick={() => command(active ? 'pause' : 'play')} title={active ? 'Pause' : 'Play'} aria-label={active ? 'Pause reading' : 'Resume reading'}><Icon name={active ? 'pause' : 'play'} class="w-3.5 h-3.5" /></button>
				<button type="button" disabled={reader.busy || reader.state.phase === 'error' || (!!reader.state.total && reader.state.sentence === reader.state.total)} onclick={() => command('next')} title="Next sentence" aria-label="Next sentence"><Icon name="skipForward" class="w-3.5 h-3.5" /></button>
			</div>
			<button type="button" class="reading-stop" disabled={reader.busy} onclick={() => command('stop')} title="Stop reading" aria-label="Stop reading"><Icon name="close" class="w-3.5 h-3.5" /></button>
		</div>
		{#if reader.state.error}<p class="reading-error" role="alert">{reader.state.error}</p>{/if}
	</div>
{/if}

<style>
	.read-aloud-bar { flex-shrink:0; display:flex; flex-direction:column; border-bottom:1px solid var(--color-border); background:var(--color-bg-secondary); font-family:var(--font-ui); }
	/* Match TitleBar's column, inset, icon width, padding and borders so all five
	   controls share its button centers, including when the chat column is capped. */
	.reading-row { width:100%; max-width:var(--chat-col-max); margin:0 auto; padding:.35rem .5rem; display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; }
	.reading-settings { justify-self:start; }
	.reading-stop { justify-self:end; }
	.reading-controls { display:inline-flex; align-items:center; justify-content:center; gap:.25rem; }
	.reading-error { max-width:var(--chat-col-max); margin:0 auto .35rem; padding:0 .5rem; font-size:.7rem; color:var(--color-text-muted); text-align:center; overflow-wrap:anywhere; }
	button { display:flex; flex-shrink:0; align-items:center; justify-content:center; height:2.5rem; padding:0 .5rem; border:1px solid transparent; border-radius:var(--radius-md); color:var(--color-accent); }
	button:hover { background:var(--color-bg-tertiary); }
	button:disabled { opacity:.35; }
</style>
