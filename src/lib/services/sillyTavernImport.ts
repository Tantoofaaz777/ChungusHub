/**
 * Character Card V1/V2/V3 import: PNG/APNG, JSON and CHARX.
 * Standard fields remain editable; portable metadata and asset bytes survive re-export.
 */

import type { LibrarySeed, CharacterTraits, LibraryEntryData } from '$lib/types/library';
import type { ExportedLibraryEntry } from '$lib/services/libraryExport';
import type { Lorebook } from '$lib/lorebook/types';
import { lorebookFromCharacterBook } from '$lib/lorebook/sillytavern';
import { decodeBase64Utf8, readTextChunk, stripCardChunks } from '$lib/services/pngText';
import type { CardAsset } from '$lib/types/character-card';
import { cardMetadata, cardObject, validateCharacterCard } from './characterCard';
import { bytesDataUrl, dataUrlBytes, MAX_CARD_BYTES, readCharx, safeAssetPath } from './charx';

/** Some CHARX exporters omit the asset manifest but keep a conventional main portrait. */
function defaultCharxIcon(archive: Map<string, Uint8Array>): CardAsset | undefined {
	const paths = [...archive.keys()].filter((path) =>
		/^assets\/icon\/images?\/main\.(png|apng|jpe?g|jfif|webp|gif|avif)$/i.test(path)
	).sort();
	const path = paths.find((candidate) => candidate.startsWith('assets/icon/images/')) ?? paths[0];
	return path ? { type: 'icon', name: 'main', uri: `embeded://${path}`, ext: path.split('.').pop()!.toLowerCase() } : undefined;
}

/** SillyTavern character card V2 format */
interface SillyTavernCharacter {
	name?: string;
	description?: string;
	personality?: string;
	scenario?: string;
	first_mes?: string;
	mes_example?: string;
	creator_notes?: string;
	system_prompt?: string;
	post_history_instructions?: string;
	tags?: string[];
	creator?: string;
	character_version?: string;
	alternate_greetings?: string[];
	character_book?: Record<string, unknown>;
	extensions?: Record<string, unknown>;
	// V2 spec fields
	spec?: string;
	spec_version?: string;
	data?: {
		name?: string;
		description?: string;
		personality?: string;
		scenario?: string;
		first_mes?: string;
		mes_example?: string;
		creator_notes?: string;
		system_prompt?: string;
		post_history_instructions?: string;
		tags?: string[];
		creator?: string;
		character_version?: string;
		alternate_greetings?: string[];
		character_book?: Record<string, unknown>;
		extensions?: Record<string, unknown>;
	};
}

export interface ImportResult {
	character: LibrarySeed;
	/** Which library shelf this entry belongs on. SillyTavern cards are always characters. */
	entryType: 'character' | 'persona';
	/** The raw PNG file for image extraction (null if JSON import) */
	imageFile: File | null;
	/** Embedded character_book (SillyTavern lorebook), parsed into a standalone book. */
	lorebook: Lorebook | null;
	/** Background images materialized for the scene controls; other assets stay portable. */
	assetImages?: { asset: CardAsset; file: File }[];
	warnings?: string[];
	/** Character versions from a ChungusHub v2 export, in order, recreated with fresh
	 *  ids on import. Exactly one carries `active`. Absent for SillyTavern cards and v1. */
	versions?: { name: string; data: LibraryEntryData; active: boolean }[];
}

/** True for our ChungusHub-native block: a legacy top-level JSON export or the
 *  `extensions.chungushub` block embedded in a SillyTavern card. */
function isChungusExport(parsed: unknown): parsed is ExportedLibraryEntry {
	return (
		!!parsed &&
		typeof parsed === 'object' &&
		(parsed as { format?: unknown }).format === 'chungushub.libraryEntry'
	);
}

/** Turn a "data:...;base64,..." URL into a File so it can flow through the normal image save.
 *  A malformed URL throws: the export carried a portrait, and importing the entry without it
 *  while reporting success leaves the user hunting for an image the file actually had. */
