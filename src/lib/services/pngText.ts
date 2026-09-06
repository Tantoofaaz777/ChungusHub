/**
 * PNG text chunks: the one implementation of "hide a document inside a picture".
 *
 * Two file formats ride on this: SillyTavern character cards (`chara`) and preset cards
 * (`chungus_preset`). Both are a normal PNG a human can open, look at, and post anywhere,
 * with the real payload base64'd into a `tEXt` chunk beside the pixels. Keeping the reader
 * and the writer in one file is the point: a chunk written with a CRC over the wrong byte
 * range looks fine locally and is rejected by every real PNG reader, so the two halves must
 * never drift apart. CRC-32 itself lives once more in {@link ./crc32}, shared with the ZIP
 * writer for the same reason.
 *
 * Keep this module and `crc32.ts` free of `$lib` value imports so the binary format logic
 * remains portable and usable outside the browser bundle, the same requirement the memory
 * core carries (architecture/memory.md).
 */

import { crc32 } from './crc32';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** How PNG spells its own single-byte text: chunk types, keywords and `tEXt` payloads.
 *  Named by the label the encoding standard registers rather than by its `latin1` alias,
 *  which selects the identical decoder but is missing from the server runtime's own type
 *  for it, and this file is compiled for both sides. */
const LATIN1 = 'windows-1252';

/** Throw unless the bytes start with the PNG signature. */
export function assertPng(bytes: Uint8Array, what = 'File'): void {
	for (let i = 0; i < PNG_SIGNATURE.length; i++) {
		if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error(`${what} is not a valid PNG`);
	}
}

/** UTF-8 text → base64 (inverse of {@link decodeBase64Utf8}). */
export function encodeBase64Utf8(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/** base64 → UTF-8 text, tolerating URL-safe alphabets, stray whitespace and lost padding. */
export function decodeBase64Utf8(base64: string): string {
	let clean = base64.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
	clean += '='.repeat((4 - (clean.length % 4)) % 4);
	const binary = atob(clean);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder('utf-8').decode(bytes);
}

/** Build a complete PNG tEXt chunk: `len(4) + 'tEXt' + keyword + 0x00 + text + crc(4)`. */
export function buildTextChunk(keyword: string, text: string): Uint8Array {
	const enc = new TextEncoder();
	const keywordBytes = enc.encode(keyword);
	const textBytes = enc.encode(text);
	const dataLen = keywordBytes.length + 1 + textBytes.length;
	const chunk = new Uint8Array(12 + dataLen);
	const view = new DataView(chunk.buffer);
	view.setUint32(0, dataLen);
	chunk[4] = 0x74; // 't'
	chunk[5] = 0x45; // 'E'
	chunk[6] = 0x58; // 'X'
	chunk[7] = 0x74; // 't'
	let offset = 8;
	chunk.set(keywordBytes, offset);
	offset += keywordBytes.length;
	chunk[offset] = 0;
	offset += 1;
	chunk.set(textBytes, offset);
	// CRC covers the type + data (bytes 4 .. end-of-data).
	const crc = crc32(chunk.subarray(4, 8 + dataLen));
	view.setUint32(8 + dataLen, crc);
	return chunk;
}

/** Chunk length. `>>> 0` because a chunk of 2 GiB or more sets bit 31, and a signed shift
 *  hands back a negative length that walks the scan backwards forever. */
function chunkLength(png: Uint8Array, offset: number): number {
	return (
		((png[offset] << 24) | (png[offset + 1] << 16) | (png[offset + 2] << 8) | png[offset + 3]) >>> 0
	);
}

function chunkType(png: Uint8Array, offset: number): string {
	return new TextDecoder(LATIN1).decode(png.subarray(offset + 4, offset + 8));
}

/** The keyword of a tEXt/iTXt chunk = data bytes up to the first null. */
function chunkKeyword(png: Uint8Array, dataStart: number, dataEnd: number): string {
	let end = dataStart;
	while (end < dataEnd && png[end] !== 0) end++;
	return new TextDecoder(LATIN1).decode(png.subarray(dataStart, end));
}

/**
 * Splice a chunk in just before IEND, dropping any existing text chunk whose keyword is in
 * `replacing` on the way through. Otherwise a re-exported picture carries a stale document
 * beside the fresh one and readers take whichever they meet first.
 */
export function insertTextChunk(
	png: Uint8Array,
	chunk: Uint8Array,
	replacing: readonly string[]
): Uint8Array {
	assertPng(png, 'Base image');
	const parts: Uint8Array[] = [png.subarray(0, 8)];
	let offset = 8;
	let inserted = false;
	while (offset + 8 <= png.length) {
		const len = chunkLength(png, offset);
		const type = chunkType(png, offset);
		const chunkEnd = offset + 12 + len;

		if (type === 'IEND') {
			parts.push(chunk);
			parts.push(png.subarray(offset, chunkEnd));
			inserted = true;
			break;
		}

		if (type === 'tEXt' || type === 'iTXt') {
			if (replacing.includes(chunkKeyword(png, offset + 8, chunkEnd - 4))) {
				offset = chunkEnd;
				continue; // drop the stale document
			}
		}

		parts.push(png.subarray(offset, chunkEnd));
		offset = chunkEnd;
	}

	if (!inserted) throw new Error('Base PNG missing IEND chunk');

	const total = parts.reduce((sum, p) => sum + p.length, 0);
	const out = new Uint8Array(total);
	let pos = 0;
	for (const p of parts) {
		out.set(p, pos);
		pos += p.length;
	}
	return out;
}

/**
 * The text of the FIRST tEXt/iTXt chunk carrying `keyword`, or null when the picture has
 * none. `tEXt` decodes latin1 and `iTXt` utf-8 per the spec, after skipping iTXt's
 * compression flag, language tag and translated keyword. Throws on a non-PNG: a file that
 * is not a picture at all is a different mistake than a picture with nothing hidden in it.
 */
export function readTextChunk(png: Uint8Array, keyword: string): string | null {
	assertPng(png);
	let offset = 8;
	while (offset + 8 <= png.length) {
		const len = chunkLength(png, offset);
		const type = chunkType(png, offset);
		const dataStart = offset + 8;
		const dataEnd = dataStart + len;

		if ((type === 'tEXt' || type === 'iTXt') && chunkKeyword(png, dataStart, dataEnd) === keyword) {
			let textStart = dataStart + keyword.length + 1;
			if (type === 'iTXt') {
				textStart += 2; // compression flag + method
				while (textStart < dataEnd && png[textStart] !== 0) textStart++;
				textStart++; // language tag terminator
				while (textStart < dataEnd && png[textStart] !== 0) textStart++;
				textStart++; // translated keyword terminator
			}
			const decoder = type === 'tEXt' ? LATIN1 : 'utf-8';
			return new TextDecoder(decoder).decode(png.subarray(textStart, dataEnd));
		}

		offset = dataEnd + 4;
		if (type === 'IEND') break;
	}
	return null;
}
