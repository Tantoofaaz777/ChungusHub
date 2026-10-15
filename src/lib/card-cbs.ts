/** Character Card V3 curly-braced syntax, shared by display, prompts and lorebook scans. */
export type CardTextMode = 'prompt' | 'display' | 'scan' | 'recursive';

export function cardChoices(text: string): string[] {
	const parts = [''];
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '\\' && [',', '\\'].includes(text[i + 1])) parts[parts.length - 1] += text[++i];
		else if (c === ',') parts.push('');
		else parts[parts.length - 1] += c;
	}
	return parts.map((part) => part.trim());
}

function hash(text: string): number {
	let value = 2166136261;
	for (const c of text) value = Math.imul(value ^ c.codePointAt(0)!, 16777619);
	return value >>> 0;
}

export function resolveCardCbs(name: string, opts: { mode?: CardTextMode; seed?: string; rng?: () => number } = {}): string | undefined {
	const mode = opts.mode ?? 'prompt';
	if (name.trimStart().startsWith('//')) return '';
	const colon = name.indexOf(':');
	if (colon < 0) return undefined;
	const kind = name.slice(0, colon).trim().toLowerCase();
	const value = name.slice(colon + 1);
	if (kind === 'comment') return mode === 'display' ? `(${value.trim()})` : '';
	if (kind === 'hidden_key') return mode === 'recursive' ? ` ${value} ` : '';
	if (mode === 'scan' || mode === 'recursive') return undefined;
	if (kind === 'reverse') return Array.from(value).reverse().join('');
	if (kind === 'random' || kind === 'pick') {
		const choices = cardChoices(value);
		const index = kind === 'pick' ? hash(`${opts.seed ?? ''}\0${value}`) % choices.length
			: Math.min(choices.length - 1, Math.floor((opts.rng ?? Math.random)() * choices.length));
		return choices[index];
	}
	if (kind === 'roll') {
		const dice = /^d?([1-9]\d*)$/i.exec(value.trim());
		const sides = dice ? Number(dice[1]) : 0;
		if (!Number.isSafeInteger(sides) || sides < 1) return undefined;
		return String(Math.min(sides, Math.floor((opts.rng ?? Math.random)() * sides) + 1));
	}
	return undefined;
}

export function expandCardCbs(text: string, opts: { mode?: CardTextMode; seed?: string; rng?: () => number } = {}): string {
	return text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (whole, name: string) => resolveCardCbs(name, opts) ?? whole);
}

export function cardScanText(text: string, recursive = false): string {
	return expandCardCbs(text, { mode: recursive ? 'recursive' : 'scan' });
}
