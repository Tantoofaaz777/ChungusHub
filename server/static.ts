import { existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
	'.json': 'application/json', '.webmanifest': 'application/manifest+json',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg',
	'.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
	'.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

/** Explicit exclusions beat wildcards. An omitted header asks for the original file. */
function encodingQuality(header: string | null): (encoding: string) => number {
	const values = new Map<string, number>();
	for (const part of (header ?? '').split(',')) {
		const [name, ...parameters] = part.trim().toLowerCase().split(';');
		if (!name) continue;
		const q = parameters.map((p) => p.trim()).find((p) => p.startsWith('q='));
		const value = q ? Number(q.slice(2)) : 1;
		values.set(name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
	}
	return (encoding) => values.get(encoding) ?? (encoding === 'identity'
		? (values.get('*') === 0 ? 0 : 1) : values.get('*') ?? 0);
}

/** Static app files only: the caller has already applied the server's access gates. */
export function serveStaticAsset(root: string, pathname: string, request: Request, htmlHeaders: Record<string, string>): Response {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
	}
	let decoded: string;
	try { decoded = decodeURIComponent(pathname); } catch { return new Response('Invalid path', { status: 400 }); }
	const directory = resolve(root);
	let filePath = resolve(directory, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
	if ((filePath !== directory && !filePath.startsWith(directory + sep)) || decoded.split(/[\\/]/).includes('..') || /\.(?:br|gz)$/i.test(filePath)) {
		return new Response('Not found', { status: 404 });
	}
	if (!existsSync(filePath) || !statSync(filePath).isFile()) {
		// An absent chunk is an HTTP error, never HTML cached under a JavaScript URL.
		if (decoded.startsWith('/_app/') || extname(decoded)) return new Response('Not found', { status: 404 });
		filePath = resolve(directory, 'index.html');
		if (!existsSync(filePath)) return new Response('Client not built. Run: bun run build', { status: 500 });
	}
	const original = statSync(filePath);
	const quality = encodingQuality(request.headers.get('accept-encoding'));
	const candidates = (request.headers.has('range') ? ['identity'] : ['br', 'gzip', 'identity'])
		.filter((encoding) => quality(encoding) > 0)
		.sort((a, b) => quality(b) - quality(a));
	let encoding: string | null = null;
	let servedPath = filePath;
	for (const candidate of candidates) {
		if (candidate === 'identity') break;
		const sidecar = `${filePath}.${candidate === 'gzip' ? 'gz' : 'br'}`;
		if (existsSync(sidecar) && statSync(sidecar).isFile() && statSync(sidecar).mtimeMs >= original.mtimeMs) {
			encoding = candidate;
			servedPath = sidecar;
			break;
		}
	}
	if (!encoding && quality('identity') === 0) return new Response('No acceptable encoding', { status: 406 });
	const info = statSync(servedPath);
	const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
	const headers = new Headers(type === 'text/html' ? htmlHeaders : { 'content-type': type, 'x-content-type-options': 'nosniff' });
	headers.set('vary', 'Accept-Encoding');
	headers.set('cache-control', decoded.startsWith('/_app/immutable/') ? 'public, max-age=31536000, immutable' : 'no-cache');
	const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}-${encoding ?? 'identity'}"`;
	headers.set('etag', etag);
	if (encoding) headers.set('content-encoding', encoding);
	if ((request.headers.get('if-none-match') ?? '').split(',').some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))) {
		return new Response(null, { status: 304, headers });
	}
	headers.set('content-length', String(info.size));
	return new Response(request.method === 'HEAD' ? null : Bun.file(servedPath), { headers });
}
