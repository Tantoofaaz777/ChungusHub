import { describe, expect, test } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import type { CharacterCardV3 } from '$lib/types/character-card';
import type { LibraryEntry } from '$lib/types/library';
import { buildCharacterCardV3, buildCharx, embedCardInPng } from './sillyTavernExport';
import { importSillyTavernCard } from './sillyTavernImport';
import { buildTextChunk, insertTextChunk, encodeBase64Utf8, readTextChunk } from './pngText';
import { bytesDataUrl, dataUrlBytes, readCharx } from './charx';
import { createZip } from './zip';
import { crc32 } from './crc32';
import { localizedCreatorNotes } from './characterCard';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=', 'base64'));
// Generated one-pixel JPEG: independent of any user-supplied character artwork.
const JPEG = new Uint8Array(Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCrRRRXvngn/9k=', 'base64'));
function fixture(): CharacterCardV3 {
	return { spec: 'chara_card_v3', spec_version: '3.0', data: {
		name: 'Álice 🐇', nickname: 'Ali', description: '{{CHAR}} lives here.', personality: 'curious', scenario: 'Wonderland',
		first_mes: 'Hello {{user}}', mes_example: '', creator: 'Writer', creator_notes: 'Original', system_prompt: '',
		post_history_instructions: '', character_version: '3', tags: ['test'], alternate_greetings: ['Hi'], group_only_greetings: ['Hello everyone'],
		extensions: { custom: { retained: true } }, creator_notes_multilingual: { en: 'Notes', pt: 'Anotações' },
		source: ['https://example.com/card', 'creator-id'], creation_date: 1234, modification_date: 2345,
		assets: [{ type: 'icon', name: 'main', ext: 'png', uri: bytesDataUrl(PNG, 'image/png') },
			{ type: 'audio', name: 'theme', ext: 'wav', uri: bytesDataUrl(new Uint8Array([0, 255, 13, 10]), 'audio/wav') }],
		character_book: { name: 'World', entries: [{ keys: ['rabbit'], content: '@@depth 1\nWhite rabbit', enabled: true, use_regex: false, insertion_order: 0 }] },
		future_field: { retained: [1, 'two'] }
	} };
}
async function imported(card = fixture()) { return importSillyTavernCard(new File([JSON.stringify(card)], 'card.json')); }
function entryFrom(result: Awaited<ReturnType<typeof imported>>): LibraryEntry {
	const c = result.character;
	return { id: 'test', type: 'character', identity: { name: c.name, alias: c.alias, imageUrl: 'characters/test.png', tags: c.tags },
		data: { traits: c.traits, alternateGreetings: c.alternateGreetings, cardMetadata: c.cardMetadata }, isFavorite: false, createdAt: 0, updatedAt: 0 };
}

describe('Character Card V3 interchange', () => {
	test('JSON preserves every V3 field, unknown extensions, Unicode and arbitrary asset bytes on re-export', async () => {
		const result = await imported();
		const entry = entryFrom(result);
		const card = buildCharacterCardV3(entry, [], 'all');
		expect(card.data.nickname).toBe('Ali');
		expect(card.data.creator_notes_multilingual).toEqual(fixture().data.creator_notes_multilingual);
		expect(card.data.source).toEqual(fixture().data.source);
		expect(card.data.group_only_greetings).toEqual(['Hello everyone']);
		expect(card.data.creation_date).toBe(1234);
		expect(card.data.future_field).toEqual({ retained: [1, 'two'] });
		expect(card.data.extensions.custom).toEqual({ retained: true });
		expect(dataUrlBytes(card.data.assets![1].uri)?.bytes).toEqual(new Uint8Array([0, 255, 13, 10]));
		const twice = await imported(card);
		expect(twice.character.cardMetadata?.extensions.chungushub).toBeUndefined();
		expect(twice.character.alias).toBe('Ali');
		expect(twice.lorebook?.entries[0].cardV3?.useRegex).toBe(false);
	});
	test('emotion and gallery assets stay portable without native image materialization', async () => {
		const card = fixture();
		for (const type of ['emotion', 'x_gallery', 'background']) {
			card.data.assets!.push({ type, name: 'main', ext: 'png', uri: bytesDataUrl(PNG, 'image/png') });
		}
		const result = await imported(card);
		expect(result.warnings).toEqual([]);
		expect(result.assetImages?.map(({ asset }) => asset.type)).toEqual(['background']);
		const exported = buildCharacterCardV3(entryFrom(result), [], 'all');
		for (const type of ['emotion', 'x_gallery']) {
			expect(dataUrlBytes(exported.data.assets!.find((asset) => asset.type === type)!.uri)?.bytes).toEqual(PNG);
		}
		const again = await importSillyTavernCard(new File([buildCharx(exported)], 'preserved.charx'));
		expect(again.assetImages?.map(({ asset }) => asset.type)).toEqual(['background']);
		expect(again.character.cardMetadata!.assets!.map((asset) => ({
			type: asset.type, name: asset.name, ext: asset.ext, bytes: dataUrlBytes(asset.uri)?.bytes
		}))).toEqual(exported.data.assets!.map((asset) => ({
			type: asset.type, name: asset.name, ext: asset.ext, bytes: dataUrlBytes(asset.uri)?.bytes
		})));
	});
	test.each(['png', 'apng'])('%s uses ccv3 in preference to a conflicting V2 chara chunk', async (extension) => {
		const png = embedCardInPng(PNG, fixture());
		const conflicting = insertTextChunk(png, buildTextChunk('chara', encodeBase64Utf8(JSON.stringify({ name: 'Wrong V2' }))), []);
		const result = await importSillyTavernCard(new File([conflicting as BlobPart], `card.${extension}`));
		expect(result.character.name).toBe('Álice 🐇');
		expect(result.character.cardMetadata?.version).toBe(3);
		expect(readTextChunk(png, 'ccv3')).not.toBeNull();
		expect(readTextChunk(new Uint8Array(await result.imageFile!.arrayBuffer()), 'ccv3')).toBeNull();
	});
	test('CHARX embeds assets under portable paths and reimports byte for byte', async () => {
		const file = new File([buildCharx(fixture())], 'card.charx');
		const files = await readCharx(file);
		expect(files.has('card.json')).toBe(true);
		expect(files.get('assets/audio/audio/1.wav')).toEqual(new Uint8Array([0, 255, 13, 10]));
		const result = await importSillyTavernCard(file);
		expect(result.warnings).toEqual([]);
		expect(dataUrlBytes(result.character.cardMetadata!.assets![1].uri)?.bytes).toEqual(new Uint8Array([0, 255, 13, 10]));
		expect(result.imageFile?.type).toBe('image/png');
	});
	test.each(['image', 'images'])('CHARX finds a main JFIF portrait in %s without an asset manifest', async (folder) => {
		const card = fixture(); delete card.data.assets;
		const file = new File([createZip([
			{ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(card)) },
			{ name: `assets/icon/${folder}/main.jfif`, data: JPEG }
		])], 'portrait.charx');
		const result = await importSillyTavernCard(file);
		expect(result.warnings).toEqual([]);
		expect(result.imageFile?.type).toBe('image/jpeg');
		expect(new Uint8Array(await result.imageFile!.arrayBuffer())).toEqual(JPEG);
		const exported = buildCharacterCardV3(entryFrom(result), [], 'all');
		const icon = exported.data.assets!.find((asset) => asset.type === 'icon' && asset.name === 'main')!;
		expect(icon.ext).toBe('jfif');
		expect(dataUrlBytes(icon.uri)?.bytes).toEqual(JPEG);
		const again = await importSillyTavernCard(new File([buildCharx(exported)], 'again.charx'));
		expect(again.imageFile?.type).toBe('image/jpeg');
	});
	test.each([{ assets: [] }, { assets: [{ type: 'icon', name: 'main', uri: 'ccdefault:', ext: 'png' }] }])('CHARX resolves empty or default assets against its main portrait', async ({ assets }) => {
		const card = fixture(); card.data.assets = assets;
		const result = await importSillyTavernCard(new File([createZip([
			{ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(card)) },
			{ name: 'assets/icon/images/main.png', data: PNG }
		])], 'default.charx'));
		expect(result.imageFile?.type).toBe('image/png');
		expect(new Uint8Array(await result.imageFile!.arrayBuffer())).toEqual(PNG);
	});
	test('an explicit main icon takes precedence over the conventional archive portrait', async () => {
		const result = await importSillyTavernCard(new File([createZip([
			{ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(fixture())) },
			{ name: 'assets/icon/image/main.jfif', data: JPEG }
		])], 'explicit.charx'));
		expect(result.imageFile?.type).toBe('image/png');
		expect(new Uint8Array(await result.imageFile!.arrayBuffer())).toEqual(PNG);
	});
	test('a missing main portrait does not pick unrelated background images', async () => {
		const card = fixture(); delete card.data.assets;
		const result = await importSillyTavernCard(new File([createZip([
			{ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(card)) },
			{ name: 'assets/background/image/main.jfif', data: JPEG }
		])], 'no-portrait.charx'));
		expect(result.imageFile).toBeNull();
	});
	test('embedded PNG asset chunks load without being carried into the portrait', async () => {
		const card = fixture(); card.data.assets![1].uri = '__asset:assets/audio/theme.wav';
		const png = insertTextChunk(embedCardInPng(PNG, card), buildTextChunk('chara-ext-asset_:assets/audio/theme.wav', 'AP8NCg=='), []);
		const result = await importSillyTavernCard(new File([png as BlobPart], 'card.png'));
		expect(result.warnings).toEqual([]);
		expect(dataUrlBytes(result.character.cardMetadata!.assets![1].uri)?.bytes).toEqual(new Uint8Array([0, 255, 13, 10]));
	});
	test('exports linked lorebook edits and respects explicit unlinking', async () => {
		const result = await imported(); const entry = entryFrom(result); const book = result.lorebook!;
		entry.data.lorebookIds = [book.id]; book.entries[0].content = 'Edited lore';
		expect((buildCharacterCardV3(entry, [], 'all', [book]).data.character_book!.entries as { content: string }[])[0].content).toBe('Edited lore');
		entry.data.lorebookIds = [];
		expect(buildCharacterCardV3(entry, [], 'all', [book]).data.character_book).toBeUndefined();
	});
	test('selecting a parked version exports that version’s own metadata', async () => {
		const result = await imported(); const entry = entryFrom(result);
		const data = structuredClone(entry.data); data.cardMetadata!.groupOnlyGreetings = ['Parked'];
		const card = buildCharacterCardV3(entry, [{ id: 'parked', entryId: entry.id, name: 'Parked', data, createdAt: 0, updatedAt: 0 }], 'parked');
		expect(card.data.group_only_greetings).toEqual(['Parked']);
		expect(entry.data.cardMetadata!.groupOnlyGreetings).toEqual(['Hello everyone']);
	});
	test('notes use locale → English → original fallback', () => {
		expect(localizedCreatorNotes({ en: 'English', pt: 'Português' }, 'Original', 'pt-BR')).toBe('Português');
		expect(localizedCreatorNotes({ en: 'English' }, 'Original', 'de')).toBe('English');
		expect(localizedCreatorNotes({}, 'Original', 'de')).toBe('Original');
	});
	test('other-editor surface changes win while parked V3 variants keep their metadata', async () => {
		const result = await imported(); const entry = entryFrom(result); entry.activeVersionId = 'active';
		const parked = structuredClone(entry.data); parked.cardMetadata!.groupOnlyGreetings = ['Parked greeting'];
		parked.cardMetadata!.backgroundPath = 'backgrounds/another-install.png';
		const versions = [{ id: 'active', entryId: entry.id, name: 'Active', data: entry.data, createdAt: 0, updatedAt: 0 },
			{ id: 'parked', entryId: entry.id, name: 'Parked', data: parked, createdAt: 1, updatedAt: 1 }];
		const card = buildCharacterCardV3(entry, versions, 'all'); card.data.description = 'Edited in another app';
		const again = await imported(card);
		expect(again.character.traits.description).toBe('Edited in another app');
		expect(again.versions?.find((version) => version.active)?.data.traits.description).toBe('Edited in another app');
		expect(again.versions?.find((version) => !version.active)?.data.cardMetadata?.groupOnlyGreetings).toEqual(['Parked greeting']);
		expect(again.versions?.find((version) => !version.active)?.data.cardMetadata?.backgroundPath).toBeUndefined();
	});
	test('truncated PNG lengths are rejected before scanning an oversized text payload', async () => {
		const png = new Uint8Array(PNG); new DataView(png.buffer).setUint32(8, 0xffffffff);
		await expect(importSillyTavernCard(new File([png], 'broken.png'))).rejects.toThrow(/Truncated/);
	});
	test.each(['V1', 'V2', 'V3'])('treats a null character_book as absent in %s JSON and PNG cards', async (format) => {
		const data = { name: 'Alice', description: 'A curious traveler.', first_mes: 'Hello {{user}}', character_book: null };
		const card = format === 'V1' ? data : { spec: `chara_card_${format.toLowerCase()}`, spec_version: format === 'V3' ? '3.0' : '2.0', data };
		const json = JSON.stringify(card);
		const png = insertTextChunk(PNG, buildTextChunk(format === 'V3' ? 'ccv3' : 'chara', encodeBase64Utf8(json)), []);
		for (const file of [new File([json], 'card.json'), new File([png as BlobPart], 'card.png')]) {
			const result = await importSillyTavernCard(file);
			expect(result.character.name).toBe('Alice');
			expect(result.character.traits.description).toBe(data.description);
			expect(result.character.traits.firstMessage).toBe(data.first_mes);
			expect(result.lorebook).toBeNull();
			expect(result.character.cardMetadata?.characterBook).toBeUndefined();
			expect(result.warnings).toEqual([]);
			expect(buildCharacterCardV3(entryFrom(result), [], 'all').data.character_book).toBeUndefined();
			if (file.name.endsWith('.png')) expect(result.imageFile).not.toBeNull();
		}
	});
	test.each([{ book: [] }, { book: '' }, { book: 0 }, { book: false }])('still rejects an invalid non-null character_book: %j', async ({ book }) => {
		await expect(importSillyTavernCard(new File([JSON.stringify({ name: 'Alice', character_book: book })], 'card.json')))
			.rejects.toThrow('character_book must be an object');
	});
	test.each([{ name: [] }, { name: 'A', assets: [{}] }, { name: 'A', source: [1] }, { name: 'A', creation_date: -1 }])('rejects malformed V3 data %j', async (data) => {
		await expect(importSillyTavernCard(new File([JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data })], 'card.json'))).rejects.toThrow();
	});
});

