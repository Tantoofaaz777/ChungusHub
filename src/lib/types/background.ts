/**
 * The workspace background picture and its two readability knobs.
 *
 * Import-free because a background is stored both as the app-wide setting and inside a
 * chat's own scene, and both readers have to agree on
 * what a corrupt value degrades to.
 */

export interface BackgroundConfig {
	/** /files/-relative image path (e.g. backgrounds/foo.jpg), or null for none. */
	path: string | null;
	/** How strongly the image is darkened, 0..0.9. Plain black on every palette:
	 *  the scrim is photographic, not part of the app's surface language, so the
	 *  theme has no say in it (architecture/ui-shell-settings.md). */
	dim: number;
	/** Gaussian blur over the image, 0..24 px. */
	blur: number;
}

export const DEFAULT_BACKGROUND: BackgroundConfig = {
	path: null,
	dim: 0.35,
	blur: 0
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, value));
}

export function normalizeBackgroundConfig(parsed: unknown): BackgroundConfig {
	if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_BACKGROUND };
	const stored = parsed as Partial<BackgroundConfig>;
	return {
		path: typeof stored.path === 'string' && stored.path ? stored.path : null,
		dim: clampNumber(stored.dim, 0, 0.9, DEFAULT_BACKGROUND.dim),
		blur: clampNumber(stored.blur, 0, 24, DEFAULT_BACKGROUND.blur)
	};
}
