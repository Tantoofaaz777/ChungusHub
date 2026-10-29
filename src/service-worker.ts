/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Minimal app-shell service worker: it makes the PWA installable and lets the
 * static assets load offline. API/WS/file requests stay outside the app-shell cache;
 * their own response headers decide whether the browser may reuse them.
 */
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self as sw } from '$app/service-worker';

// Manifest paths are relative to the app root; cache and request keys are absolute paths.
const build = immutable.map(({ path }) => `/${path}`);
const files = assets.map(({ path }) => `/${path}`);
const CACHE = `chungushub-${version}`;
const BOOT_MANIFEST = '/_app/boot-assets.json';
const BUILD_ASSETS = new Set(build);
const APP_ASSETS = new Set([...build, ...files]);
const PRECACHE = ['/', BOOT_MANIFEST, ...build.filter((path) => !path.includes('/immutable/')),
	...files.filter((path) => !path.startsWith('/fonts/'))];

// First-paint font requests can finish before this worker controls the page. The client
// hands over only the font resources it actually requested, not every available family.
sw.addEventListener('message', (event) => {
	const data: unknown = event.data;
	if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'cache-fonts' || !('paths' in data) || !Array.isArray(data.paths)) return;
	const paths = [...new Set(data.paths.filter((path): path is string =>
		typeof path === 'string' && path.startsWith('/fonts/') && APP_ASSETS.has(path)))];
	if (!paths.length) return;
	event.waitUntil(caches.open(CACHE).then(async (cache) => {
		await Promise.all(paths.map(async (path) => {
			if (await cache.match(path)) return;
			const response = await fetch(path);
			if (response.status === 200) await cache.put(path, response);
		}));
	}).catch((error) => console.warn('Could not cache used fonts:', error)));
});

sw.addEventListener('install', (event) => {
	event.waitUntil((async () => {
		const response = await fetch(BOOT_MANIFEST, { cache: 'no-cache' });
		if (!response.ok) throw new Error('Could not load the offline boot manifest.');
		const boot: unknown = await response.json();
		if (!Array.isArray(boot) || boot.some((path) => typeof path !== 'string' || !BUILD_ASSETS.has(path))) {
			throw new Error('Invalid offline boot manifest.');
		}
		const cache = await caches.open(CACHE);
		await cache.addAll([...new Set([...PRECACHE, ...boot])]);
		await sw.skipWaiting();
	})());
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;
	// Never put live data or user files in the app-shell cache. A stored image's own immutable,
	// private HTTP cache policy may still let the browser reuse it without a network trip.
	if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname === '/ws') {
		return;
	}

	// A panel or font joins the offline cache on first use, without delaying its response.
	if (APP_ASSETS.has(url.pathname)) {
		event.respondWith(
			caches.open(CACHE).then(async (cache) => {
				const cached = await cache.match(request);
				if (cached) return cached;
				const response = await fetch(request);
				if (response.status === 200) event.waitUntil(cache.put(request, response.clone()));
				return response;
			})
		);
		return;
	}

	event.respondWith(
		fetch(request).catch(() => caches.open(CACHE).then(async (cache) =>
			await cache.match(request) ?? await cache.match('/') ?? new Response('Offline', { status: 503 })))
	);
});
