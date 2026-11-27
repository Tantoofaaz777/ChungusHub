import type { PortraitFocus } from '../src/lib/utils/portrait-focus';

export interface PersonaPortrait {
	imageUrl: string;
	portraitFocus?: PortraitFocus;
}

export function normalizePersonaPortrait(raw: unknown): PersonaPortrait | null {
	if (!raw || typeof raw !== 'object') return null;
	const { imageUrl, portraitFocus: focus } = raw as Partial<PersonaPortrait>;
	if (typeof imageUrl !== 'string' || !/^images\/personas\/[^/\\\x00-\x1f]+\.(?:png|jpe?g|jfif|webp|gif|avif)$/i.test(imageUrl)) return null;
	const framed = focus && Number.isFinite(focus.x) && focus.x >= 0 && focus.x <= 1 &&
		Number.isFinite(focus.y) && focus.y >= 0 && focus.y <= 1 && Number.isFinite(focus.zoom) && focus.zoom >= 1 && focus.zoom <= 3;
	return { imageUrl, ...(framed ? { portraitFocus: { x: focus.x, y: focus.y, zoom: focus.zoom } } : {}) };
}

export function readPersonaVersionPortrait(data: unknown): PersonaPortrait | null {
	return normalizePersonaPortrait((data as { personaPortrait?: unknown } | null)?.personaPortrait);
}

/** Description saves preserve the version's separately edited portrait. */
export function personaVersionData(data: unknown, portrait?: PersonaPortrait | null) {
	const description = (data as { traits?: { description?: unknown } } | null)?.traits?.description;
	return {
		traits: { description: typeof description === 'string' ? description : '', personality: '', background: '' },
		...(portrait ? { personaPortrait: portrait } : {})
	};
}

export function readPersonaVersionClaim(raw: unknown): { persona: string; version: string | null } | null {
	if (typeof raw !== 'string') return null;
	let state: { persona?: unknown; personaVersion?: unknown } | null;
	try { state = JSON.parse(raw); } catch { return null; }
	if (typeof state?.persona !== 'string' || !state.persona) return null;
	return { persona: state.persona, version: typeof state.personaVersion === 'string' && state.personaVersion ? state.personaVersion : null };
}
