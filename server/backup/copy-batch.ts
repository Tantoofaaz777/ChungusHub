/** Settle every active copy before cleanup or a restore retry can touch its destinations. */
export async function mapLimit<T>(items: T[], limit: number, copy: (item: T) => Promise<void>): Promise<void> {
	let next = 0, failed = false;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (!failed) {
			const index = next++;
			if (index >= items.length) return;
			try { await copy(items[index]); }
			catch (error) { failed = true; throw error; }
		}
	});
	const results = await Promise.allSettled(workers);
	const failure = results.find(result => result.status === 'rejected');
	if (failure?.status === 'rejected') throw failure.reason;
}
