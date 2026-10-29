import { describe, expect, test } from 'bun:test';
import { embedPresetInPng, readPresetFromPng, PRESET_CHUNK_KEYWORD } from './presetCard';
import { buildTextChunk, encodeBase64Utf8 } from './pngText';
import type { PromptPreset } from '#lib/types/database.ts';

/** Minimal structurally-valid PNG (bogus CRCs, since neither writer nor reader validates them). */
function minimalPng(extraChunks: Uint8Array[] = []): Uint8Array {
	const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const chunk = (type: string, data: Uint8Array): Uint8Array => {
		const out = new Uint8Array(12 + data.length);
		new DataView(out.buffer).setUint32(0, data.length);
		for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
		out.set(data, 8);
		return out;
	};
	const parts = [sig, chunk('IHDR', new Uint8Array(13)), ...extraChunks, chunk('IEND', new Uint8Array(0))];
	const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
	let pos = 0;
	for (const p of parts) {
		png.set(p, pos);
		pos += p.length;
	}
	return png;
}

const preset: PromptPreset = {
	id: 'source',
	name: 'Kaçış',
	meta: { author: 'someone', version: '2.1', cover: 'images/presets/local.png' },
	items: [{ id: 'runtime-only', name: 'System', role: 'system', content: '{{tone}}', enabled: true }],
	controls: [
		{
			id: 'tone-control',
			macro: 'tone',
			label: 'Tone',
			advice: 'recommended',
			type: 'select',
			options: [{ id: 'warm', label: 'Warm', injectedText: 'Write warmly.', description: 'Softer, slower.' }],
			defaultOptionId: 'warm'
		}
	],
	sections: [{ id: 'voice', title: 'Voice', description: 'How it sounds.', collapsed: true }],
	bundles: [{ id: 'kit-1', name: 'Slow burn', values: { tone: 'warm' } }],
	regexRules: [
		{
			id: 'panel-skin',
			name: 'Panel skin',
			description: '',
			enabled: true,
			pattern: '<details>',
			flags: 'g',
			replacement: '<details style="color:#3fa7c4">',
			targets: ['assistant'],
			scopes: ['display']
		}
	],
	pruneEmptyBlocks: true
};

describe('preset cards', () => {
	test('legacy PNG cards load without item notes and new cards omit them', () => {
		const legacy = { ...preset, items: preset.items.map(item => ({ ...item, note: 'Old annotation' })) };
		const oldCard = minimalPng([buildTextChunk(PRESET_CHUNK_KEYWORD, encodeBase64Utf8(JSON.stringify(legacy)))]);
		const imported = readPresetFromPng(oldCard)!;
		expect(imported.items[0].content).toBe('{{tone}}');
		expect('note' in imported.items[0]).toBe(false);
		const newCard = embedPresetInPng(minimalPng(), legacy);
		expect(newCard).toEqual(embedPresetInPng(minimalPng(), preset));
	});

	test('a preset survives the trip through a picture', () => {
		const card = embedPresetInPng(minimalPng(), preset);
		const back = readPresetFromPng(card);

		expect(back?.name).toBe('Kaçış');
		expect(back?.meta?.author).toBe('someone');
		expect(back?.meta?.version).toBe('2.1');
		expect(back?.items[0].content).toBe('{{tone}}');
		expect(back?.controls[0].advice).toBe('recommended');
		expect(back?.controls[0].options?.[0].description).toBe('Softer, slower.');
		expect(back?.sections).toEqual([
			{ id: 'voice', title: 'Voice', description: 'How it sounds.', icon: undefined, collapsed: true }
		]);
		expect(back?.bundles?.[0]).toEqual({ id: 'kit-1', name: 'Slow burn', description: undefined, values: { tone: 'warm' } });
		expect(back?.regexRules?.[0].id).toBe('panel-skin');
		expect(back?.pruneEmptyBlocks).toBe(true);
	});

	test('the cover path stays home: the picture itself is the cover', () => {
		const back = readPresetFromPng(embedPresetInPng(minimalPng(), preset));
		expect(back?.meta && 'cover' in back.meta).toBe(false);
	});

	test('re-exporting replaces the old preset instead of sitting beside it', () => {
		const stale = buildTextChunk(PRESET_CHUNK_KEYWORD, encodeBase64Utf8('{"name":"Older","items":[]}'));
		const card = embedPresetInPng(minimalPng([stale]), preset);

		const keyword = new TextEncoder().encode(PRESET_CHUNK_KEYWORD);
		let found = 0;
		outer: for (let i = 0; i <= card.length - keyword.length; i++) {
			for (let j = 0; j < keyword.length; j++) if (card[i + j] !== keyword[j]) continue outer;
			found++;
		}
		expect(found).toBe(1);
		expect(readPresetFromPng(card)?.name).toBe('Kaçış');
	});

	test('an ordinary picture is not a preset card, and a non-picture is not a file we read', () => {
		expect(readPresetFromPng(minimalPng())).toBeNull();
		expect(() => readPresetFromPng(new TextEncoder().encode('{"name":"nope"}'))).toThrow();
	});

	test('a preset card is not mistaken for a character card', () => {
		const card = embedPresetInPng(minimalPng(), preset);
		expect(new TextDecoder('latin1').decode(card).includes('chara\0')).toBe(false);
	});
});
