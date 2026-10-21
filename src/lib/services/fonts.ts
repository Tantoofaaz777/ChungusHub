/**
 * On-demand loader for the bundled font families in static/fonts/.
 *
 * app.html links only the default families (Newsreader, Manrope, JetBrains
 * Mono). Alternative body/UI fonts load here the first time the user picks
 * one, so nobody pays for fonts they never use. Everything is served from
 * this origin, with no network dependency. Each family injects one stylesheet
 * <link>; failures degrade silently to the stack's fallback fonts.
 */
const loaded = new Set<string>();
const warmed = new WeakMap<ServiceWorker, Set<string>>();
const usedPaths = new Set<string>();
let watching = false;

/** Cache first-paint fonts too: they may have loaded before the worker took control. */
function warmUsedFonts(): void {
	if (!('serviceWorker' in navigator)) return;
	const worker = navigator.serviceWorker.controller;
	if (!worker) return;
	let sent = warmed.get(worker);
	if (!sent) { sent = new Set(); warmed.set(worker, sent); }
	for (const entry of performance.getEntriesByType('resource')) {
		const url = new URL(entry.name, location.href);
		if (url.origin === location.origin && url.pathname.startsWith('/fonts/')) usedPaths.add(url.pathname);
	}
	const paths = [...usedPaths].filter(path => !sent.has(path));
	if (!paths.length) return;
	worker.postMessage({ type: 'cache-fonts', paths });
	for (const path of paths) sent.add(path);
}

function watchFontCache(): void {
	if (watching || typeof document === 'undefined' || !('serviceWorker' in navigator)) return;
	watching = true;
	navigator.serviceWorker.addEventListener('controllerchange', warmUsedFonts);
	document.fonts.addEventListener('loadingdone', warmUsedFonts);
	void document.fonts.ready.then(warmUsedFonts);
}

export function ensureFontLoaded(bundledFont: string | undefined): void {
	watchFontCache();
	if (!bundledFont || loaded.has(bundledFont) || typeof document === 'undefined') return;
	loaded.add(bundledFont);
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = `/fonts/${bundledFont}.css`;
	link.addEventListener('load', () => { void document.fonts.ready.then(warmUsedFonts); });
	link.addEventListener('error', () => { loaded.delete(bundledFont); link.remove(); });
	document.head.appendChild(link);
}
