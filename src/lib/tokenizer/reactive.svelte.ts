import { createSubscriber } from 'svelte/reactivity';
import { onEncodingReady } from './encodings';
import { TokenizerLoading } from './loader';
import { toastStore } from '$lib/stores/toast.svelte';

const subscribe = createSubscriber(onEncodingReady);
const observed = new WeakSet<Promise<void>>();

/** Keep counts unknown while loading. Rerun reactive consumers when an encoding arrives. */
export function tokenEstimate<T>(calculate: () => T): T | null {
	subscribe();
	try { return calculate(); }
	catch (error) {
		if (!(error instanceof TokenizerLoading)) throw error;
		if (!observed.has(error.ready)) {
			observed.add(error.ready);
			void error.ready.catch(cause => toastStore.failed('load token counter', cause));
		}
		return null;
	}
}