async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
	const blob = await fetch(dataUrl).then((r) => r.blob());
	return new File([blob], name, { type: blob.type || 'image/png' });
}

/** Map one of our own exports back onto a seed, preserving every field the seed can hold. */
async function importChungusExport(entry: ExportedLibraryEntry): Promise<ImportResult> {
	const portableMetadata = (data: LibraryEntryData) => {
		if (!data.cardMetadata) return undefined;
		const { backgroundPath: _background, assetPaths: _paths, portraitPath: _portrait, ...portable } = data.cardMetadata;
		return portable;
	};
	const name = entry.identity?.name || '';
	const character: LibrarySeed = {
		id: crypto.randomUUID(),
		name,
		...(entry.identity.alias ? { alias: entry.identity.alias } : {}),
		...(entry.data?.cardMetadata ? { cardMetadata: portableMetadata(entry.data) } : {}),
		tags: entry.identity?.tags ? [...entry.identity.tags] : [],
		traits: entry.data?.traits ?? { personality: '', description: '', background: '' },
		traitLabels: entry.data?.traitLabels,
		hiddenTraits: entry.data?.hiddenTraits,
		alternateGreetings: entry.data?.alternateGreetings
	};
	const imageFile = entry.image ? await dataUrlToFile(entry.image, `${name || 'entry'}.png`) : null;
	// v2 exports carry every variant of a versioned character; ids are only used to spot
	// the active one. The importer mints fresh rows. Lorebook ids are this-install-only
	// (books don't travel in the export), so they're dropped like the main data's are.
	const versions = entry.versions?.length
		? entry.versions.map((v) => ({
				name: v.name,
				data: { ...v.data, cardMetadata: portableMetadata(v.data), lorebookIds: undefined },
				active: v.id === entry.activeVersionId
			}))
		: undefined;
	return {
		character,
		entryType: entry.type === 'persona' ? 'persona' : 'character',
		imageFile,
		// Embedded lorebooks don't travel in our export (only install-local ids).
		lorebook: null,
		...(versions ? { versions } : {})
	};
}

/**
 * Parse a PNG file to extract the "chara" tEXt chunk containing character data.
 * The chunk walk itself lives in `pngText.ts`, shared with the writer that produced it.
 */
async function extractCharaFromPng(file: File): Promise<string | null> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	return readTextChunk(bytes, 'ccv3') ?? readTextChunk(bytes, 'chara');
}

/**
 * Parse SillyTavern character data and map it onto our character fields. Every core card
 * field (including system_prompt, post_history_instructions and character_version) is now
 * a first-class permanent field, so a plain import preserves the whole card straight onto
 * traits. Whether each field reaches the prompt is decided by the active preset's macros.
 */
function mapSillyTavernToCharacter(stChar: SillyTavernCharacter): LibrarySeed {
	// Handle V2 format where data is nested
	const charData = stChar.data || stChar;

	const traits: CharacterTraits = {
		description: charData.description || '',
		firstMessage: charData.first_mes || '',
		creator: charData.creator || '',
		creatorNotes: charData.creator_notes || '',
		personality: charData.personality || '',
		scenario: charData.scenario || '',
		exampleDialogue: charData.mes_example || '',
		systemPrompt: charData.system_prompt || '',
		postHistoryInstructions: charData.post_history_instructions || '',
		characterVersion: charData.character_version || '',
		background: ''
	};

	const alternateGreetings = (charData.alternate_greetings ?? [])
		.map((g) => (g ?? '').trim())
		.filter((g) => g.length > 0);

	return {
		id: crypto.randomUUID(),
		name: charData.name || '',
		traits,
		tags: charData.tags || [],
		...(alternateGreetings.length ? { alternateGreetings } : {})
	};
}

/**
 * Import a SillyTavern character card from a File.
	 * Supports PNG/APNG, JSON and CHARX containers.
 */
