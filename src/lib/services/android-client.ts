/** Optional Android shell. The same server build runs normally in desktop browsers. */
declare global {
	interface Window {
		ChungusAndroidClient?: {
			version: number;
			settings(): Promise<unknown>;
			back(): boolean;
			/** Available since APK 0.1.3; independent of delayed WebView visibility events. */
			readonly foreground?: boolean;
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
