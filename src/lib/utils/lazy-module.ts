/** Share a first load across instances. Failed requests can be retried. */
export function lazyModule<T>(load: () => Promise<T>): () => Promise<T> {
	let pending: Promise<T> | null = null;
	return () => pending ??= Promise.resolve().then(load).catch((error) => {
		pending = null;
		throw error;
	});
}