export async function importSillyTavernCard(file: File): Promise<ImportResult> {
	if (file.size > MAX_CARD_BYTES) throw new Error('Character card is too large (maximum 128 MiB).');
	const isJson = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';
	const isPng = /\.(a?png)$/i.test(file.name) || file.type === 'image/png' || file.type === 'image/apng';
	const isCharx = file.name.toLowerCase().endsWith('.charx');

	if (!isJson && !isPng && !isCharx) {
		throw new Error('Unsupported file type. Please use a PNG, APNG, JSON or CHARX character card.');
	}

	let jsonData: string;
	let imageFile: File | null = null;
	let archive: Map<string, Uint8Array> | undefined;
	let portraitBytes: Uint8Array | undefined;
	let pngBytes: Uint8Array | undefined;

	if (isCharx) {
		archive = await readCharx(file);
		jsonData = new TextDecoder().decode(archive.get('card.json')!);
	} else if (isPng) {
		// Extract character data from PNG tEXt chunk
		const charaData = await extractCharaFromPng(file);
		if (!charaData) {
			throw new Error('No character data found in PNG. Is this a valid SillyTavern character card?');
		}

		// Decode base64 to JSON (with proper UTF-8 support)
		try {
			jsonData = decodeBase64Utf8(charaData);
		} catch {
			// Might not be base64 encoded
			jsonData = charaData;
		}

		// Keep the PNG for image extraction
		pngBytes = new Uint8Array(await file.arrayBuffer());
		portraitBytes = stripCardChunks(pngBytes);
		imageFile = file;
	} else {
		// Read JSON file with explicit UTF-8 decoding
		const buffer = await file.arrayBuffer();
		jsonData = new TextDecoder('utf-8').decode(buffer);
	}

	// Parse JSON
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonData);
	} catch {
		throw new Error('Invalid JSON in character card.');
	}

	// Our legacy top-level JSON export round-trips through a dedicated mapper (SillyTavern's
	// shape would misread its top-level `data` key as the card body and yield an empty character).
	if (isChungusExport(parsed)) {
		return importChungusExport(parsed);
	}

	const root = cardObject(parsed, 'card');
	const body = validateCharacterCard(root);
	const stChar = parsed as SillyTavernCharacter;
	const metadata = cardMetadata(root, body);
	if (root.spec === 'chara_card_v3' && portraitBytes) imageFile = new File([portraitBytes as BlobPart], file.name, { type: 'image/png' });
	const warnings: string[] = [];
	const assetImages: NonNullable<ImportResult['assetImages']> = [];
	const assets = metadata.assets ?? (root.spec === 'chara_card_v3' ? [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }] : []);
	const archiveIcon = archive && defaultCharxIcon(archive);
	if (archiveIcon) {
		const main = assets.find((asset) => asset.type === 'icon' && asset.name === 'main');
		if (!main) assets.unshift(archiveIcon);
		else if (main.uri === 'ccdefault:') Object.assign(main, archiveIcon);
	}
	let assetBytes = 0;
	for (const asset of assets) {
		let content: { bytes: Uint8Array; mime: string } | null = null;
		const mime = ({ png: 'image/png', apng: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' } as Record<string, string>)[asset.ext.toLowerCase()] ?? 'application/octet-stream';
		try {
			if (assetBytes >= MAX_CARD_BYTES) throw new Error('Combined character assets exceed 128 MiB.');
			if (asset.uri === 'ccdefault:' && asset.type === 'icon' && portraitBytes) content = { bytes: portraitBytes, mime: 'image/png' };
			else if (asset.uri.startsWith('embeded://') || asset.uri.startsWith('__asset:')) {
				const path = asset.uri.startsWith('embeded://') ? asset.uri.slice(10) : asset.uri.slice(8);
				if (!safeAssetPath(path)) throw new Error('Unsafe embedded asset path.');
				const pngAsset = pngBytes ? readTextChunk(pngBytes, `chara-ext-asset_:${path}`) : null;
				const bytes = archive?.get(path) ?? (pngAsset ? dataUrlBytes(`data:${mime};base64,${pngAsset}`)?.bytes : undefined);
				if (!bytes) throw new Error('Embedded asset is missing.');
				content = { bytes, mime };
			} else if (asset.uri.startsWith('data:')) content = dataUrlBytes(asset.uri);
			else if (/^https?:\/\//i.test(asset.uri)) {
				const response = await fetch('/api/card-assets/fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: asset.uri }) });
				if (!response.ok) throw new Error('Linked asset could not be downloaded.');
				content = { bytes: new Uint8Array(await response.arrayBuffer()), mime };
			}
			if (!content) continue;
			assetBytes += content.bytes.length;
			if (assetBytes > MAX_CARD_BYTES) throw new Error('Combined character assets exceed 128 MiB.');
			asset.uri = bytesDataUrl(content.bytes, content.mime);
			if (content.mime.startsWith('image/') && content.mime !== 'image/svg+xml') {
				const image = new File([content.bytes as BlobPart], `${asset.name}.${asset.ext}`, { type: content.mime });
				if (asset.type === 'icon' && asset.name === 'main') imageFile = image;
				else if (asset.type === 'background') assetImages.push({ asset, file: image });
			}
		} catch {
			warnings.push(`Asset "${asset.name}" could not be loaded; its reference was preserved.`);
		}
	}
	if (assets.length) metadata.assets = assets;

	// A ChungusHub-exported ST card carries our native fidelity block in `extensions.chungushub`
	// (versions, trait labels, hidden traits). Route it through the same mapper as our JSON export
	// so nothing is lost: the card's standard fields are just SillyTavern's clean view of the
	// active version. The portrait rides in the PNG (the block's own image is always null).
	const embedded = stChar.data?.extensions?.chungushub ?? stChar.extensions?.chungushub;
	if (isChungusExport(embedded)) {
		const result = await importChungusExport(embedded);
		if (root.spec === 'chara_card_v3') {
			// Another editor may have changed the standard surface after our export.
			// Keep native-only fields, but let explicitly present standard fields win.
			const mapped = mapSillyTavernToCharacter(stChar).traits;
			const names: Record<string, keyof CharacterTraits> = { description: 'description', personality: 'personality', scenario: 'scenario',
				first_mes: 'firstMessage', mes_example: 'exampleDialogue', creator: 'creator', creator_notes: 'creatorNotes',
				system_prompt: 'systemPrompt', post_history_instructions: 'postHistoryInstructions', character_version: 'characterVersion' };
			const updates = Object.fromEntries(Object.entries(names).filter(([key]) => Object.hasOwn(body, key)).map(([, trait]) => [trait, mapped[trait]]));
			result.character.traits = { ...result.character.traits, ...updates };
			result.character.name = body.name as string;
			if (Array.isArray(body.tags)) result.character.tags = body.tags as string[];
			if (Array.isArray(body.alternate_greetings)) result.character.alternateGreetings = body.alternate_greetings as string[];
			for (const version of result.versions ?? []) if (version.active) {
				version.data.traits = { ...version.data.traits, ...updates };
				version.data.alternateGreetings = result.character.alternateGreetings;
			}
		}
		result.character.cardMetadata = metadata;
		for (const version of result.versions ?? []) if (version.active) version.data.cardMetadata = metadata;
		if (typeof body.nickname === 'string') result.character.alias = body.nickname;
		const rawBook = body.character_book;
		const lorebook = rawBook ? lorebookFromCharacterBook(rawBook as Record<string, unknown>, `${result.character.name} Lorebook`, root.spec === 'chara_card_v3') : result.lorebook;
		return { ...result, imageFile, lorebook, assetImages, warnings };
	}

	// Map to our format
	const character = mapSillyTavernToCharacter(stChar);
	character.cardMetadata = metadata;
	if (typeof body.nickname === 'string') character.alias = body.nickname;

	// Pull an embedded character_book (V2/V3) into a standalone lorebook, if present.
	const rawBook = stChar.data?.character_book ?? stChar.character_book;
	const lorebook =
		rawBook && typeof rawBook === 'object'
			? lorebookFromCharacterBook(rawBook, `${character.name || 'Character'} Lorebook`, root.spec === 'chara_card_v3')
			: null;

	return { character, entryType: 'character', imageFile, lorebook, assetImages, warnings };
}
