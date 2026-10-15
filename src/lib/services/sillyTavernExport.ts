/**
 * SillyTavern character card export.
 *
 * Produces Character Card V3 PNG/JSON/CHARX and optional V2-compatible PNG/JSON,
 * with `ccv3` or `chara` tEXt documents in PNG, the same shape the importer
 * (`sillyTavernImport.ts`) reads. ChungusHub-native fidelity (all character versions, trait
 * labels, hidden traits, the ChungusHub-only `background` trait) rides in
 * `data.extensions.chungushub`, which SillyTavern ignores: a card reads as one clean
 * character in SillyTavern while round-tripping losslessly back into ChungusHub.
 *
 * The "which version" choice only decides the card's *surface*: 'all' shows the active
 * version in the standard fields and embeds every version; a specific id shows just that
 * version and embeds only it.
 */

import type { CharacterVersion, LibraryEntry, LibraryEntryData } from '$lib/types/library';
import {
	fetchImageBlob,
	makePlaceholderPng,
	reencodeToPng,
	sanitizeFilename,
	triggerDownload
} from '$lib/services/libraryExport';
import type { ExportedLibraryEntry } from '$lib/services/libraryExport';
import { buildTextChunk, encodeBase64Utf8, insertTextChunk } from '$lib/services/pngText';
import { createZip, type ZipEntry } from '$lib/services/zip';
import type { CardAsset, CharacterCardV3 } from '$lib/types/character-card';
import type { Lorebook } from '$lib/lorebook/types';
import { toCharacterBook } from '$lib/lorebook/sillytavern';
import { bytesDataUrl, dataUrlBytes } from './charx';
import { stripCardChunks } from './pngText';

/** 'all' surfaces the active version and embeds every version; a version id surfaces just that one. */
export type VersionSelection = 'all' | string;

/** Character card containers. CHARX always carries V3. */
export type ExportFormat = 'png' | 'json' | 'charx';
export type CardSchema = 'v2' | 'v3';

/** One character to export, paired with its versions (empty when unversioned). */
export interface ExportTarget {
	entry: LibraryEntry;
	versions: CharacterVersion[];
}

interface SillyTavernCardData {
	name: string;
	description: string;
	personality: string;
	scenario: string;
	first_mes: string;
	mes_example: string;
	creator: string;
	creator_notes: string;
	system_prompt: string;
	post_history_instructions: string;
	character_version: string;
	tags: string[];
	alternate_greetings: string[];
	extensions: Record<string, unknown> & { chungushub: ExportedLibraryEntry };
	character_book?: Record<string, unknown>;
}

export interface SillyTavernCard {
	spec: 'chara_card_v2';
	spec_version: '2.0';
	/** The V1 card field set, mirrored at the top level so V1-only readers still see the
	 *  character; V2 readers use `data`, which is canonical. Real ST cards mirror the same set. */
	name: string;
	description: string;
	personality: string;
	scenario: string;
	first_mes: string;
	mes_example: string;
	data: SillyTavernCardData;
}

/** The version whose content fills the standard card fields. 'all' → the active version. */
function resolveSurfaceData(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection
): LibraryEntryData {
	if (selection === 'all') return entry.data;
	const picked = versions.find((v) => v.id === selection);
	return picked ? picked.data : entry.data;
}

/** Map a version's content onto the standard SillyTavern card fields. `background` has no ST
 *  slot, so it survives only in the embedded block. */
function traitsToCardFields(data: LibraryEntryData) {
	const t = data.traits;
	return {
		description: t.description ?? '',
		personality: t.personality ?? '',
		scenario: t.scenario ?? '',
		first_mes: t.firstMessage ?? '',
		mes_example: t.exampleDialogue ?? '',
		creator: t.creator ?? '',
		creator_notes: t.creatorNotes ?? '',
		system_prompt: t.systemPrompt ?? '',
		post_history_instructions: t.postHistoryInstructions ?? '',
		character_version: t.characterVersion ?? '',
		alternate_greetings: data.alternateGreetings ? [...data.alternateGreetings] : []
	};
}

/** Build the ChungusHub-native fidelity block embedded in a card's `data.extensions.chungushub`.
 *  Always carries the surfaced version's full data (so trait labels/hidden traits survive); the
 *  whole version list rides along only for an 'all' export. */
function buildExportBlock(
	entry: LibraryEntry,
	surfaceData: LibraryEntryData,
	versions: CharacterVersion[],
	includeAllVersions: boolean
): ExportedLibraryEntry {
	const withVersions = includeAllVersions && !!entry.activeVersionId && versions.length > 0;
	return {
		format: 'chungushub.libraryEntry',
		version: 2,
		type: entry.type,
		identity: {
			name: entry.identity.name,
			tags: entry.identity.tags ? [...entry.identity.tags] : []
		},
		data: surfaceData,
		...(withVersions
			? {
					versions: versions.map((v) => ({
						id: v.id,
						name: v.name,
						data: v.data,
						createdAt: v.createdAt,
						updatedAt: v.updatedAt
					})),
					activeVersionId: entry.activeVersionId
				}
			: {}),
		exportedAt: new Date().toISOString()
	};
}

