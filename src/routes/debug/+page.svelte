<script lang="ts">
	/**
	 * The prompt debug panel on its own window. The app's "Pop out" button opens this,
	 * so the log can live on a second screen while the workspace stays whole.
	 *
	 * It is deliberately NOT a second app instance. The log is captured server-side and
	 * broadcast to every listening socket (architecture/tokenizer-debug.md), so this page
	 * boots the socket and the theme and nothing else: no chats, no library, no presets.
	 */
	import PromptDebugPanel from '$lib/components/debug/PromptDebugPanel.svelte';
	import { db } from '$lib/services/database';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { promptLogStore } from '$lib/debug/promptLog.svelte';
	import { reloadAllSyncedSettings } from '$lib/services/syncedSetting';
	import { AccessDeniedError, onSync } from '$lib/services/transport';
	import { onMount } from 'svelte';

	type Phase = 'loading' | 'ready' | 'error' | 'denied';

	let phase = $state<Phase>('loading');
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			// The socket the prompt-log feed rides, then the --theme-* vars the panel is
			// styled against. Order matters for the same reason it does in AppShell.boot():
			// the theme reads a settings row over the bridge.
			await db.initialize();
			await themeStore.initialize();
			// themeStore registers a settings reload, but `initSync()`, which drives every
			// registered reload, is part of the app boot this window skips, and calling it
			// here would reload a dozen stores this page never initialized. Drive the one
			// scope that matters instead, or a palette change in the app window leaves this
			// one painting yesterday's theme until it is reopened.
			onSync((scope) => {
				if (scope === 'settings') void reloadAllSyncedSettings();
			});
			// Ask the server for the feed and backfill the shared buffer. Capture runs while
			// ANY socket is listening, so this window keeps logging even with the app
			// window's logging toggle off.
			promptLogStore.setEnabled(true);
			phase = 'ready';
		} catch (e) {
			if (e instanceof AccessDeniedError) {
				phase = 'denied';
				return;
			}
			error = e instanceof Error ? e.message : 'Failed to open the debug window';
			console.error('Debug window initialization error:', e);
			phase = 'error';
		}
	});
</script>

<svelte:head>
	<title>Prompt Debug · ChungusHub</title>
</svelte:head>

<div class="debug-window surface-shell">
	{#if phase === 'ready'}
		<PromptDebugPanel standalone />
	{:else}
		<div class="state">
			{#if phase === 'denied'}
				<p class="err">
					This device isn't on the allowlist. Ask the host to allow its IP from
					Settings → Security.
				</p>
			{:else if phase === 'error'}
				<p class="err">{error}</p>
			{:else}
				<p>Connecting to the shared prompt log…</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.debug-window {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.state {
		flex: 1;
		display: grid;
		place-items: center;
		padding: 1.5rem;
		text-align: center;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		color: var(--color-text-secondary);
	}

	.state .err {
		max-width: 28rem;
		color: var(--color-error);
	}
</style>
