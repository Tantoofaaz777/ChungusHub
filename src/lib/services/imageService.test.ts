import { describe, expect, test } from 'bun:test';
import { imageRejectionReason, isImageFile } from './imageService';

describe('JFIF image selection', () => {
	test.each(['image/jpeg', 'image/jfif', 'image/pjpeg', '', 'application/octet-stream'])('accepts JFIF with MIME type "%s"', type => {
		const file = new File(['image bytes'], 'portrait.JFIF', { type });
		expect(isImageFile(file)).toBe(true);
		expect(imageRejectionReason(file)).toBeNull();
	});
	test('still rejects documents, misleading names and oversized images', () => {
		for (const file of [new File(['text'], 'file.json'), new File(['text'], 'file.jfif.json'), new File(['text'], 'file.jfif', { type: 'text/html' })]) {
			expect(isImageFile(file)).toBe(false);
			expect(imageRejectionReason(file)).not.toBeNull();
		}
		expect(imageRejectionReason(new File(['<svg/>'], 'file.jfif', { type: 'image/svg+xml' }))).toContain('SVG');
		expect(imageRejectionReason(new File([new Uint8Array(26 * 1024 * 1024)], 'large.jfif'))).toContain('limit');
	});
});
