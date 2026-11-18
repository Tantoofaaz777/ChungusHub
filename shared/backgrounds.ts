export interface BackgroundEntry {
	path: string;
	name: string;
	source: 'default' | 'custom';
	/** Present when a dedicated thumbnail is available for the picker. */
	previewPath?: string;
}

/** Include the original extension so files with the same stem get distinct previews. */
export function bundledBackgroundPreviewPath(filename: string): string {
	return `backgrounds/thumbnails/${filename}.webp`;
}
