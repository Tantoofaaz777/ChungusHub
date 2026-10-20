<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import ExpandableTextarea from '$lib/components/ui/ExpandableTextarea.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';

	let { chatId, onClose }: { chatId: string; onClose: () => void } = $props();

	// Capture the owning chat so navigation cannot send a pending edit to another story.
	const targetChatId = untrack(() => chatId);
	const initial = untrack(() => chatStore.featureState(targetChatId).authorsNote);
	let text = $state(initial.text);
	let enabled = $state(initial.enabled);
	let closing = $state(false);
	let mounted = true;
	let dirty = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastWrite: Promise<void> = Promise.resolve();

	function flush(): Promise<void> {
		clearTimeout(timer);
		timer = undefined;
		if (!dirty) return lastWrite;
		dirty = false;
		lastWrite = chatStore.updateChatFeatureState(targetChatId, { authorsNote: { text, enabled } });
		return lastWrite;
	}

	function persist(): void {
		void flush().catch((error) => {
			dirty = true;
			toastStore.failed("save author's notes", error);
		});
	}

	function edit(value: string): void {
		text = value;
		dirty = true;
		clearTimeout(timer);
		timer = setTimeout(persist, 400);
	}

	function toggle(value: boolean): void {
		enabled = value;
		dirty = true;
		persist();
	}

	async function close(): Promise<void> {
		if (closing) return;
		closing = true;
		try {
			await flush();
			if (mounted) onClose();
		} catch (error) {
			dirty = true;
			toastStore.failed("save author's notes", error);
		} finally {
			closing = false;
		}
	}

	// Also commit when navigation unmounts the editor or the browser backgrounds it.
	onDestroy(() => {
		mounted = false;
		if (dirty) persist();
		else clearTimeout(timer);
	});
	onMount(() => {
		const hide = () => { if (dirty) persist(); };
		const visibility = () => { if (document.hidden) hide(); };
		window.addEventListener('pagehide', hide);
		document.addEventListener('visibilitychange', visibility);
		return () => {
			window.removeEventListener('pagehide', hide);
			document.removeEventListener('visibilitychange', visibility);
		};
	});
</script>

<Dialog open={true} onClose={close} title="Author's notes" titleAlign="left" size="lg" placement="center" bare>
	<div class="notes-form panel-scroll">
		<div class="notes-status font-ui">
			<span>Enabled</span>
			<Toggle checked={enabled} onchange={toggle} disabled={closing} label="Enable author's notes" />
		</div>
		<label class="sr-only" for="authors-notes-text">Author's notes</label>
		<ExpandableTextarea
			id="authors-notes-text"
			value={text}
			onValueChange={edit}
			dialogTitle="Author's notes"
			placeholder="Tone, pacing, or direction for this story…"
			rows={8}
			maxHeight={360}
			class="input-base w-full px-3 py-2 text-sm text-text-primary"
			disabled={closing}
		/>
	</div>
</Dialog>

<style>
	.notes-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
		padding: 1.25rem;
		/* Match the header's inset without reserving an unused scrollbar on the right. */
		scrollbar-gutter: auto;
	}

	.notes-status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
	}

</style>