/** Build a SillyTavern V2 card object for an entry. */
export function buildSillyTavernCard(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection,
	books: Lorebook[] = []
): SillyTavernCard {
	const surface = resolveSurfaceData(entry, versions, selection);
	const fields = traitsToCardFields(surface);
	const name = entry.identity.name ?? '';
	const tags = entry.identity.tags ? [...entry.identity.tags] : [];
	const block = buildExportBlock(entry, surface, versions, selection === 'all');
	return {
		spec: 'chara_card_v2',
		spec_version: '2.0',
		name,
		description: fields.description,
		personality: fields.personality,
		scenario: fields.scenario,
		first_mes: fields.first_mes,
		mes_example: fields.mes_example,
		data: {
			name,
			...fields,
			tags,
			...(cardBook(surface, books) ? { character_book: cardBook(surface, books) } : {}),
			extensions: { ...surface.cardMetadata?.extensions, chungushub: block }
		}
	};
}

function cardBook(surface: LibraryEntryData, books: Lorebook[]): Record<string, unknown> | undefined {
	if (surface.lorebookIds === undefined) return surface.cardMetadata?.characterBook;
	const linked = books.filter((book) => surface.lorebookIds!.includes(book.id));
	if (!linked.length) return undefined;
	const converted = linked.map(toCharacterBook);
	return { ...converted[0], entries: converted.flatMap((book) => book.entries as Record<string, unknown>[]) };
}

export function buildCharacterCardV3(entry: LibraryEntry, versions: CharacterVersion[], selection: VersionSelection,
	books: Lorebook[] = []): CharacterCardV3 {
	const surface = resolveSurfaceData(entry, versions, selection);
	const metadata = surface.cardMetadata;
	const base = buildSillyTavernCard(entry, versions, selection, books);
	if (entry.identity.alias) base.data.extensions.chungushub.identity.alias = entry.identity.alias;
	return {
		spec: 'chara_card_v3', spec_version: '3.0',
		data: {
			...metadata?.extra, ...base.data,
			nickname: entry.identity.alias ?? '',
			group_only_greetings: metadata?.groupOnlyGreetings ? [...metadata.groupOnlyGreetings] : [],
			...(metadata?.assets ? { assets: metadata.assets.map((asset) => ({ ...asset })) } : {}),
			...(metadata?.creatorNotesMultilingual ? { creator_notes_multilingual: { ...metadata.creatorNotesMultilingual } } : {}),
			...(metadata?.source ? { source: [...metadata.source] } : {}),
			creation_date: metadata?.creationDate ?? Math.floor(entry.createdAt / 1000),
			modification_date: Math.floor(Date.now() / 1000)
		}
	};
}

/** Container, schema and linked books selected for an export. */
export interface ExportOptions {
	format: ExportFormat;
	/** V2 remains available for older readers; the export dialog defaults to V3. */
	schema?: CardSchema;
	lorebooks?: Lorebook[];
}

interface CardFile {
	data: Uint8Array;
	mime: string;
	ext: ExportFormat;
}

/** Build the card file bytes for one entry: a JSON card (imageless) or a PNG card (portrait
 *  as art, card in the `chara` chunk). Shared by every export path. */
async function buildSillyTavernCardFile(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection,
	format: ExportFormat,
	opts?: ExportOptions
): Promise<CardFile> {
	const schema = format === 'charx' ? 'v3' : opts?.schema ?? 'v2';
	const card = schema === 'v3'
		? buildCharacterCardV3(entry, versions, selection, opts?.lorebooks)
		: buildSillyTavernCard(entry, versions, selection, opts?.lorebooks);
	if (card.spec === 'chara_card_v3') await includeNativeAssets(card, entry, resolveSurfaceData(entry, versions, selection).cardMetadata);
	if (format === 'charx' && card.spec === 'chara_card_v3') {
		return { data: new Uint8Array(await buildCharx(card).arrayBuffer()), mime: 'application/zip', ext: 'charx' };
	}
	if (format === 'json') {
		return {
			data: new TextEncoder().encode(JSON.stringify(card, null, 2)),
			mime: 'application/json',
			ext: 'json'
		};
	}
	const basePng = await buildBasePng(entry);
	return { data: embedCardInPng(basePng, card), mime: 'image/png', ext: 'png' };
}

