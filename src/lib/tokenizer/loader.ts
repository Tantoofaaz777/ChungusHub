export type EncodingName = 'o200k_base' | 'cl100k_base';
type Counter = (text: string) => number;
type EncodingModule = { countTokens: Counter };

/** A synchronous calculation can be resumed once this encoding finishes loading. */
export class TokenizerLoading extends Error {
	constructor(readonly ready: Promise<void>) { super('Loading token counter'); }
}

/** No vocabulary is imported until read/load first asks for it. One request per encoding. */
export function createEncodingLoader(imports: Record<EncodingName, () => Promise<EncodingModule>>) {
	const loaded = new Map<EncodingName, Counter>();
	const pending = new Map<EncodingName, Promise<void>>();
	const listeners = new Set<() => void>();
	function load(encoding: EncodingName): Promise<void> {
		if (loaded.has(encoding)) return Promise.resolve();
		const current = pending.get(encoding);
		if (current) return current;
		const request = Promise.resolve().then(imports[encoding]).then(module => {
			loaded.set(encoding, module.countTokens);
			pending.delete(encoding);
			for (const listener of listeners) listener();
		}, error => { pending.delete(encoding); throw error; });
		pending.set(encoding, request);
		return request;
	}
	return {
		load,
		read(encoding: EncodingName): Counter {
			const counter = loaded.get(encoding);
			if (!counter) throw new TokenizerLoading(load(encoding));
			return counter;
		},
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		}
	};
}

/** Retry a pure calculation after its missing encodings arrive; never replay sends/writes. */
export async function withTokenizers<T>(calculate: () => T | Promise<T>): Promise<T> {
	for (;;) {
		try { return await calculate(); }
		catch (error) {
			if (!(error instanceof TokenizerLoading)) throw error;
			await error.ready;
		}
	}
}
