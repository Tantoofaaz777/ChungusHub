/**
 * Which scene the open chat wears.
 *
 * A chat either follows the app's background or carries one of its own, stored on its own
 * row (`feature_state`, architecture/chat-sessions.md). Flipping the switch on seeds the
 * chat from what is already on screen, so the press itself changes nothing.
 *
 * Switching back off KEEPS the chat's scene. The switch is a switch, not a way to lose an
 * afternoon's tuning, and it is what spares this control the destructive-act ladder.
 *
 * Writes are debounced because a chat row write broadcasts the `chats` scope, which every
 * other device answers with a chat-list refetch: a slider drag would send one per frame.
 * The pending scene is what the app reads meanwhile, so the drag still paints at full rate,
 * and the write carries the chat id it started on, so switching chats mid-flight lands it
 * on the story it was made for.
 */

import { chatStore } from '$lib/stores/chat.svelte';
import { fileUrl } from '$lib/services/transport';
import { normalizeChatFeatureState, type ChatScene } from '$lib/types/chat';
import type { BackgroundConfig } from '$lib/types/background';

const PERSIST_MS = 250;

class ChatSceneStore {
	/** Written but not yet persisted, with the chat it belongs to. */
	private pending = $state<{ chatId: string; scene: ChatScene } | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * The chat ON SCREEN, which is deliberately not the chat being navigated to.
	 *
	 * `activeChatId` is claimed the moment a row is clicked and the rows themselves land a
	 * couple of hundred milliseconds later, so a scene keyed on the id changes the
	 * background and the weather at the click and then leaves the story that was there
	 * sitting under a stranger's sky until its replacement arrives. Keyed on the loaded
	 * chat, the scene and the story it belongs to arrive together, and leaving for the
	 * landing screen (which clears this outright) is still instant.
	 */
	private openChat = $derived(chatStore.currentChatState?.chat ?? null);

	/** The open chat's own scene, in force or merely kept, or null if it has never had one. */
	scene = $derived.by((): ChatScene | null => {
		const chat = this.openChat;
		if (!chat) return null;
		if (this.pending?.chatId === chat.id) return this.pending.scene;
		return normalizeChatFeatureState(chat.featureState).scene;
	});

	/** The scene the workspace and the settings cards are on, or null while the app's is. */
	active = $derived(this.scene?.enabled ? this.scene : null);

	/**
	 * The picture belonging to the chat being OPENED, which is not yet the chat on screen.
	 *
	 * Its rows and its picture are two independent fetches, and waiting for the scene to
	 * be in force before starting the second one puts them end to end: the story lands,
	 * and its sky follows a beat later. Whoever draws the background warms this the moment
	 * a row is clicked, while the swap itself still waits for the chat, so the two arrive
	 * together. Null once that chat IS the one on screen, or when it has no picture.
	 */
	openingBackground = $derived.by((): string | null => {
		const chatId = chatStore.activeChatId;
		if (!chatId || chatId === this.openChat?.id) return null;
		const row = chatStore.chats.find((chat) => chat.id === chatId);
		const scene = row ? normalizeChatFeatureState(row.featureState).scene : null;
		if (!scene?.enabled || !scene.background.path) return null;
		return fileUrl(scene.background.path);
	});

	/** Whether there is a chat to give a scene to at all. */
	canScope = $derived(this.openChat !== null);

	/** How many other chats an app-wide change will not reach. */
	otherChatsWithScene = $derived.by((): number => {
		const openId = this.openChat?.id ?? null;
		return chatStore.chats.filter(
			(chat) =>
				chat.id !== openId && normalizeChatFeatureState(chat.featureState).scene?.enabled === true
		).length;
	});

	/** Put this chat on its own scene, seeding a chat that has never had one from what is
	 *  already on screen. An existing scene comes back as it was left. */
	adopt(background: BackgroundConfig): void {
		const existing = this.scene;
		this.write(existing ? { ...existing, enabled: true } : { enabled: true, background });
	}

	/** Hand the chat back to the app's scene, keeping its own for the way back. */
	release(): void {
		const existing = this.scene;
		if (existing) this.write({ ...existing, enabled: false });
	}

	/** Replace the open chat's scene. Called by the background store whenever a control
	 *  writes while a chat scene is in force. */
	write(next: ChatScene): void {
		// The chat on screen, never the one being navigated to: a write must land on the
		// story whose scene the reader is looking at while they edit it.
		const chatId = this.openChat?.id;
		// The callers all gate on `active` or `canScope`, so no open chat here is a bug in
		// one of them rather than a state worth absorbing.
		if (!chatId) throw new Error('No chat is open, so there is no scene to write');
		this.pending = { chatId, scene: next };
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.flush(), PERSIST_MS);
	}

	private async flush(): Promise<void> {
		this.timer = null;
		const write = this.pending;
		if (!write) return;
		await chatStore.updateChatFeatureState(write.chatId, { scene: write.scene });
		// Only drop what actually went out: a drag that carried on during the round trip
		// left a newer scene here, and clearing it would snap the slider back.
		if (this.pending === write) this.pending = null;
	}
}

export const chatSceneStore = new ChatSceneStore();
