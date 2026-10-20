/** Shared retention policy for persisted requests and every live inspector. */
export const DEFAULT_PROMPT_LOG_LIMIT = 10;
export const MAX_PROMPT_LOG_LIMIT = 1000;

export function validPromptLogLimit(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value)
		&& value >= 1 && value <= MAX_PROMPT_LOG_LIMIT;
}
