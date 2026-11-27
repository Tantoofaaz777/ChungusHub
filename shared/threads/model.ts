import { buildThreadsPrompt, groupConsecutiveStoryRanges, installmentOrRoundLabel } from './prompt';
import { serializeFeedForContinuity } from './feed';
import type { ThreadsMessage, ThreadsRound } from './types';
import type { Ao3Information } from './ao3';

/** Shipped fandom instructions, editable in Settings → Engines → Threads. */
export const DEFAULT_THREADS_INSTRUCTIONS = `You must simulate a Reddit thread reacting to this story as if it were a fanfic on AO3.

[Guidelines]
- **Previous context** contains events from previous chapters that people have already read.
- **Recent context** is the new chapter the current discussion is focusing on.
- Use **Fandom continuity** to preserve recurring usernames, theories, opinions, jokes, or beefs from earlier threads.

[Rules]
- People may disagree, beef with each other, swear, have morally wrong opinions, criticize the story, etc.
- People may use internet slang and contractions.
- **Never** mention the POV switch in {{user}}'s messages\u2014they're by design.
- Do **not** use markdown. Quote marks (") are allowed.`;

export interface ThreadsConfig {
	previousRounds: number;
	summarizeOlderRounds: boolean;
	fandomThreads: number;
}
export const DEFAULT_THREADS_CONFIG: ThreadsConfig = {
	previousRounds: 3,
	summarizeOlderRounds: false,
	fandomThreads: 3
};
export function normalizeThreadsConfig(raw: Partial<ThreadsConfig> | null): ThreadsConfig {
	const limit = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? Math.min(50, Math.max(0, Math.floor(n))) : fallback;
	return {
		previousRounds: limit(raw?.previousRounds, DEFAULT_THREADS_CONFIG.previousRounds),
		summarizeOlderRounds: raw?.summarizeOlderRounds === true,
		fandomThreads: limit(raw?.fandomThreads, DEFAULT_THREADS_CONFIG.fandomThreads)
	};
}

/** A branch inherits only whole scenes on its own path; partial scenes never consume turns. */
export function threadsOnPath(rounds: ThreadsRound[], path: { id: string; selectedVariantId?: string; content?: string; role?: string }[]): ThreadsRound[] {
	const ids = new Map(path.map(m => [m.id, m]));
	return rounds.filter(r => r.messages.length > 0 && r.messages.every(m => ids.has(m.id) &&
		(!m.variantId || m.variantId === ids.get(m.id)!.selectedVariantId &&
			(ids.get(m.id)!.content === undefined || ids.get(m.id)!.content === m.content) &&
			(ids.get(m.id)!.role === undefined || ids.get(m.id)!.role === m.role))));
}

/** Overlap is safe only when the two complete scenes cannot coexist on any branch. */
export function threadsSelectionOverlaps(rounds: ThreadsRound[], selected: { id: string }[], path: { id: string; selectedVariantId?: string }[], all: { id: string; parentId: string | null }[]): boolean {
	const selectedIds = new Set(selected.map(m => m.id)), pathIds = new Set(path.map(m => m.id));
	const byId = new Map(all.map(m => [m.id, m]));
	return rounds.some(round => {
		if (round.messages.some(message => message.variantId && path.some(turn => turn.id === message.id && turn.selectedVariantId !== message.variantId))) return false;
		if (!round.messages.some(m => selectedIds.has(m.id))) return false;
		if (round.messages.every(m => pathIds.has(m.id))) return true;
		const oldPath = new Set<string>();
		for (let id: string | null = round.messages.at(-1)?.id ?? null; id && !oldPath.has(id); ) {
			const message = byId.get(id);
			if (!message) break;
			oldPath.add(id); id = message.parentId;
		}
		return round.messages.every(m => oldPath.has(m.id)) && selected.every(m => oldPath.has(m.id));
	});
}

/** Select sparsely, but always in transcript order. Hidden messages remain eligible. */
export function selectThreadsMessages<T extends { id: string }>(path: T[], ids: string[], used: Set<string>): T[] {
	if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => used.has(id))) throw new Error('Select unused messages for this thread.');
	const wanted = new Set(ids), selected = path.filter(m => wanted.has(m.id));
	if (selected.length !== ids.length) throw new Error('Selected messages are no longer available on this branch.');
	return selected;
}
export function activeThreadsFeed(round: ThreadsRound) {
	return round.versions.find(v => v.id === round.activeVersionId)!.feed;
}

export function threadsStoryWindow(previous: ThreadsRound[], config: ThreadsConfig) {
	const fullPrevious = Math.max(0, config.previousRounds - Number(config.summarizeOlderRounds));
	const start = Math.max(0, previous.length - fullPrevious);
	return {
		older: config.summarizeOlderRounds ? previous.slice(0, start) : [],
		full: previous.slice(start)
	};
}

export function threadsPrompt(input: {
	messages: ThreadsMessage[]; label: string; previous: ThreadsRound[]; notes: string;
	ao3: Ao3Information; instructions: string; config: Partial<ThreadsConfig>;
}): string {
	const config = normalizeThreadsConfig(input.config);
	const messageText = (m: ThreadsMessage) => m.content;
	const labels = new Map(input.previous.map((r, index) => [r.id, installmentOrRoundLabel(r.label, index + 1)]));
	const label = (r: ThreadsRound) => labels.get(r.id)!;
	const { older, full } = threadsStoryWindow(input.previous, config);
	const summaries = older.flatMap(r => r.summary ? [{ label: label(r), content: `Summary:\n${r.summary}` }] : []);
	const fullRanges = groupConsecutiveStoryRanges(full.map(r => ({ label: label(r), content: r.messages.map(messageText).join('\n\n') })));
	const previousFeeds = input.previous.slice(Math.max(0, input.previous.length - config.fandomThreads));
	const fandomContinuity = previousFeeds.map(r => ({ label: label(r), content: serializeFeedForContinuity(activeThreadsFeed(r)) }));
	return buildThreadsPrompt({
		recentRange: { label: input.label.trim() || 'CURRENT RANGE', content: input.messages.map(messageText).join('\n\n') },
		previousRanges: [...summaries, ...fullRanges], fandomContinuity,
		fandomNotes: input.notes, ao3Information: input.ao3, instructions: input.instructions
	});
}
