/** Browser-side CHARX reader. Files remain in memory; archive paths never reach a filesystem. */
import { crc32 } from './crc32';

export const MAX_CARD_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 4096;

export function safeAssetPath(path: string): boolean {
	return !!path && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') &&
		!path.includes(':') && !path.split('/').some((part) => part === '.' || part === '..' || part === '');
}

async function inflate(bytes: Uint8Array, expected: number): Promise<Uint8Array> {
	const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	const reader = stream.getReader();
	const parts: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			length += next.value.length;
			if (length > expected || length > MAX_CARD_BYTES) throw new Error('CHARX asset exceeds its declared size.');
			parts.push(next.value);
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	}
	const output = new Uint8Array(length);
	let at = 0;
	for (const part of parts) { output.set(part, at); at += part.length; }
	return output;
}

export async function readCharx(file: File): Promise<Map<string, Uint8Array>> {
	if (file.size > MAX_ARCHIVE_BYTES) throw new Error('CHARX file is too large (maximum 256 MiB).');
	const bytes = new Uint8Array(await file.arrayBuffer());
	const view = new DataView(bytes.buffer);
	let end = bytes.length - 22;
	for (; end >= Math.max(0, bytes.length - 65557); end--) {
		if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
	}
	if (end < 0 || end < bytes.length - 65557) throw new Error('Invalid CHARX archive: missing ZIP directory.');
	if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('Split CHARX archives are not supported.');
	const count = view.getUint16(end + 10, true);
	const centralSize = view.getUint32(end + 12, true);
	let offset = view.getUint32(end + 16, true);
	const centralStart = offset;
	const centralEnd = offset + centralSize;
	if (view.getUint16(end + 8, true) !== count || count > MAX_ENTRIES || count === 0xffff || centralEnd > end) throw new Error('CHARX archive is too large or uses an unsupported ZIP format.');
	const files = new Map<string, Uint8Array>();
	let total = 0;
	for (let i = 0; i < count; i++) {
		if (offset + 46 > centralEnd || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid CHARX ZIP directory.');
		const flags = view.getUint16(offset + 8, true);
		const method = view.getUint16(offset + 10, true);
		const checksum = view.getUint32(offset + 16, true);
		const compressed = view.getUint32(offset + 20, true);
		const size = view.getUint32(offset + 24, true);
		const nameSize = view.getUint16(offset + 28, true);
		const extra = view.getUint16(offset + 30, true);
		const comment = view.getUint16(offset + 32, true);
		const local = view.getUint32(offset + 42, true);
		if (offset + 46 + nameSize + extra + comment > centralEnd || flags & 1 || ![0, 8].includes(method)) {
			throw new Error('CHARX is encrypted, damaged, or uses unsupported compression.');
		}
		const name = new TextDecoder(flags & 0x0800 ? 'utf-8' : 'windows-1252').decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
		offset += 46 + nameSize + extra + comment;
		if (name.endsWith('/')) continue;
		if (!safeAssetPath(name) || files.has(name)) throw new Error('CHARX contains an unsafe or duplicate asset path.');
		total += size;
		if (size > MAX_CARD_BYTES || total > MAX_ARCHIVE_BYTES) throw new Error('CHARX contents exceed the size limit.');
		if (local + 30 > centralStart || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) & 1 || view.getUint16(local + 8, true) !== method) {
			throw new Error('Invalid CHARX asset header.');
		}
		const localNameSize = view.getUint16(local + 26, true);
		const start = local + 30 + localNameSize + view.getUint16(local + 28, true);
		const localName = new TextDecoder(flags & 0x0800 ? 'utf-8' : 'windows-1252').decode(bytes.subarray(local + 30, local + 30 + localNameSize));
		if (localName !== name || start + compressed > centralStart) throw new Error('Invalid CHARX asset bounds.');
		const packed = bytes.subarray(start, start + compressed);
		const content = method === 0 ? packed : await inflate(packed, size);
		if (content.length !== size || crc32(content) !== checksum) throw new Error(`Damaged CHARX asset: ${name}`);
		files.set(name, content);
	}
	if (offset !== centralEnd) throw new Error('Invalid CHARX ZIP directory size.');
	if (!files.has('card.json')) throw new Error('CHARX archive has no card.json at its root.');
	return files;
}

export function bytesDataUrl(bytes: Uint8Array, mime: string): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return `data:${mime};base64,${btoa(binary)}`;
}

export function dataUrlBytes(uri: string): { bytes: Uint8Array; mime: string } | null {
	const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(uri);
	if (!match) return null;
	const binary = match[2] ? atob(match[3].replace(/\s/g, '')) : null;
	const bytes = binary === null ? new TextEncoder().encode(decodeURIComponent(match[3])) : Uint8Array.from(binary, (c) => c.charCodeAt(0));
	if (bytes.length > MAX_CARD_BYTES) throw new Error('Card asset is too large.');
	return { bytes, mime: match[1] || 'application/octet-stream' };
}
