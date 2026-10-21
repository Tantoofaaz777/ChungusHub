import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from 'node:zlib';
import { serveStaticAsset } from './static';

let root: string;
const source = 'export const message = "hello";\n'.repeat(200);
const html = { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'", 'x-content-type-options': 'nosniff' };
const asset = '/_app/immutable/panel.js';
function serve(path = asset, headers: Record<string, string> = {}, method = 'GET') {
	return serveStaticAsset(root, path, new Request(`http://localhost${path}`, { headers, method }), html);
}

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), 'chungus-static-'));
	mkdirSync(join(root, '_app', 'immutable'), { recursive: true });
	writeFileSync(join(root, 'index.html'), '<!doctype html><title>App</title>');
	const path = join(root, asset);
	writeFileSync(path, source);
	writeFileSync(path + '.gz', gzipSync(source));
	writeFileSync(path + '.br', brotliCompressSync(source));
});
afterAll(() => {
	const absolute = resolve(root);
	if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.split(sep).at(-1)?.startsWith('chungus-static-')) throw new Error('Invalid scratch directory');
	rmSync(absolute, { recursive: true, force: true });
});

test('Brotli and gzip serve the original JavaScript with the correct wire length and immutable cache policy', async () => {
	for (const [accept, encoding, decode] of [
		['gzip, br', 'br', brotliDecompressSync], ['gzip', 'gzip', gunzipSync]
	] as const) {
		const response = serve(asset, { 'accept-encoding': accept });
		const bytes = Buffer.from(await response.arrayBuffer());
		expect(response.status).toBe(200);
		expect(response.headers.get('content-encoding')).toBe(encoding);
		expect(response.headers.get('content-type')).toBe('text/javascript');
		expect(response.headers.get('content-length')).toBe(String(bytes.length));
		expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(response.headers.get('vary')).toBe('Accept-Encoding');
		expect(decode(bytes).toString()).toBe(source);
	}
});

test('negotiation respects quality, identity, wildcard and explicit exclusions', () => {
	for (const [accept, expected] of [
		['br;q=0, gzip', 'gzip'], ['br;q=.4, gzip;q=.8, identity;q=0', 'gzip'],
		['br;q=0, *;q=1', 'gzip'], ['gzip;q=.4, identity;q=1', null],
		['unknown', null], ['', null]
	] as const) expect(serve(asset, { 'accept-encoding': accept }).headers.get('content-encoding')).toBe(expected);
	expect(serve(asset, { 'accept-encoding': '*;q=0' }).status).toBe(406);
});

test('conditional requests use encoding-specific validators and HEAD carries no body', async () => {
	const response = serve(asset, { 'accept-encoding': 'br' });
	const etag = response.headers.get('etag')!;
	expect(serve(asset, { 'accept-encoding': 'br', 'if-none-match': `"other", ${etag}` }).status).toBe(304);
	expect(serve(asset, { 'accept-encoding': 'gzip', 'if-none-match': etag }).status).toBe(200);
	const head = serve(asset, { 'accept-encoding': 'br' }, 'HEAD');
	expect(head.headers.get('content-length')).toBe(response.headers.get('content-length'));
	expect(head.headers.get('content-encoding')).toBe('br');
	expect(await head.text()).toBe('');
});

test('SPA fallback preserves HTML security headers and revalidates while missing chunks stay 404', async () => {
	const response = serve('/chat/example');
	expect(response.headers.get('content-security-policy')).toBe(html['content-security-policy']);
	expect(response.headers.get('cache-control')).toBe('no-cache');
	expect(await response.text()).toContain('<title>App</title>');
	expect(serve('/').status).toBe(200);
	expect(serve('/_app/immutable/missing.js').status).toBe(404);
	expect(serve('/missing.css').status).toBe(404);
	expect(serve(asset, {}, 'POST').status).toBe(405);
});

test('direct sidecars, malformed paths and traversal never expose files', () => {
	for (const path of [asset + '.br', asset + '.gz', '/%2e%2e/package.json', '/..\\package.json']) expect(serve(path).status).toBe(404);
	expect(serve('/%zz').status).toBe(400);
});

test('stale precompression falls back to original bytes; ranges never receive a compressed representation', async () => {
	const path = join(root, 'fresh.js');
	writeFileSync(path, source);
	writeFileSync(path + '.br', brotliCompressSync('old'));
	utimesSync(path + '.br', 1, 1);
	const response = serve('/fresh.js', { 'accept-encoding': 'br' });
	expect(response.headers.get('content-encoding')).toBeNull();
	expect(await response.text()).toBe(source);
	expect(serve(asset, { 'accept-encoding': 'br', range: 'bytes=0-10' }).headers.get('content-encoding')).toBeNull();
});
