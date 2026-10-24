/**
 * Chat-attachment image loading for LLM requests. Messages carry attachments as
 * server-relative paths (images/chat/<file>); providers call loadImage() to turn
 * one into base64 + media type at request-build time, so raw bytes never ride
 * the WebSocket and a deleted file fails the generation loudly.
 */
import { readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { IMAGES_ROOT } from '../config';

const MIME_BY_EXT: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.jfif': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

export interface LoadedImage {
	mediaType: string;
	base64: string;
}

/**
 * Load one attachment image. The path must resolve inside IMAGES_ROOT: the
 * client sends these paths over the WebSocket, so treat them as untrusted.
 */
export function loadImage(relativePath: string): LoadedImage {
	const safe = normalize(relativePath.replace(/^images\//, '')).replace(/^([/\\]|\.\.([/\\]|$))+/g, '');
	const abs = join(IMAGES_ROOT, safe);
	if (!abs.startsWith(IMAGES_ROOT + sep)) {
		throw new Error(`Attachment path escapes image storage: "${relativePath}"`);
	}
	const ext = (safe.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
	const mediaType = MIME_BY_EXT[ext];
	if (!mediaType) {
		throw new Error(`Unsupported attachment image type: "${relativePath}"`);
	}
	let bytes: Buffer;
	try {
		bytes = readFileSync(abs);
	} catch {
		throw new Error(`Attachment image not found: "${relativePath}", it may have been deleted`);
	}
	return { mediaType, base64: bytes.toString('base64') };
}

/** The data: URL form OpenAI-compatible APIs take in image_url content parts. */
export function imageDataUrl(relativePath: string): string {
	const { mediaType, base64 } = loadImage(relativePath);
	return `data:${mediaType};base64,${base64}`;
}
