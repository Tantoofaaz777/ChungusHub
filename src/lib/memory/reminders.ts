import type { ResolvedScene, SceneMessage } from '#shared/memory-scenes.ts';

export const DEFAULT_MEMORY_REMINDER_INTERVAL = 20_000;

export function normalizeReminderInterval(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.min(2_000_000, Math.max(1, Math.floor(value)))
		: DEFAULT_MEMORY_REMINDER_INTERVAL;
}

export interface MemoryReminderCheckpoint {
	/** The first message to cross this threshold, so common history stays acknowledged. */
	anchorId: string;
	boundaryId: string | null;
	interval: number;
	threshold: number;
}

export interface MemoryReminderProgress {
	/** Copies/imports with remapped messages start their own reminder history. */
	chatId: string;
	checkpoints: MemoryReminderCheckpoint[];
}

export function normalizeReminderProgress(raw: unknown): MemoryReminderProgress | undefined {
	if (!raw || typeof raw !== 'object') return;
	const value = raw as Partial<MemoryReminderProgress>;
	if (typeof value.chatId !== 'string' || !value.chatId || !Array.isArray(value.checkpoints)) return;
	const checkpoints = value.checkpoints.filter((entry): entry is MemoryReminderCheckpoint => {
		if (!entry || typeof entry !== 'object') return false;
		const { anchorId, boundaryId, interval, threshold } = entry;
		return typeof anchorId === 'string' && !!anchorId &&
			(boundaryId === null || (typeof boundaryId === 'string' && !!boundaryId)) &&
			Number.isSafeInteger(interval) && interval >= 1 && interval <= 2_000_000 &&
			Number.isSafeInteger(threshold) && threshold >= interval && threshold % interval === 0;
	}).map(entry => ({ anchorId: entry.anchorId, boundaryId: entry.boundaryId, interval: entry.interval, threshold: entry.threshold }));
	return { chatId: value.chatId, checkpoints };
}

/** Compaction keeps the same boundary. Invalid or other-branch memories cover nothing here. */
export function reminderBoundary(path: readonly SceneMessage[], scenes: readonly ResolvedScene[]): number {
	return scenes.reduce((end, scene) => scene.status === 'active' && scene.end < path.length
		? Math.max(end, scene.end) : end, -1);
}

export interface ReminderCount {
	total: number;
	boundaryId: string | null;
	/** Cumulative uncovered text tokens, aligned with the current path. */
	prefix: number[];
}

/** Only changed message text is tokenized again. Yield between batches on a long transcript. */
export class MemoryReminderCounter {
	private chatId = '';
	private encoding = '';
	private cache = new Map<string, { content: string; tokens: number }>();

	async count(chatId: string, encoding: string, path: readonly SceneMessage[], boundary: number,
		tokenize: (text: string) => number, cancelled: () => boolean = () => false): Promise<ReminderCount | null> {
		if (this.chatId !== chatId || this.encoding !== encoding) {
			this.chatId = chatId; this.encoding = encoding; this.cache.clear();
		}
		const cache = this.cache;
		let total = 0, batchStart = performance.now();
		const prefix: number[] = [];
		for (let i = 0; i < path.length; i++) {
			if (cancelled()) return null;
			const message = path[i];
			if (i > boundary && !message.excludedFromPrompt) {
				let entry = cache.get(message.id);
				if (!entry || entry.content !== message.content) {
					entry = { content: message.content, tokens: tokenize(message.content) };
					cache.set(message.id, entry);
				}
				total += entry.tokens;
			}
			prefix.push(total);
			if (performance.now() - batchStart >= 8) {
				await new Promise<void>(resolve => setTimeout(resolve, 0));
				batchStart = performance.now();
			}
		}
		return cancelled() ? null : { total, prefix, boundaryId: path[boundary]?.id ?? null };
	}
}

/** One notification for the newest crossed threshold; acknowledge earlier crossings too.
 * Anchors on the shared prefix suppress repeats when switching swipes or navigating backwards. */
export function nextMemoryReminder(chatId: string, path: readonly SceneMessage[], count: ReminderCount,
	interval: number, previous?: MemoryReminderProgress): { threshold: number; progress: MemoryReminderProgress } | null {
	const threshold = Math.floor(count.total / interval) * interval;
	if (!threshold || !path.length) return null;
	const checkpoints = previous?.chatId === chatId ? previous.checkpoints : [];
	const ids = new Set(path.map(message => message.id));
	const applicable = checkpoints.filter(entry => entry.boundaryId === count.boundaryId && entry.interval === interval);
	if (applicable.some(entry => ids.has(entry.anchorId) && entry.threshold >= threshold)) return null;
	const next = [...checkpoints];
	let crossed = 0;
	for (let i = 0; i < path.length; i++) {
		const reached = Math.floor(count.prefix[i] / interval) * interval;
		if (reached <= crossed) continue;
		crossed = reached;
		if (!applicable.some(entry => entry.anchorId === path[i].id && entry.threshold >= reached)) {
			next.push({ anchorId: path[i].id, boundaryId: count.boundaryId, interval, threshold: reached });
		}
	}
	return { threshold, progress: { chatId, checkpoints: next } };
}
