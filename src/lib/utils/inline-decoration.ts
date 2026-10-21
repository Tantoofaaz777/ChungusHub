/**
 * Formatting for rendered model output and display regex replacements. Typography and
 * decoration have bounded values; positioning, layout modes, resources, variables and
 * arbitrary CSS functions remain outside this boundary. Pure for DOM-free tests.
 * Keep the `property: value` / `; ` serialization: app.css reads explicit colours back.
 */
const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9a-z.,%\s/+-]+\)|[a-z]+)$/i;
const LENGTH_VALUE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(px|em|rem|%)?$/i;
type Bounds = Record<string, readonly [number, number]>;
const SPACING: Bounds = { px: [0, 64], em: [0, 4], rem: [0, 4] };
const FONT_SIZE: Bounds = { px: [8, 64], em: [0.5, 3], rem: [0.5, 4], '%': [50, 300] };
const BORDER_WIDTH: Bounds = { px: [0, 8], em: [0, 0.5], rem: [0, 0.5] };
const RADIUS: Bounds = { ...SPACING, '%': [0, 50] };
const BORDER_STYLES = new Set(['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);
const DECORATION_STYLES = new Set(['solid', 'double', 'dotted', 'dashed', 'wavy']);

/** A colour, never a variable, URL or nested function. Unknown keywords are inert CSS. */
export function isDecorationColor(value: string): boolean {
	return COLOR_VALUE.test(value.trim());
}

function length(value: string, bounds: Bounds): boolean {
	const match = LENGTH_VALUE.exec(value);
	if (!match) return false;
	const n = Number(match[1]);
	const unit = match[2]?.toLowerCase();
	if (!unit) return n === 0 && Object.values(bounds).some(([min, max]) => min <= 0 && max >= 0);
	const range = bounds[unit];
	return !!range && Number.isFinite(n) && n >= range[0] && n <= range[1];
}

/** Split outside colour/gradient functions. Reject unbalanced parentheses up front. */
function split(value: string, separator: ',' | ' '): string[] {
	const parts: string[] = [];
	let depth = 0, start = 0;
	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		if (char === '(' && ++depth > 3) return [];
		if (char === ')' && --depth < 0) return [];
		if (depth === 0 && (separator === ' ' ? /\s/.test(char) : char === separator)) {
			const part = value.slice(start, i).trim();
			if (part || separator === ',') parts.push(part);
			start = i + 1;
		}
	}
	if (depth !== 0) return [];
	const last = value.slice(start).trim();
	if (last || separator === ',') parts.push(last);
	return parts;
}

function sequence(value: string, validator: (part: string) => boolean, max = 4): boolean {
	const parts = split(value, ' ');
	return parts.length > 0 && parts.length <= max && parts.every(validator);
}

function fontFamily(value: string): boolean {
	const families = value.split(',').map(part => part.trim());
	return families.length <= 8 && families.every(family =>
		/^(?:[\p{L}_][\p{L}\p{N}_ -]*|"[\p{L}\p{N}_ -]+"|'[\p{L}\p{N}_ -]+')$/u.test(family));
}

function angle(value: string): boolean {
	return /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|rad|turn)$/i.test(value) &&
		Math.abs(parseFloat(value)) <= 3600;
}

function gradient(value: string): boolean {
	const match = /^(linear|radial|conic)-gradient\(([\s\S]*)\)$/i.exec(value);
	if (!match) return false;
	const kind = match[1].toLowerCase();
	const stops = split(match[2], ',');
	if (stops.length < 2 || stops.length > 17) return false;
	// A bounded, resource-free prelude. Invalid combinations are ignored by the browser.
	const prelude = stops[0].toLowerCase().replace(/\s+/g, ' ');
	const direction = /^to (?:left|right|top|bottom)(?: (?:left|right|top|bottom))?$/.test(prelude);
	const shape = sequence(prelude, part =>
		/^(?:circle|ellipse|at|center|top|bottom|left|right|closest-side|farthest-side|closest-corner|farthest-corner|from)$/.test(part) ||
		length(part, { px: [0, 1000], em: [0, 64], rem: [0, 64], '%': [0, 100] }) || angle(part), 8);
	if ((kind === 'linear' && (direction || angle(prelude))) || (kind !== 'linear' && shape)) stops.shift();
	if (stops.length < 2) return false;
	return stops.every(stop => {
		const parts = split(stop, ' ');
		return parts.length >= 1 && parts.length <= 3 && isDecorationColor(parts[0]) &&
			parts.slice(1).every(part => length(part, { px: [0, 1000], em: [0, 64], rem: [0, 64], '%': [0, 100] }) || (kind === 'conic' && angle(part)));
	});
}

function background(value: string, imageOnly: boolean): boolean {
	if (value.toLowerCase() === 'none') return true;
	if (!imageOnly && isDecorationColor(value)) return true;
	const layers = split(value, ',');
	return layers.length > 0 && layers.length <= 4 && layers.every(gradient);
}

