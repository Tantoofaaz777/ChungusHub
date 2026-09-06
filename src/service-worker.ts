/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Minimal app-shell service worker: it makes the PWA installable and lets the
 * static assets load offline. API/WS/file requests stay outside the app-shell cache;
 * their own response headers decide whether the browser may reuse them.
 */
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `chungushub-${version}`;
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => sw.skipWaiting()));
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
	// Never put live data or user files in the app-shell cache. A stored image's own immutable,
	// private HTTP cache policy may still let the browser reuse it without a network trip.
	if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname === '/ws') {
		return;
	}

	// Cache-first for precached build assets; network-first for everything else.
	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(
			caches.match(request).then((cached) => cached ?? fetch(request))
		);
		return;
	}

	event.respondWith(
		fetch(request).catch(() => caches.match(request).then((cached) => cached ?? caches.match('/')) as Promise<Response>)
	);
});
