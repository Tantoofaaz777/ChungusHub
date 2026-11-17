/** A persona version owns only the description. The remaining trait fields make its
 *  row compatible with the library's version format. */
export function personaVersionData(data: unknown) {
	const description = (data as { traits?: { description?: unknown } } | null)?.traits?.description;
	return { traits: { description: typeof description === 'string' ? description : '', personality: '', background: '' } };
}

export function readPersonaVersionClaim(raw: unknown): { persona: string; version: string | null } | null {
	if (typeof raw !== 'string') return null;
	let state: { persona?: unknown; personaVersion?: unknown } | null;
	try { state = JSON.parse(raw); } catch { return null; }
	if (typeof state?.persona !== 'string' || !state.persona) return null;
	return { persona: state.persona, version: typeof state.personaVersion === 'string' && state.personaVersion ? state.personaVersion : null };
}
