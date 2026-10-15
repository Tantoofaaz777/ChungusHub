/** Parse a complete numeric draft. Empty/unfinished input must never become a saved zero.
 * Token fields also accept pasted thousands separators; fractional controls accept either
 * decimal separator and snap to the same step as their slider. */
export function parseSliderValue(raw: string, min: number, max: number, step: number, groupedInteger = false): number | null {
	let text = raw.trim();
	if (groupedInteger) {
		if (/^[+-]?\d{1,3}(?:[.,\s]\d{3})+$/.test(text)) text = text.replace(/[.,\s]/g, '');
		else if (!/^[+-]?\d+$/.test(text)) return null;
	} else {
		text = text.replace(',', '.');
		if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
	}
	const value = Number(text);
	if (!Number.isFinite(value)) return null;
	const bounded = Math.min(max, Math.max(min, value));
	const precision = String(step).split('.')[1]?.length ?? 0;
	const scaled = (bounded - min) / step;
	const snapped = min + Math.round(scaled + Number.EPSILON * Math.max(1, Math.abs(scaled))) * step;
	return Math.min(max, Math.max(min, Number(snapped.toFixed(precision))));
}
