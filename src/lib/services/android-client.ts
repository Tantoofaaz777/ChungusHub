/** A staged character file, held privately by Android until import or cancellation. */
export interface AndroidSharedFile { id: string; name: string; mime: string; size: number }
export interface AndroidChatShortcut { id: string; chatId: string }

/** Optional Android shell. The same server build runs normally in desktop browsers. */
declare global {
	interface Window {
		ChungusAndroidClient?: {
			version: number;
			settings(): Promise<unknown>;
			pinChatShortcut?(chatId: string, title: string): Promise<void>;
			pendingChatShortcut?(): Promise<AndroidChatShortcut | null>;
			acknowledgeChatShortcut?(id: string): Promise<void>;
			back(): boolean;
			/** Available since APK 0.1.3; independent of delayed WebView visibility events. */
			readonly foreground?: boolean;
			/** Available since APK 0.1.4; resolves after Android verifies its own write. */
			copyText?(text: string): Promise<void>;
			/** Available since APK 0.1.5. Resolution means the Sharesheet opened. */
			shareText?(text: string): Promise<void>;
			shareFile?(filename: string, mime: string, build: () => Promise<Blob>): Promise<void>;
			incomingFiles?(): Promise<AndroidSharedFile[]>;
			readIncomingFile?(file: AndroidSharedFile): Promise<File>;
			removeIncomingFile?(id: string): Promise<unknown>;
			/** Available since APK 0.1.2: choose the destination before building the file. */
			save?(filename: string, mime: string, build: () => Promise<Blob>): Promise<void>;
		};
		__chungusAndroidBack?: () => boolean;
	}
}

export function isAndroidClient(): boolean {
	return typeof window !== 'undefined' && window.ChungusAndroidClient?.version === 1;
}

export function installAndroidBack(handler: () => boolean): () => void {
	if (!isAndroidClient()) return () => {};
	window.__chungusAndroidBack = handler;
	return () => { if (window.__chungusAndroidBack === handler) delete window.__chungusAndroidBack; };
}

export async function openAndroidSettings(): Promise<void> {
	await window.ChungusAndroidClient?.settings();
}

export function canShareNativeText(): boolean { return isAndroidClient() && !!window.ChungusAndroidClient?.shareText; }
export function canPinChatShortcut(): boolean { return isAndroidClient() && !!window.ChungusAndroidClient?.pinChatShortcut; }
export async function pinChatShortcut(chatId: string, title: string): Promise<void> {
	if (!canPinChatShortcut()) throw new Error('Update the Android app to create chat shortcuts.');
	await window.ChungusAndroidClient!.pinChatShortcut!(chatId, title);
}
export function canShareNativeFiles(): boolean { return isAndroidClient() && !!window.ChungusAndroidClient?.shareFile; }
export async function shareNativeText(text: string): Promise<void> {
	if (!canShareNativeText()) throw new Error('Update the Android app to share text.');
	await window.ChungusAndroidClient!.shareText!(text);
}
