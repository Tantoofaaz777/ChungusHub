/** Template-local keys are documentation only, never globally reserved engine macros. */
export const TEMPLATE_MACROS = [
	{ name: 'idea', description: 'Your scene direction. Opening scene template only.' },
	{ name: 'steering', description: 'The joined steering notes. Steering wrapper template only.' },
	{ name: 'draft', description: 'The message being rewritten. Spellcheck and Impersonate templates only.' },
	{ name: 'perspective', description: 'The selected narrative person (first, second or third). Composer transform templates only.' },
	{ name: 'value', description: 'The entered text or slider number. Text and slider control output templates only.' },
	{ name: 'min', description: 'The lower selected number. Range control output templates only.' },
	{ name: 'max', description: 'The upper selected number. Range control output templates only.' }
] as const;

export interface ReferenceMacro {
	name: string;
	description: string;
	example?: string;
	structural?: boolean;
	parameterized?: boolean;
}

export function macroToken(macro: ReferenceMacro): string {
	return `{{${macro.example ?? macro.name}}}`;
}

function normalize(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Every search word can match either the spelling, the copied example or its meaning. */
export function matchesMacro(macro: ReferenceMacro, query: string): boolean {
	const text = normalize(`${macro.name} ${macroToken(macro)} ${macro.description}`);
	return normalize(query).trim().split(/\s+/).every((word) => text.includes(word));
}
