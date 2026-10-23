import type { ReasoningTiming } from '$lib/types/chat';

/** A reply may interleave thinking and content. Keep the clock on the request, not its DOM. */
export function trackReasoning(
	timing: ReasoningTiming | null,
	kind: 'thinking' | 'content',
	at: number
): ReasoningTiming | null {
	if (kind === 'content') return timing ? { ...timing, active: false } : null;
	return { startedAt: timing?.startedAt ?? at, lastTokenAt: at, active: true };
}

export function reasoningDuration(timing: ReasoningTiming, now: number): number {
	return Math.max(0, (timing.active ? now : timing.lastTokenAt) - timing.startedAt);
}

export function reasoningLabel(active: boolean, durationMs: number | null): string {
	const seconds = durationMs === null ? null : Math.floor(Math.max(0, durationMs) / 1000);
	if (active) return seconds === null ? 'Thinking' : `Thinking • ${seconds}s`;
	return seconds === null ? 'Thought' : `Thought for ${seconds}s`;
}
