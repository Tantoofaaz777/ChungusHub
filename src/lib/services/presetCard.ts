/**
 * Preset cards: a preset as a picture, the way a character travels as one.
 *
 * The file is an ordinary PNG: what you see is the preset's cover, and the preset itself
 * rides base64'd in a `chungus_preset` text chunk beside the pixels. One file to post, one
 * file to drag in, and the cover arrives with it, which is the whole reason the cover is
 * not stored in the JSON. A `.json` export is still the plain-text half of the same
 * document (`preset-io.ts` owns that shape); it simply has nowhere to keep a picture.
 *
 * The keyword is ours and deliberately not `chara`: a preset card must never be mistaken
 * for a character card by our own importer or by SillyTavern's.
 */

import type { PromptPreset } from '#lib/types/database.ts';
import { parsePresetJson, presetDocument, type ImportedPreset } from '#lib/services/preset-io.ts';
import {
	cropToPng,
	fetchImageBlob,
	makePlaceholderPng,
	triggerDownload
} from '#lib/services/libraryExport.ts';
import {
	buildTextChunk,
	decodeBase64Utf8,
	encodeBase64Utf8,
	insertTextChunk,
	readTextChunk
} from '#lib/services/pngText.ts';

/** The text-chunk keyword a preset card is claimed by. */
export const PRESET_CHUNK_KEYWORD = 'chungus_preset';

/**
 * A preset cover is a 3:4 portrait (a book cover, not an avatar). The card is written at
 * this size and centre-crops whatever it is given, which is the same fit the app renders
 * with (`aspect-ratio: 3/4` + `object-fit: cover` in PresetControlsView and the identity
 * editor). Both ends must agree, or the picture a reader sees is not the picture they get.
 */
export const COVER_WIDTH = 768;
export const COVER_HEIGHT = 1024;

/** Embed a preset into PNG bytes (pure, no DOM). */
export function embedPresetInPng(basePng: Uint8Array, preset: PromptPreset): Uint8Array {
	const base64 = encodeBase64Utf8(JSON.stringify(presetDocument(preset)));
	return insertTextChunk(basePng, buildTextChunk(PRESET_CHUNK_KEYWORD, base64), [
		PRESET_CHUNK_KEYWORD
	]);
}

/**
 * Read a preset back out of PNG bytes. Returns null when the picture carries no preset,
 * so a caller can tell "not a preset card" apart from "a broken one": a card whose chunk
 * is present but unreadable throws, because silently importing an empty preset under a
 * success message is how a person loses an afternoon's work without being told.
 */
export function readPresetFromPng(png: Uint8Array): ImportedPreset | null {
	const chunk = readTextChunk(png, PRESET_CHUNK_KEYWORD);
	if (chunk === null) return null;
	let json: string;
	try {
		json = decodeBase64Utf8(chunk);
	} catch {
		json = chunk; // tolerate a chunk written as raw JSON
	}
	return parsePresetJson(json);
}

/** The cover art at the card's own portrait size, or a lettered placeholder at the same one.
 *  Always redrawn rather than passed through: a card whose shape depended on whatever the
 *  author happened to upload would crop differently everywhere it is shown. */
async function buildCoverPng(preset: PromptPreset): Promise<Uint8Array> {
	const blob = await fetchImageBlob(preset.meta?.cover);
	if (blob) return cropToPng(blob, COVER_WIDTH, COVER_HEIGHT);
	return makePlaceholderPng(preset.name, COVER_WIDTH, COVER_HEIGHT);
}

/** Download a preset as a PNG card named after it. */
export async function exportPresetCard(preset: PromptPreset, filename: string): Promise<void> {
	const card = embedPresetInPng(await buildCoverPng(preset), preset);
	// Cast: the DOM lib rejects Uint8Array<ArrayBufferLike> as a BlobPart over a SharedArrayBuffer nuance.
	triggerDownload(filename, new Blob([card as BlobPart], { type: 'image/png' }));
}
