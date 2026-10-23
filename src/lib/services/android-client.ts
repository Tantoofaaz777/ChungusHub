import type { SpeechRule } from '../utils/speech-rules';

/** A staged character file, held privately by Android until import or cancellation. */
export interface AndroidSharedFile { id: string; name: string; mime: string; size: number }
export interface AndroidChatShortcut { id: string; chatId: string }
export interface AndroidReadingState {
	phase: 'idle' | 'preparing' | 'playing' | 'paused' | 'error';
	title?: string;
	sentence?: number;
	total?: number;
	error?: string | null;
}
export type ReadingCommand = 'play' | 'pause' | 'previous' | 'next' | 'stop';

export interface AndroidSpeechChoice { engine: string; voice: string; rate: number }
export interface AndroidSpeechVoice { id: string; language: string; languageLabel: string; network: boolean }
export interface AndroidSpeechSettings extends AndroidSpeechChoice {
	engineLabel: string;
	defaultVoice: string;
	selectionAvailable: boolean;
	voices: AndroidSpeechVoice[];
}

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
			/** Available since APK 0.1.8. Playback belongs to the native media service. */
			readAloud?(text: string, title: string): Promise<void>;
			readingState?(): Promise<AndroidReadingState>;
			readingCommand?(command: ReadingCommand): Promise<AndroidReadingState>;
			/** Available since APK 0.1.9. Settings are stored only on this Android device. */
			readingRules?(): Promise<SpeechRule[]>;
			saveReadingRules?(rules: SpeechRule[]): Promise<void>;
			readingSettings?(): Promise<AndroidSpeechSettings>;
			saveReadingSettings?(settings: AndroidSpeechChoice): Promise<AndroidSpeechChoice>;
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
export function canReadAloud(): boolean {
	const client = typeof window !== 'undefined' ? window.ChungusAndroidClient : undefined;
	return isAndroidClient() && !!client?.readAloud && !!client.readingState && !!client.readingCommand;
}
export function canConfigureReadAloud(): boolean {
	return isAndroidClient() && !!window.ChungusAndroidClient?.readingSettings && !!window.ChungusAndroidClient?.saveReadingSettings;
}
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
