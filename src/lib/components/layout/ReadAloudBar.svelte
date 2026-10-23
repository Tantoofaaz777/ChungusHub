<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { readAloudStore as reader } from '$lib/stores/read-aloud.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import type { ReadingCommand } from '$lib/services/android-client';
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
		<span class="reader-icon" aria-hidden="true"><Icon name="volume" class="w-4 h-4" /></span>
		<div class="reading-info">
			<span class="reading-title">{reader.state.title || 'Read aloud'}</span>
			<span class="reading-status">{reader.state.error || (reader.state.phase === 'preparing' ? 'Preparing speech…' : `${reader.state.phase === 'paused' ? 'Paused · ' : ''}Sentence ${reader.state.sentence ?? 1} of ${reader.state.total ?? '…'}`)}</span>
		</div>
		<div class="reading-controls" role="group" aria-label="Reading controls">
			<button type="button" disabled={reader.busy || reader.state.phase === 'error'} onclick={() => command('previous')} title="Previous sentence" aria-label="Previous sentence"><Icon name="skipBack" class="w-4 h-4" /></button>
			<button type="button" disabled={reader.busy || reader.state.phase === 'error'} onclick={() => command(active ? 'pause' : 'play')} title={active ? 'Pause' : 'Play'} aria-label={active ? 'Pause reading' : 'Resume reading'}><Icon name={active ? 'pause' : 'play'} class="w-4 h-4" /></button>
			<button type="button" disabled={reader.busy || reader.state.phase === 'error' || (!!reader.state.total && reader.state.sentence === reader.state.total)} onclick={() => command('next')} title="Next sentence" aria-label="Next sentence"><Icon name="skipForward" class="w-4 h-4" /></button>
			<button type="button" disabled={reader.busy} onclick={() => command('stop')} title="Stop reading" aria-label="Stop reading"><Icon name="close" class="w-4 h-4" /></button>
		</div>
	</div>
{/if}

<style>
	.read-aloud-bar { flex-shrink:0; display:flex; align-items:center; gap:.65rem; padding:.35rem .75rem; border-bottom:1px solid var(--color-border); background:var(--color-bg-secondary); font-family:var(--font-ui); }
	.reader-icon { display:flex; flex-shrink:0; color:var(--color-accent); }
	.reading-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:.1rem; }
	.reading-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.75rem; color:var(--color-text-primary); }
	.reading-status { font-size:.65rem; color:var(--color-text-muted); overflow-wrap:anywhere; }
	.reading-controls { display:flex; align-items:center; flex-shrink:0; }
	button { display:flex; align-items:center; justify-content:center; width:2.5rem; height:2.5rem; border-radius:var(--radius-md); color:var(--color-accent); }
	button:hover { background:var(--color-bg-tertiary); }
	button:disabled { opacity:.35; }
	@media(max-width:400px) { .read-aloud-bar { gap:.4rem; padding-inline:.5rem; } .reader-icon { display:none; } }
</style>
