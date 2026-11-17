import { MACROS } from '#lib/macros.ts';
import { resolveCardCbs } from '#lib/card-cbs.ts';

/** Template-local keys are documentation only, never globally reserved engine macros. */
export const TEMPLATE_MACROS = [
	{ name: 'idea', description: 'Your scene direction. Opening scene template only.' },
	{ name: 'steering', description: 'The joined steering notes. Steering wrapper template only.' },
	{ name: 'draft', description: 'The message being rewritten. Spellcheck and Impersonate templates only.' },
	{ name: 'value', description: 'The entered text or slider number. Text and slider control output templates only.' },
	{ name: 'min', description: 'The lower selected number. Range control output templates only.' },
	{ name: 'max', description: 'The upper selected number. Range control output templates only.' }
] as const;

export type MacroReferenceScope = 'identity' | 'standalone' | 'lorebook' | 'preset';

/** Show only the macros the field can resolve, without unreserving legacy names. */
export function macrosForScope(scope: MacroReferenceScope) {
	return MACROS.filter(macro => {
		if (!macro.engine || macro.name === 'memory') return false;
		if (['names', 'persona-pronoun'].includes(macro.group)) return true;
		if (macro.name === 'hidden_key:text') return scope === 'lorebook';
		if (macro.parameterized && resolveCardCbs(macro.example ?? macro.name, { rng: () => 0 }) !== undefined) return true;
		if (scope === 'identity') return false;
		if (scope === 'preset') return true;
		if (macro.structural || macro.name === 'lorebook' || macro.name === 'outlet::name') return false;
		return scope === 'lorebook' || macro.name !== 'authorsNote';
	});
}

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
