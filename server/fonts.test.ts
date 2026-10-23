import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FontLibrary, fontFaces, fontMetadata, fontName } from './fonts';
import { customFontStack } from '../shared/fonts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const metadata = (category = 'SERIF') => `name: "Example Family"
category: "${category}"
fonts { name: "Example Family" style: "normal" weight: 400 }
fonts { name: "Example Family" style: "italic" weight: 400 }
axes { tag: "wght" min_value: 300.0 max_value: 900.0 }`;
const face = (url = 'https://fonts.gstatic.com/s/example/v1/regular.woff2', style = 'normal') => `@font-face {
 font-family: 'Example Family'; font-style: ${style}; font-weight: 400; font-display: swap;
 src: url(${url}) format('woff2'); unicode-range: U+0000-00FF, U+0131;
}`;
function fixture(fetcher?: typeof fetch) {
	const root = mkdtempSync(join(tmpdir(), 'chungus-font-test-')); roots.push(root);
	const calls: string[] = [];
	const mock = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input); calls.push(url);
		expect(init?.redirect).toBe('error');
		if (url.endsWith('METADATA.pb')) return new Response(metadata());
		if (url.endsWith('OFL.txt')) return new Response('Fixture font license');
		if (url.startsWith('https://fonts.googleapis.com/')) return new Response(face() + face(undefined, 'italic'));
		if (url.startsWith('https://fonts.gstatic.com/')) return new Response(new Uint8Array(Buffer.from('wOF2example')));
		throw new Error(`Unexpected URL: ${url}`);
	}) as typeof fetch;
	return { root, calls, library: new FontLibrary(root, fetcher ?? mock), mock };
}

describe('Google Fonts import', () => {
	test('accepts family names, normalizes whitespace and rejects URLs and CSS', () => {
		expect(fontName('  Example   Family  ')).toBe('Example Family');
		for (const input of ['', null, 42, 'https://fonts.google.com/', 'A; color:red', '../Test', 'A'.repeat(101)]) {
			expect(() => fontName(input)).toThrow();
		}
	});

	for (const [category, expected] of [['SERIF', 'serif'], ['SANS_SERIF', 'sans'], ['MONOSPACE', 'mono'], ['DISPLAY', 'display'], ['HANDWRITING', 'handwriting']]) {
		test(`reads ${category} from official metadata`, () => {
			expect(fontMetadata(metadata(category), 'example family').category).toBe(expected);
		});
	}

	test('requests regular, bold and italic only where supported', () => {
		expect(fontMetadata(metadata(), 'Example Family').styles).toEqual(['0,400', '0,700', '1,400', '1,700']);
		const single = 'name: "Example Family"\ncategory: "DISPLAY"\nfonts { style: "normal" weight: 500 }';
		expect(fontMetadata(single, 'Example Family').styles).toEqual(['0,500']);
		expect(() => fontMetadata(metadata(), 'Other Font')).toThrow('not found');
	});

	test('rejects foreign URLs and CSS injection instead of forwarding remote CSS', () => {
		expect(fontFaces(face())[0].range).toBe('U+0000-00FF, U+0131');
		for (const url of ['http://127.0.0.1/private', 'https://fonts.gstatic.com.evil.test/font.woff2', 'https://evil.test/font.woff2']) {
			expect(() => fontFaces(face(url))).toThrow();
		}
		expect(() => fontFaces(face().replace('font-weight: 400', 'font-weight: expression(x)'))).toThrow();
	});

	test('stores local CSS, WOFF2 and license, deduplicates simultaneous imports and survives a restart', async () => {
		const { root, calls, library } = fixture();
		const [font, duplicate] = await Promise.all([library.import('Example Family'), library.import('example family')]);
		expect(duplicate).toEqual(font);
		expect(calls.filter(url => url.startsWith('https://fonts.gstatic.com/')).length).toBe(1);
		const css = readFileSync(join(root, 'custom-fonts', font.id, 'font.css'), 'utf8');
		expect(css).not.toContain('googleapis');
		expect(css).not.toContain('gstatic');
		expect(css).toContain(`/api/fonts/${font.id}/`);
		expect(css).toContain(`Chungus_${font.id}`);
		expect(readFileSync(join(root, 'custom-fonts', font.id, 'LICENSE.txt'), 'utf8')).toContain('license');
		expect(new FontLibrary(root).list()).toEqual([font]);
		expect(customFontStack({ ...font, category: 'mono' })).toEndWith('monospace');
		const response = library.asset(font.id, 'font.css');
		expect(response.headers.get('Content-Type')).toContain('text/css');
		expect(response.headers.get('Cache-Control')).toContain('immutable');
		for (const id of ['..', 'google-invalid', '../security.json']) expect(library.asset(id, 'font.css').status).toBe(404);
		expect(library.asset(font.id, 'family.json').status).toBe(404);
		await library.remove(font.id);
		expect(library.list()).toEqual([]);
		expect(library.asset(font.id, 'font.css').status).toBe(404);
	});

	test('waits for all downloads before cleaning a failed import, then allows retry', async () => {
		let fail = true;
		const base = fixture();
		const library = new FontLibrary(base.root, (async (input, init) => {
			const url = String(input);
			if (url.startsWith('https://fonts.googleapis.com/')) return new Response(face() + face('https://fonts.gstatic.com/s/example/v1/slow.woff2'));
			if (url.endsWith('regular.woff2') && fail) return new Response('failed', { status: 503 });
			if (url.endsWith('slow.woff2')) { await new Promise(resolve => setTimeout(resolve, 20)); return new Response(new Uint8Array(Buffer.from('wOF2slow'))); }
			return base.mock(input, init);
		}) as typeof fetch);
		await expect(library.import('Example Family')).rejects.toThrow();
		expect(library.list()).toEqual([]);
		expect(readdirSync(base.root)).toEqual([]);
		fail = false;
		await library.import('Example Family');
		expect(library.list()).toHaveLength(1);
	});

	test('missing families and invalid font files leave no catalog entry', async () => {
		const base = fixture();
		const missing = new FontLibrary(base.root, (async () => new Response('', { status: 404 })) as typeof fetch);
		await expect(missing.import('Unknown Family')).rejects.toThrow('not found');
		const invalid = new FontLibrary(base.root, (async (input, init) => String(input).startsWith('https://fonts.gstatic.com/')
			? new Response('not a font') : base.mock(input, init)) as typeof fetch);
		await expect(invalid.import('Example Family')).rejects.toThrow('invalid font');
		expect(readdirSync(base.root)).toEqual([]);
	});
});