async function includeNativeAssets(card: CharacterCardV3, entry: LibraryEntry, metadata: LibraryEntryData['cardMetadata']): Promise<void> {
	const assets = card.data.assets ?? [{ type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' }];
	const main = assets.find((asset) => asset.type === 'icon' && asset.name === 'main');
	if (!main || main.uri === 'ccdefault:' || (metadata?.portraitPath && metadata.portraitPath !== entry.identity.imageUrl)) {
		const png = await buildBasePng(entry);
		const icon = { type: 'icon', name: 'main', ext: 'png', uri: bytesDataUrl(stripCardChunks(png), 'image/png') };
		if (main) Object.assign(main, icon); else assets.unshift(icon);
	}
	card.data.assets = assets;
}

/** CHARX retains arbitrary asset bytes without ever executing their content. */
export function buildCharx(card: CharacterCardV3): Blob {
	// Store values may be Svelte proxies. The interchange document is JSON by definition.
	const copy: CharacterCardV3 = JSON.parse(JSON.stringify(card));
	const files: ZipEntry[] = [];
	for (const [i, asset] of (copy.data.assets ?? []).entries()) {
		const decoded = dataUrlBytes(asset.uri);
		if (!decoded) continue;
		const extension = /^[a-z0-9]+$/.test(asset.ext) ? asset.ext : 'bin';
		const type = /^[a-z0-9_]+$/.test(asset.type) ? asset.type : 'other';
		const kind = /^(png|apng|jpe?g|gif|webp|avif|svg)$/.test(extension) ? 'images' :
			/^(mp3|wav|ogg|flac|m4a)$/.test(extension) ? 'audio' : 'other';
		const path = `assets/${type}/${kind}/${i}.${extension}`;
		files.push({ name: path, data: decoded.bytes });
		asset.uri = `embeded://${path}`;
	}
	files.unshift({ name: 'card.json', data: new TextEncoder().encode(JSON.stringify(copy, null, 2)) });
	return createZip(files);
}

/** Export one card, including its portable V3 assets when applicable. */
export async function exportEntryAsSillyTavern(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection,
	opts: ExportOptions
): Promise<void> {
	const { data, mime, ext } = await buildSillyTavernCardFile(entry, versions, selection, opts.format, opts);
	triggerDownload(`${exportBaseName(entry)}.${ext}`, new Blob([data as BlobPart], { type: mime }));
}

/** Export several cards in a ZIP, including every character version. */
export async function exportEntriesAsSillyTavernZip(
	targets: ExportTarget[],
	opts: ExportOptions
): Promise<void> {
	const files: ZipEntry[] = [];
	const usedBases = new Set<string>();
	for (const { entry, versions } of targets) {
		files.push(...(await buildCharacterFiles(entry, versions, 'all', opts, usedBases)));
	}
	triggerDownload('characters.zip', createZip(files));
}

/** One card per character in a bulk archive; V3 assets travel inside the card. */
export async function buildCharacterFiles(
	entry: LibraryEntry,
	versions: CharacterVersion[],
	selection: VersionSelection,
	opts: ExportOptions,
	usedBases: Set<string>
): Promise<ZipEntry[]> {
	const base = uniqueBase(exportBaseName(entry), usedBases);
	const card = await buildSillyTavernCardFile(entry, versions, selection, opts.format, opts);
	return [{ name: `${base}.${card.ext}`, data: card.data }];
}

/** The export filename base for an entry: its name, or the same "Unnamed Character/Persona"
 *  fallback the UI shows, so a nameless character exports as "Unnamed Character.png", not "entry". */
function exportBaseName(entry: LibraryEntry): string {
	const fallback = entry.type === 'persona' ? 'Unnamed Persona' : 'Unnamed Character';
	// `?.trim() ||` so a blank or whitespace-only name still falls back instead of hitting
	// sanitizeFilename's generic "entry".
	return sanitizeFilename(entry.identity.name?.trim() || fallback);
}

/** Reserve a base name, disambiguating collisions as `name(2)`, `name(3)`, … */
function uniqueBase(name: string, used: Set<string>): string {
	if (!used.has(name)) {
		used.add(name);
		return name;
	}
	let i = 2;
	while (used.has(`${name}(${i})`)) i++;
	const unique = `${name}(${i})`;
	used.add(unique);
	return unique;
}

/** Embed a card as ccv3 (V3) or chara (V2), retaining the image/animation chunks. */
export function embedCardInPng(basePng: Uint8Array, card: SillyTavernCard | CharacterCardV3): Uint8Array {
	const base64 = encodeBase64Utf8(JSON.stringify(card));
	// Drop stale documents and embedded assets before adding the canonical document.
	return insertTextChunk(stripCardChunks(basePng), buildTextChunk(card.spec === 'chara_card_v3' ? 'ccv3' : 'chara', base64), ['chara', 'ccv3']);
}

/** Base PNG bytes for the card: the portrait (re-encoded if not already PNG), or a plain
 *  placeholder when the entry has no portrait. */
async function buildBasePng(entry: LibraryEntry): Promise<Uint8Array> {
	const blob = await fetchImageBlob(entry.identity.imageUrl);
	if (blob && blob.type === 'image/png') {
		return new Uint8Array(await blob.arrayBuffer());
	}
	if (blob) {
		return reencodeToPng(blob);
	}
	return makePlaceholderPng(entry.identity.name);
}
