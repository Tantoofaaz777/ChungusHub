/** A live timer tied to the request, with no interval while its readout is hidden. */
export function liveGenerationTime(options: {
	startedAt: () => number | null;
	enabled: () => boolean;
}) {
	let now = $state(Date.now());
	const value = $derived.by(() => {
		if (!options.enabled()) return null;
		const startedAt = options.startedAt();
		return startedAt === null ? null : Math.max(0, now - startedAt);
	});
	$effect(() => {
		if (!options.enabled() || options.startedAt() === null) return;
		now = Date.now();
		const id = setInterval(() => (now = Date.now()), 100);
		return () => clearInterval(id);
	});
	return { get value() { return value; } };
}
