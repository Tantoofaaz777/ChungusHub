/**
 * Minimal ZIP writer: STORE method (no compression), dependency-free.
 *
 * Bundles a handful of already-compact files (PNG cards are compressed art, JSON is small)
 * into a single archive so a bulk export downloads as one file instead of N. Deflate would
 * buy almost nothing here, so entries are stored verbatim. UTF-8 filenames (flag bit 11).
 */

import { crc32 } from '#lib/services/crc32.ts';

export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION = 20; // 2.0, enough for STORE
const UTF8_FLAG = 0x0800; // bit 11: filename is UTF-8

/** Build a STORE-method ZIP archive from the given entries. */
export function createZip(entries: ZipEntry[]): Blob {
	const enc = new TextEncoder();
	const parts: Uint8Array[] = [];
	const central: Uint8Array[] = [];
	let offset = 0;

	for (const entry of entries) {
		const nameBytes = enc.encode(entry.name);
		const crc = crc32(entry.data);
		const size = entry.data.length;

		const local = new Uint8Array(30 + nameBytes.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, LOCAL_SIG, true);
		lv.setUint16(4, VERSION, true);
		lv.setUint16(6, UTF8_FLAG, true);
		lv.setUint16(8, 0, true); // STORE
		lv.setUint16(10, 0, true); // mod time
		lv.setUint16(12, 0, true); // mod date
		lv.setUint32(14, crc, true);
		lv.setUint32(18, size, true); // compressed
		lv.setUint32(22, size, true); // uncompressed
		lv.setUint16(26, nameBytes.length, true);
		lv.setUint16(28, 0, true); // extra length
		local.set(nameBytes, 30);

		parts.push(local, entry.data);

		const cd = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(cd.buffer);
		cv.setUint32(0, CENTRAL_SIG, true);
		cv.setUint16(4, VERSION, true); // version made by
		cv.setUint16(6, VERSION, true); // version needed
		cv.setUint16(8, UTF8_FLAG, true);
		cv.setUint16(10, 0, true); // STORE
		cv.setUint16(12, 0, true); // mod time
		cv.setUint16(14, 0, true); // mod date
		cv.setUint32(16, crc, true);
		cv.setUint32(20, size, true);
		cv.setUint32(24, size, true);
		cv.setUint16(28, nameBytes.length, true);
		cv.setUint16(30, 0, true); // extra length
		cv.setUint16(32, 0, true); // comment length
		cv.setUint16(34, 0, true); // disk number start
		cv.setUint16(36, 0, true); // internal attrs
		cv.setUint32(38, 0, true); // external attrs
		cv.setUint32(42, offset, true); // local header offset
		cd.set(nameBytes, 46);
		central.push(cd);

		offset += local.length + size;
	}

	const centralSize = central.reduce((sum, c) => sum + c.length, 0);
	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	ev.setUint32(0, EOCD_SIG, true);
	ev.setUint16(4, 0, true); // disk number
	ev.setUint16(6, 0, true); // central dir start disk
	ev.setUint16(8, entries.length, true); // entries on this disk
	ev.setUint16(10, entries.length, true); // total entries
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true); // central dir offset
	ev.setUint16(20, 0, true); // comment length

	return new Blob([...parts, ...central, eocd] as BlobPart[], { type: 'application/zip' });
}
