import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CustomFont, FontCategory } from '../shared/fonts';

const CATEGORIES: Record<string, FontCategory> = {
	SERIF: 'serif', SANS_SERIF: 'sans', MONOSPACE: 'mono', DISPLAY: 'display', HANDWRITING: 'handwriting'
};
const ID = /^google-[a-f0-9]{24}$/;
const ASSET = /^(?:font\.css|[a-f0-9]{64}\.woff2)$/;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAX_TOTAL = 64 * 1024 * 1024;

export function fontName(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Enter the family name as it appears on Google Fonts.');
	const name = value.trim().replace(/\s+/g, ' ');
	if (!/^[a-zA-Z0-9][a-zA-Z0-9 '\-]{0,99}$/.test(name)) {
		throw new Error('Enter the family name as it appears on Google Fonts, not a URL.');
	}
	return name;
}

/** Only request styles the family actually offers, including single-weight families. */
export function fontMetadata(text: string, requested: string) {
	const family = /^name: "([^"\n]+)"/m.exec(text)?.[1];
	if (!family || family.toLowerCase() !== requested.toLowerCase()) throw new Error('Font family not found on Google Fonts. Check its name.');
	const category = CATEGORIES[/^category: "([A-Z_]+)"/m.exec(text)?.[1] ?? ''];
	if (!category) throw new Error('This font does not provide a supported category.');
	const blocks = [...text.matchAll(/^fonts \{([^}]+)\}/gm)].map(m => m[1]);
	const axis = [...text.matchAll(/^axes \{([^}]+)\}/gm)].map(m => m[1]).find(b => /tag: "wght"/.test(b));
	const min = axis ? Number(/min_value: ([\d.]+)/.exec(axis)?.[1]) : NaN;
	const max = axis ? Number(/max_value: ([\d.]+)/.exec(axis)?.[1]) : NaN;
	const styles: string[] = [];
	for (const [style, italic] of [['normal', 0], ['italic', 1]] as const) {
		const weights = blocks.filter(b => b.includes(`style: "${style}"`)).map(b => Number(/weight: (\d+)/.exec(b)?.[1])).filter(Number.isFinite);
		if (!weights.length) continue;
		const desired = [400, 700].map(w => Number.isFinite(min) && Number.isFinite(max)
			? Math.min(max, Math.max(min, w))
			: weights.reduce((best, v) => Math.abs(v - w) < Math.abs(best - w) ? v : best));
		for (const weight of [...new Set(desired)].sort((a, b) => a - b)) styles.push(`${italic},${weight}`);
	}
	if (!styles.length) throw new Error('No supported font styles were found.');
	return { family, category, styles };
}

