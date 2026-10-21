/**
 * Model-aware token counting (encoding only, no calibration). Kept rune-free and dependency
 * -light so it can be imported anywhere, including unit tests and the pure prompt assembler.
 */

import { encodingCount, resolveEncoding } from './encodings';

/** Token count of `text` under the model's encoding. For nonempty text, first prepare the
 * encoding or call through withTokenizers (actions) / tokenEstimate (reactive views). */
export function countTokens(text: string, model?: string): number {
	return encodingCount(text, resolveEncoding(model));
}

/** Sum of message contents under the model's encoding. */
export function countMessages(messages: { content: string }[], model?: string): number {
	let total = 0;
	for (const m of messages) total += countTokens(m.content, model);
	return total;
}
