/**
 * Portrait framing: where every avatar box aims inside a character's picture.
 *
 * The library stores a focal point and a zoom, never cropped bytes, because one portrait
 * is shown at several aspect ratios at the same time (2:3 and 1:1 chat avatars, 3:4
 * browse cards, circular browse-list thumbnails), and the chat's own silhouette is a setting the reader
 * can change long after the framing was authored. A baked rectangle is right in one box
 * and wrong in the rest, and it would be re-cropped by every box that disagrees with it.
 * A focal point resolves correctly in any box, the original file is never touched, and a
 * framing can always be reopened and moved.
 *
 * `object-fit: cover` guarantees the picture is at least as large as its box in both
 * axes, so any focal point in 0..1 at any zoom >= 1 still covers the box: there is no
 * combination of these numbers that can leave a gap.
 */

export interface PortraitFocus {
	/** Focal point across the picture: 0 is the left edge, 1 the right. */
	x: number;
	/** Focal point down the picture: 0 is the top edge, 1 the bottom. */
	y: number;
	/** Magnification over the plain cover fit. 1 shows the whole cover crop. */
	zoom: number;
}

/** Dead centre at no magnification, which is exactly what an unframed portrait renders as. */
export const DEFAULT_PORTRAIT_FOCUS: PortraitFocus = { x: 0.5, y: 0.5, zoom: 1 };

/** Past this the stored art (2048px long edge, and an 800px thumbnail in most boxes) runs
 *  out of pixels before the frame runs out of room. */
export const MAX_PORTRAIT_ZOOM = 3;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Round for a style string / a stored row: three decimals is finer than any frame can show. */
function tidy(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/** The one gate on what may be written as a framing. The dialog is the only writer, so
 *  render-time code trusts the numbers it reads rather than re-checking them. */
export function clampPortraitFocus(focus: PortraitFocus): PortraitFocus {
	return {
		x: tidy(clamp(focus.x, 0, 1)),
		y: tidy(clamp(focus.y, 0, 1)),
		zoom: tidy(clamp(focus.zoom, 1, MAX_PORTRAIT_ZOOM))
	};
}

/** Whether this framing is the shipped centred cover, and so worth storing as nothing. */
export function isDefaultPortraitFocus(focus: PortraitFocus): boolean {
	return (
		focus.x === DEFAULT_PORTRAIT_FOCUS.x &&
		focus.y === DEFAULT_PORTRAIT_FOCUS.y &&
		focus.zoom === DEFAULT_PORTRAIT_FOCUS.zoom
	);
}

/**
 * Aim only: the focal point, plus `--portrait-zoom` for a caller that writes its own
 * `transform`. The browse cards use this: their portraits already scale on hover, and an
 * inline transform here would beat that rule and freeze the animation.
 */
export function portraitFocusAim(focus: PortraitFocus | undefined): string {
	if (!focus) return '';
	const x = tidy(focus.x * 100);
	const y = tidy(focus.y * 100);
	return `object-position:${x}% ${y}%;transform-origin:${x}% ${y}%;--portrait-zoom:${focus.zoom};`;
}

/** The whole framing for a portrait `<img>` in a cover-fit box. Empty for an unframed
 *  portrait, which leaves the box on the browser's own centred cover. */
export function portraitFocusStyle(focus: PortraitFocus | undefined): string {
	if (!focus) return '';
	return `${portraitFocusAim(focus)}transform:scale(${focus.zoom});`;
}

/**
 * Where the picture actually lands inside a frame, in that frame's own coordinates
 * (origin at its top-left, negative values reaching outside it).
 *
 * This is the same geometry `portraitFocusStyle` hands the browser, written out in
 * numbers. The framing dialog draws its dimmed surroundings from it, so what it shows
 * around the window and what the browser clips inside it cannot disagree.
 */
export function portraitDrawRect(
	focus: PortraitFocus,
	natural: { width: number; height: number },
	frame: { width: number; height: number }
): { left: number; top: number; width: number; height: number } {
	const cover = Math.max(frame.width / natural.width, frame.height / natural.height);
	const width = natural.width * cover * focus.zoom;
	const height = natural.height * cover * focus.zoom;
	return {
		left: focus.x * (frame.width - width),
		top: focus.y * (frame.height - height),
		width,
		height
	};
}

/**
 * The focal point that puts the picture where a drag left it: the inverse of
 * `portraitDrawRect`'s left/top. A frame the picture exactly fills on one axis cannot be
 * panned along it, and pins to centre rather than dividing by zero.
 */
export function portraitFocusFromDrawOffset(
	offset: { left: number; top: number },
	zoom: number,
	natural: { width: number; height: number },
	frame: { width: number; height: number }
): PortraitFocus {
	const cover = Math.max(frame.width / natural.width, frame.height / natural.height);
	const slackX = frame.width - natural.width * cover * zoom;
	const slackY = frame.height - natural.height * cover * zoom;
	return clampPortraitFocus({
		x: slackX === 0 ? 0.5 : offset.left / slackX,
		y: slackY === 0 ? 0.5 : offset.top / slackY,
		zoom
	});
}