/** Generates CSS rather than forwarding a remote stylesheet into the application. */
export function fontFaces(css: string) {
	const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(match => {
		const body = match[1];
		const property = (name: string) => new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`).exec(body)?.[1]?.trim();
		const src = /^url\((https:\/\/fonts\.gstatic\.com\/[^\s()'"\\]+)\) format\(['"]woff2['"]\)$/.exec(property('src') ?? '')?.[1];
		const style = property('font-style');
		const weight = property('font-weight');
		const range = property('unicode-range');
		if (!src || !/^(normal|italic)$/.test(style ?? '') || !/^\d{1,4}(?: \d{1,4})?$/.test(weight ?? '') ||
			(range !== undefined && !/^U\+[0-9A-F?\-]+(?:,\s*U\+[0-9A-F?\-]+)*$/i.test(range))) {
			throw new Error('Google Fonts returned an unsupported stylesheet.');
		}
		return { url: src, style: style!, weight: weight!, range };
	});
	if (!faces.length || faces.length > 1024) throw new Error('Google Fonts returned no usable font files.');
	return faces;
}

export class FontLibrary {
	private queue: Promise<unknown> = Promise.resolve();
	constructor(private dataDir: string, private fetcher: typeof fetch = fetch) {}
	private get root() { return join(this.dataDir, 'custom-fonts'); }

	list(): CustomFont[] {
		if (!existsSync(this.root)) return [];
		return readdirSync(this.root).filter(id => ID.test(id)).flatMap(id => {
			try {
				const font = JSON.parse(readFileSync(join(this.root, id, 'family.json'), 'utf8')) as CustomFont;
				if (font.id !== id || fontName(font.family) !== font.family || !Object.values(CATEGORIES).includes(font.category)) return [];
				return [font];
			} catch { return []; }
		}).sort((a, b) => a.family.localeCompare(b.family));
	}

	private serialize<T>(fn: () => Promise<T>): Promise<T> {
		const task = this.queue.then(fn);
		this.queue = task.catch(() => {});
		return task;
	}

	import(value: unknown): Promise<CustomFont> {
		return this.serialize(() => this.download(fontName(value)));
	}

	private async download(requested: string): Promise<CustomFont> {
		const existing = this.list().find(f => f.family.toLowerCase() === requested.toLowerCase());
		if (existing) return existing;
		const deadline = AbortSignal.timeout(120_000);
		let total = 0;
		const get = async (url: string, max: number, optional = false): Promise<Uint8Array | null> => {
			const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(25_000)]), headers: { 'User-Agent': UA } });
			if (optional && response.status === 404) return null;
			if (!response.ok) throw new Error('Could not download this font. Please try again.');
			const reader = response.body?.getReader();
			if (!reader) throw new Error('Google Fonts returned an empty file.');
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					size += value.length; total += value.length;
					if (size > max || total > MAX_TOTAL) throw new Error('This font exceeds the download size limit.');
					chunks.push(value);
				}
			} finally { await reader.cancel().catch(() => {}); }
			return Buffer.concat(chunks);
		};
		const slug = requested.toLowerCase().replace(/[^a-z0-9]/g, '');
		let metadata: ReturnType<typeof fontMetadata> | undefined;
		let source = '';
		for (const license of ['ofl', 'apache', 'ufl']) {
			const base = `https://raw.githubusercontent.com/google/fonts/main/${license}/${slug}`;
			const bytes = await get(`${base}/METADATA.pb`, 1024 * 1024, true);
			if (bytes) { metadata = fontMetadata(new TextDecoder().decode(bytes), requested); source = base; break; }
		}
		if (!metadata) throw new Error('Font family not found on Google Fonts. Check its name.');
		const params = new URLSearchParams({ family: `${metadata.family}:ital,wght@${metadata.styles.join(';')}`, display: 'swap' });
		const css = new TextDecoder().decode((await get(`https://fonts.googleapis.com/css2?${params}`, 2 * 1024 * 1024))!);
		const faces = fontFaces(css);
		const urls = [...new Set(faces.map(face => face.url))];
		if (urls.length > 512) throw new Error('This font contains too many files.');
		const font: CustomFont = { id: `google-${randomBytes(12).toString('hex')}`, family: metadata.family, category: metadata.category };
		const staging = join(this.dataDir, `.font-import-${font.id}`);
		await mkdir(staging, { recursive: true });
		try {
			let license: Uint8Array | null = null;
			for (const file of ['OFL.txt', 'LICENSE.txt', 'UFL.txt']) {
				license = await get(`${source}/${file}`, 1024 * 1024, true);
				if (license) break;
			}
			if (!license) throw new Error('Could not retrieve this font\'s license.');
			await writeFile(join(staging, 'LICENSE.txt'), license);
			const assets = new Map<string, string>();
			let next = 0;
			const results = await Promise.allSettled(Array.from({ length: Math.min(6, urls.length) }, async () => {
				while (next < urls.length) {
					const url = urls[next++];
					const bytes = (await get(url, 8 * 1024 * 1024))!;
					if (Buffer.from(bytes.subarray(0, 4)).toString() !== 'wOF2') throw new Error('Google Fonts returned an invalid font file.');
					const name = `${createHash('sha256').update(bytes).digest('hex')}.woff2`;
					await writeFile(join(staging, name), bytes);
					assets.set(url, name);
				}
			}));
			const failure = results.find(result => result.status === 'rejected');
			if (failure?.status === 'rejected') throw failure.reason;
			const local = faces.map(face => `@font-face { font-family: 'Chungus_${font.id}'; font-style: ${face.style}; font-weight: ${face.weight}; font-display: swap; src: url('/api/fonts/${font.id}/${assets.get(face.url)}') format('woff2');${face.range ? ` unicode-range: ${face.range};` : ''} }`).join('\n');
			await writeFile(join(staging, 'font.css'), local);
			await writeFile(join(staging, 'family.json'), JSON.stringify(font));
			mkdirSync(this.root, { recursive: true });
			await rename(staging, join(this.root, font.id));
			return font;
		} finally { await rm(staging, { recursive: true, force: true }); }
	}

	remove(id: string): Promise<void> {
		if (!ID.test(id)) return Promise.reject(new Error('Invalid font ID.'));
		return this.serialize(() => rm(join(this.root, id), { recursive: true, force: true }));
	}

	asset(id: string, name: string): Response {
		if (!ID.test(id) || !ASSET.test(name)) return new Response('Not found', { status: 404 });
		const file = Bun.file(join(this.root, id, name));
		if (!existsSync(join(this.root, id, name))) return new Response('Not found', { status: 404 });
		return new Response(file, { headers: {
			'Content-Type': name.endsWith('.css') ? 'text/css; charset=utf-8' : 'font/woff2',
			'Cache-Control': 'private, max-age=31536000, immutable',
			'X-Content-Type-Options': 'nosniff'
		} });
	}
}