describe('CHARX archive validation', () => {
	test.each(['../card.json', '/card.json', 'assets/../secret', 'assets\\secret', 'C:/secret'])('rejects unsafe path %s', async (name) => {
		await expect(readCharx(new File([createZip([{ name, data: new Uint8Array() }, { name: 'card.json', data: new Uint8Array() }])], 'bad.charx'))).rejects.toThrow();
	});
	test('rejects duplicate entries, missing card, truncation and corrupt CRC', async () => {
		const item = { name: 'card.json', data: new TextEncoder().encode('{}') };
		await expect(readCharx(new File([createZip([item, item])], 'bad.charx'))).rejects.toThrow();
		await expect(readCharx(new File([createZip([{ ...item, name: 'nested/card.json' }])], 'bad.charx'))).rejects.toThrow();
		const bytes = new Uint8Array(await createZip([item]).arrayBuffer());
		await expect(readCharx(new File([bytes.subarray(0, -1)], 'bad.charx'))).rejects.toThrow();
		bytes[30 + item.name.length] ^= 1;
		await expect(readCharx(new File([bytes], 'bad.charx'))).rejects.toThrow(/Damaged/);
	});
	test('reads DEFLATE archives produced independently of the STORE writer', async () => {
		const name = new TextEncoder().encode('card.json'); const data = new TextEncoder().encode(JSON.stringify(fixture()));
		const compressed = deflateRawSync(data); const checksum = crc32(data);
		const local = new Uint8Array(30 + name.length + compressed.length); const l = new DataView(local.buffer);
		l.setUint32(0, 0x04034b50, true); l.setUint16(8, 8, true); l.setUint32(14, checksum, true);
		l.setUint32(18, compressed.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true);
		local.set(name, 30); local.set(compressed, 30 + name.length);
		const central = new Uint8Array(46 + name.length); const c = new DataView(central.buffer);
		c.setUint32(0, 0x02014b50, true); c.setUint16(10, 8, true); c.setUint32(16, checksum, true);
		c.setUint32(20, compressed.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); central.set(name, 46);
		const end = new Uint8Array(22); const e = new DataView(end.buffer); e.setUint32(0, 0x06054b50, true);
		e.setUint16(8, 1, true); e.setUint16(10, 1, true); e.setUint32(12, central.length, true); e.setUint32(16, local.length, true);
		const files = await readCharx(new File([local, central, end], 'compressed.charx'));
		expect(files.get('card.json')).toEqual(data);
	});
});
