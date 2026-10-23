export const REASONING_DEPTH_MAX = 1000;
export const DEFAULT_REASONING_RETENTION = { autoClearReasoning: false, reasoningDepth: 10 };

/** Shared by settings and the server that actually removes the stored text. */
export function normalizeReasoningRetention(raw: unknown) {
	const value = raw as Partial<typeof DEFAULT_REASONING_RETENTION> | null;
	return {
		autoClearReasoning: value?.autoClearReasoning === true,
		reasoningDepth: typeof value?.reasoningDepth === 'number' && Number.isFinite(value.reasoningDepth)
			? Math.max(0, Math.min(REASONING_DEPTH_MAX, Math.round(value.reasoningDepth)))
			: DEFAULT_REASONING_RETENTION.reasoningDepth
	};
}

export function parseReasoningRetention(raw: string | null) {
	try { return normalizeReasoningRetention(raw ? JSON.parse(raw) : null); }
	catch { return normalizeReasoningRetention(null); }
}
