<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { memoryStore } from '$lib/memory/scene-store.svelte';
	import { MemoryReminderCounter, nextMemoryReminder, reminderBoundary } from '$lib/memory/reminders';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { countTokens, prepareTokenizer } from '$lib/tokenizer';
	import { resolveEncoding } from '$lib/tokenizer/encodings';
	import { resolvePromptTarget } from '$lib/utils/chat-setup';

	const counter = new MemoryReminderCounter();
	let visible = $state(false);
	onMount(() => {
		const update = () => { visible = document.visibilityState === 'visible'; };
		update();
		document.addEventListener('visibilitychange', update);
		return () => document.removeEventListener('visibilitychange', update);
	});

	// Keep the observer outside the panel: closing Chat Memory must not disable reminders.
	$effect(() => {
		const state = chatStore.currentChatState;
		const enabled = featurePromptsStore.loaded && featurePromptsStore.memoryReminderEnabled;
		const interval = featurePromptsStore.memoryReminderInterval;
		if (!enabled || !visible || uiStore.welcomeOpen || !state || chatStore.openingChatId ||
			chatStore.activeChatId !== state.chat.id || chatStore.stream?.chatId === state.chat.id ||
			chatStore.visibleLiveElsewhere || !memoryStore.loaded || memoryStore.refreshing || memoryStore.saving || memoryStore.loadError ||
			memoryStore.activeChatId !== state.chat.id || memoryStore.path.at(-1)?.id !== state.activePath.at(-1)?.id) return;

		const chatId = state.chat.id, originalPath = state.activePath;
		const originalMessages = state.allMessages;
		const scenes = memoryStore.scenes;
		const boundary = reminderBoundary(originalPath, memoryStore.resolved);
		const model = resolvePromptTarget(state.chat).model;
		const previous = chatStore.featureState(chatId).memoryReminder;
		// Track edits/visibility, but leave reasoning and other message metadata out of this work.
		const path = originalPath.map(message => ({ id: message.id, parentId: message.parentId,
			role: message.role, content: message.content, excludedFromPrompt: message.excludedFromPrompt }));
		let cancelled = false;
		function isCurrent(): boolean {
			return visible && !uiStore.welcomeOpen && featurePromptsStore.memoryReminderEnabled &&
				featurePromptsStore.memoryReminderInterval === interval && chatStore.activeChatId === chatId &&
				!chatStore.openingChatId && chatStore.currentChatState?.activePath === originalPath &&
				chatStore.currentChatState.allMessages === originalMessages &&
				resolvePromptTarget(chatStore.currentChatState.chat).model === model &&
				chatStore.stream?.chatId !== chatId && !chatStore.visibleLiveElsewhere &&
				memoryStore.activeChatId === chatId && memoryStore.loaded && !memoryStore.refreshing && !memoryStore.saving &&
				!memoryStore.loadError && memoryStore.scenes === scenes;
		}
		async function check(): Promise<void> {
			try {
				await prepareTokenizer(model);
				if (cancelled || !isCurrent()) return;
				const count = await counter.count(chatId, resolveEncoding(model), path, boundary,
					text => countTokens(text, model), () => cancelled);
				if (!count || cancelled || !isCurrent() || !nextMemoryReminder(chatId, path, count, interval, previous)) return;
				const claimed = await chatStore.claimMemoryReminder(chatId, path, count, interval, isCurrent);
				// Our own checkpoint write retriggers the effect. Its cleanup must not suppress
				// the notice we just saved; check the chat/path instead of the old timer ticket.
				if (!claimed || !isCurrent()) return;
				toastStore.info(`About ${count.total.toLocaleString('en-US')} tokens since the last memory. Time to create one?`, {
					key: `memory:${chatId}`, label: 'Open Chat Memory', open: () => {
						if (uiStore.guardBlocksNav()) return;
						void (async () => {
							if (chatStore.activeChatId !== chatId || uiStore.welcomeOpen) await chatStore.selectChat(chatId);
							if (chatStore.activeChatId === chatId && !uiStore.welcomeOpen) uiStore.openOverlay('memory');
						})().catch(error => toastStore.failed('open Chat Memory', error));
					}
				});
			} catch (error) {
				if (!cancelled && isCurrent()) toastStore.failed('check the memory reminder', error);
			}
		}
		// A committed turn/branch refresh may update path and memories in separate steps.
		const timer = untrack(() => setTimeout(() => { void check(); }, 250));
		return () => { cancelled = true; clearTimeout(timer); };
	});
</script>
