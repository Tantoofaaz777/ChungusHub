import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// Run the real worker's handlers with isolated caches and an offline-switchable network.
const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
	readFileSync(new URL('./service-worker.ts', import.meta.url), 'utf8')
		.replace(/^import .* from '\$app\/(?:env|manifest|service-worker)';\r?$/gm, '')
);
function worker(manifest: unknown = ['/_app/immutable/home.js']) {
	const handlers: Record<string, (event: any) => void> = {};
	const storage = new Map<string, Response>();
	const precached: string[] = [];
	const calls: string[] = [];
	let offline = false;
	let status = 200;
	let claimed = false;
	let skipped = false;
	const key = (request: string | Request) => typeof request === 'string' ? request : new URL(request.url).pathname;
	const cache = {
		async addAll(paths: string[]) { precached.push(...paths); for (const path of paths) storage.set(path, new Response(path)); },
		async match(request: string | Request) { return storage.get(key(request))?.clone(); },
		async put(request: string | Request, response: Response) { storage.set(key(request), response); }
	};
	const removed: string[] = [];
	new Function('sw', 'caches', 'fetch', 'immutable', 'assets', 'version', source)(
		{ location: { origin: 'http://localhost' }, addEventListener: (name: string, handler: any) => { handlers[name] = handler; },
			skipWaiting: async () => { skipped = true; }, clients: { claim: async () => { claimed = true; } } },
		{ open: async () => cache, keys: async () => ['chungushub-old', 'chungushub-new'], delete: async (name: string) => { removed.push(name); } },
		async (request: string | Request) => {
			const path = key(request); calls.push(path);
			if (offline) throw new Error('Offline');
			return path === '/_app/boot-assets.json' ? Response.json(manifest) : new Response('network:' + path, { status });
		}, ['_app/immutable/home.js', '_app/immutable/panel.js'].map(path => ({ path })),
		['icon.svg', 'fonts/manrope.css', 'fonts/manrope-latin-400.woff2', 'fonts/poppins.css', 'fonts/poppins-latin-400.woff2'].map(path => ({ path })), 'new'
	);
	async function dispatch(name: string, request?: Request, data?: unknown) {
		const waits: Promise<unknown>[] = [];
		let response: Promise<Response> | undefined;
		handlers[name]({ request, data, waitUntil: (promise: Promise<unknown>) => waits.push(promise), respondWith: (promise: Promise<Response>) => { response = promise; } });
		const result = response ? await response : undefined;
		await Promise.all(waits);
		return result;
	}
	return { dispatch, precached, calls, removed, storage, offline: () => { offline = true; }, fail: () => { status = 404; },
		get claimed() { return claimed; }, get skipped() { return skipped; } };
}

test('worker precaches the offline shell, leaves unopened panels out and retires old versions', async () => {
	const sw = worker();
	await sw.dispatch('install');
	expect(sw.precached).toContain('/');
	expect(sw.precached).toContain('/_app/immutable/home.js');
	expect(sw.precached).toContain('/icon.svg');
	expect(sw.precached).not.toContain('/_app/immutable/panel.js');
	expect(sw.precached.filter(path => path.startsWith('/fonts/'))).toEqual([]);
	expect(sw.skipped).toBe(true);
	await sw.dispatch('activate');
	expect(sw.removed).toEqual(['chungushub-old']);
	expect(sw.claimed).toBe(true);
});

test('a visited panel works offline after its first download without refetching', async () => {
	const sw = worker();
	const request = new Request('http://localhost/_app/immutable/panel.js');
	expect(await (await sw.dispatch('fetch', request))!.text()).toBe('network:/_app/immutable/panel.js');
	sw.offline();
	expect(await (await sw.dispatch('fetch', request))!.text()).toBe('network:/_app/immutable/panel.js');
	expect(sw.calls).toEqual(['/_app/immutable/panel.js']);
});

test('failed panels are not cached and live data, user files and other origins bypass the worker', async () => {
	const sw = worker();
	sw.fail();
	expect((await sw.dispatch('fetch', new Request('http://localhost/_app/immutable/panel.js')))!.status).toBe(404);
	expect(sw.storage.has('/_app/immutable/panel.js')).toBe(false);
	for (const url of ['http://localhost/api/db', 'http://localhost/files/picture.png', 'http://localhost/ws', 'https://elsewhere.test/_app/immutable/panel.js']) {
		expect(await sw.dispatch('fetch', new Request(url))).toBeUndefined();
	}
	expect(await sw.dispatch('fetch', new Request('http://localhost/_app/immutable/panel.js', { method: 'POST' }))).toBeUndefined();
});

test('offline navigation uses the installed shell, and a bad manifest cannot activate', async () => {
	const sw = worker();
	await sw.dispatch('install');
	sw.offline();
	expect(await (await sw.dispatch('fetch', new Request('http://localhost/chat/123')))!.text()).toBe('/');
	const broken = worker(['/missing-build.js']);
	await expect(broken.dispatch('install')).rejects.toThrow('Invalid offline boot manifest');
	expect(broken.skipped).toBe(false);
});

test('first-paint fonts can join the offline cache after control without prefetching unused families', async () => {
	const sw = worker();
	await sw.dispatch('install');
	const data = { type: 'cache-fonts', paths: ['/fonts/manrope.css', '/fonts/manrope-latin-400.woff2', '/fonts/manrope.css', '/api/private', '/fonts/missing.woff2', 'https://elsewhere.test/fonts/poppins.css'] };
	await sw.dispatch('message', undefined, data);
	expect(sw.calls).toEqual(['/_app/boot-assets.json', '/fonts/manrope.css', '/fonts/manrope-latin-400.woff2']);
	await sw.dispatch('message', undefined, data);
	expect(sw.calls).toHaveLength(3);
	expect(sw.storage.has('/fonts/poppins.css')).toBe(false);
	sw.offline();
	expect(await (await sw.dispatch('fetch', new Request('http://localhost/fonts/manrope-latin-400.woff2')))!.text()).toBe('network:/fonts/manrope-latin-400.woff2');
});

test('selected fonts cache on demand; malformed warm-ups and unsuccessful font responses store nothing', async () => {
	const sw = worker();
	for (const data of [null, { type: 'cache-fonts', paths: 'all' }, { type: 'other', paths: ['/fonts/poppins.css'] }]) await sw.dispatch('message', undefined, data);
	expect(sw.calls).toEqual([]);
	await sw.dispatch('fetch', new Request('http://localhost/fonts/poppins.css'));
	expect(sw.storage.has('/fonts/poppins.css')).toBe(true);
	sw.fail();
	await sw.dispatch('message', undefined, { type: 'cache-fonts', paths: ['/fonts/manrope.css'] });
	expect(sw.storage.has('/fonts/manrope.css')).toBe(false);
});
