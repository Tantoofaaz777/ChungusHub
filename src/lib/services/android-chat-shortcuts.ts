import { isAndroidClient } from './android-client';

interface ChatShortcutHost {
	blocked(): boolean;
	exists(chatId: string): Promise<boolean>;
	/** A failed chat selection already reports its own error. */
	open(chatId: string): Promise<void>;
	missing(): void;
	failed(error: unknown): void;
}

/** Mount only after authenticated workspace boot. Native requests survive the unlock page. */
export function installAndroidChatShortcuts(host: ChatShortcutHost): () => void {
	if (!isAndroidClient() || !window.ChungusAndroidClient?.pendingChatShortcut) return () => {};
	const surface = window;
	const client = surface.ChungusAndroidClient!;
	let active = true, running = false, again = false;
	const consumed = new Set<string>();
	const available = () => active && client.foreground !== false;
	async function refresh() {
		if (!available()) return;
		if (running) { again = true; return; }
		running = true;
		try {
			const target = await client.pendingChatShortcut!();
			if (!available() || !target) return;
			if (typeof target.id !== 'string' || !target.id || typeof target.chatId !== 'string' || !target.chatId) throw new Error('Invalid Android chat shortcut');
			if (!consumed.has(target.id)) {
				if (!host.blocked()) {
					const exists = await host.exists(target.chatId);
					if (!available()) return;
					if (!exists) host.missing();
					else if (!host.blocked()) await host.open(target.chatId);
				}
				// A refused navigation is an attempted click, not a deferred jump after editing.
				consumed.add(target.id);
				if (consumed.size > 32) consumed.delete(consumed.values().next().value!);
			}
			await client.acknowledgeChatShortcut?.(target.id);
		} catch (error) { if (available()) host.failed(error); }
		finally {
			running = false;
			if (again && active) { again = false; void refresh(); }
		}
	}
	const resume = () => { void refresh(); };
	const events = ['chungus-android-ready', 'chungus-android-chat-shortcut', 'chungus-android-lifecycle'];
	for (const event of events) surface.addEventListener(event, resume);
	void refresh();
	return () => { if (!active) return; active = false; for (const event of events) surface.removeEventListener(event, resume); };
}
