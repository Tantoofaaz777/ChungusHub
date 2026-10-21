/** Optional Android shell. The same server build runs normally in desktop browsers. */
declare global {
	interface Window {
		ChungusAndroidClient?: { version: number; settings(): Promise<unknown>; back(): boolean };
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
