import { referencesMacro, STRUCTURAL_MACROS } from '#lib/macros.ts';
import type { PromptItem } from '#lib/types/database.ts';

export function validPromptDepth(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function supportsPromptDepth(content: string): boolean {
	return !STRUCTURAL_MACROS.some(macro => referencesMacro(content, macro));
}

/** Structural containers cannot inject themselves back into their own history. */
export function promptItemDepth(item: Pick<PromptItem, 'content' | 'depth'>): number | undefined {
	return validPromptDepth(item.depth) && supportsPromptDepth(item.content) ? item.depth : undefined;
}
