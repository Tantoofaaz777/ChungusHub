import { onDestroy } from 'svelte';
import { countTokens } from '$lib/tokenizer';
import { LiveTokenCounter } from './live-token-counter';

/** Live estimates update at most five times a second; settled text counts immediately. */
export function liveTokenCount(options: {
	text: () => string;
	enabled: () => boolean;
	streaming: () => boolean;
	identity: () => unknown;
	model?: () => string | undefined;
}) {
	let value = $state(0);
	const counter = new LiveTokenCounter(countTokens, next => { value = next; });
	$effect(() => {
		if (!options.enabled()) { counter.update({ enabled: false }); return; }
		const streaming = options.streaming();
		counter.update({ enabled: true, text: options.text(), model: options.model?.(), streaming,
			identity: streaming ? options.identity() : null });
	});
	onDestroy(() => counter.dispose());
	return { get value() { return value; } };
}