function border(value: string): boolean {
	const parts = split(value, ' ');
	if (parts.length < 1 || parts.length > 3) return false;
	const seen = new Set<string>();
	return parts.every(part => {
		const lower = part.toLowerCase();
		const kind = length(part, BORDER_WIDTH) || /^(?:thin|medium|thick)$/.test(lower) ? 'width'
			: BORDER_STYLES.has(lower) ? 'style' : isDecorationColor(part) ? 'color' : null;
		if (!kind || seen.has(kind)) return false;
		seen.add(kind);
		return true;
	});
}

function allowedValue(property: string, value: string): string | null {
	const lower = value.toLowerCase();
	let valid = false;
	switch (property) {
		case 'color': case 'background-color': case 'text-decoration-color':
			valid = isDecorationColor(value); break;
		case 'font-size': {
			// Absolute clamps bound nested relative sizes. Recognise our own output so
			// sanitizing the result a second time preserves the same safe declaration.
			const inner = /^clamp\(8px, ([^,]+), 64px\)$/.exec(value)?.[1] ?? value;
			return length(inner, FONT_SIZE) ? `clamp(8px, ${inner}, 64px)` : null;
		}
		case 'font-family': valid = value.length <= 256 && fontFamily(value); break;
		case 'font-weight': valid = /^(?:normal|bold|lighter|bolder)$/.test(lower) || (/^\d{1,4}$/.test(value) && +value >= 1 && +value <= 1000); break;
		case 'font-style': valid = /^(?:normal|italic|oblique)$/.test(lower); break;
		case 'font-variant': valid = /^(?:normal|small-caps)$/.test(lower); break;
		case 'text-align': valid = /^(?:left|right|center|justify|start|end)$/.test(lower); break;
		case 'text-transform': valid = /^(?:none|capitalize|uppercase|lowercase|full-width)$/.test(lower); break;
		case 'line-height':
			valid = lower === 'normal' || (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && +value >= 1 && +value <= 3) ||
				length(value, { px: [12, 128], em: [1, 3], rem: [0.75, 8], '%': [100, 300] }); break;
		case 'letter-spacing':
			valid = lower === 'normal' || length(value, { px: [-2, 8], em: [-0.1, 0.5], rem: [-0.125, 0.5] }); break;
		case 'word-spacing': valid = lower === 'normal' || length(value, { px: [0, 16], em: [0, 1], rem: [0, 1] }); break;
		case 'text-decoration': case 'text-decoration-line':
			valid = sequence(lower, part => /^(?:none|underline|overline|line-through)$/.test(part), 3); break;
		case 'text-decoration-style': valid = DECORATION_STYLES.has(lower); break;
		case 'text-decoration-thickness': case 'text-underline-offset':
			valid = lower === 'auto' || (property === 'text-decoration-thickness' && lower === 'from-font') || length(value, BORDER_WIDTH); break;
		case 'background': case 'background-image': valid = background(value, property === 'background-image'); break;
		case 'padding': case 'padding-inline': case 'padding-block':
			valid = sequence(value, part => length(part, SPACING), property === 'padding' ? 4 : 2); break;
		case 'margin': case 'margin-inline': case 'margin-block':
			valid = sequence(value, part => part.toLowerCase() === 'auto' || length(part, SPACING), property === 'margin' ? 4 : 2); break;
		case 'border-radius': {
			const axes = value.split('/');
			valid = axes.length <= 2 && axes.every(axis => sequence(axis.trim(), part => length(part, RADIUS))); break;
		}
		default:
			if (/^(?:padding|margin)-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end)$/.test(property)) {
				valid = (property.startsWith('margin-') && lower === 'auto') || length(value, SPACING);
			} else if (/^border(?:-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end))?$/.test(property)) {
				valid = border(value);
			} else if (/^border(?:-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end))?-(?:color|style|width)$/.test(property)) {
				const max = /^border-(?:color|style|width)$/.test(property) ? 4 : 1;
				valid = sequence(value, part => property.endsWith('-color') ? isDecorationColor(part)
					: property.endsWith('-style') ? BORDER_STYLES.has(part.toLowerCase())
					: length(part, BORDER_WIDTH) || /^(?:thin|medium|thick)$/.test(part.toLowerCase()), max);
			} else if (/^border-(?:(?:top|bottom)-(?:left|right)|(?:start|end)-(?:start|end))-radius$/.test(property)) {
				valid = sequence(value, part => length(part, RADIUS), 2);
			}
	}
	return valid ? value : null;
}

/** Rebuild surviving declarations; never pass unknown CSS or unparsed text through. */
export function sanitizeDecorations(style: string): string {
	if (style.length > 8192) return '';
	const kept: string[] = [];
	for (const declaration of style.split(';')) {
		const colon = declaration.indexOf(':');
		if (colon === -1) continue;
		const property = declaration.slice(0, colon).trim().toLowerCase();
		const value = declaration.slice(colon + 1).replace(/!\s*important/gi, '').trim();
		if (!value || value.length > 2048 || /[\\{}<>@]|\/\*|\*\//.test(value)) continue;
		const safe = allowedValue(property, value);
		if (safe !== null) kept.push(`${property}: ${safe}`);
	}
	return kept.join('; ');
}
