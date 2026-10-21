import { onDestroy } from 'svelte';
import { countTokens } from '$lib/tokenizer';
import { tokenEstimate } from '$lib/tokenizer/reactive.svelte';
import { requireTokenizer } from '$lib/tokenizer/encodings';
import { LiveTokenCounter } from './live-token-counter';

/** Live estimates update at most five times a second; settled text counts immediately. */
export function liveTokenCount(options: {
	text: () => string;
	enabled: () => boolean;
	streaming: () => boolean;
	identity: () => unknown;
	model?: () => string | undefined;
}) {
	let value = $state<number | null>(0);
	// Keep the existing stream throttle. Missing vocabularies retry through the reactive
	// effect, not from its delayed timer, so the timer never leaks a loading exception.
	const counter = new LiveTokenCounter(countTokens, next => { value = next; });
	$effect(() => {
		if (!options.enabled()) { counter.update({ enabled: false }); return; }
		const streaming = options.streaming();
		const text = options.text(), model = options.model?.();
		if (tokenEstimate(() => { if (text) requireTokenizer(model); return true; }) === null) {
			counter.update({ enabled: false }); value = null; return;
		}
		counter.update({ enabled: true, text, model, streaming,
			identity: streaming ? options.identity() : null });
	});
	onDestroy(() => counter.dispose());
	return { get value() { return value; } };
}
