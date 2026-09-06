/**
 * Server-side prompt debug log.
 *
 * The single source of truth for the debug panel. The server is the chokepoint for
 * every LLM completion, so it captures each request and
 * its real result here and broadcasts the change to every connected panel. A device
 * that opens the panel late backfills from storage. Capture is server-side rather than
 * per-device, so every device sees the same log.
 *
 * Entries persist in SQLite (`prompt_log`, opaque JSON rows only this module reads
 * or writes), so the log survives server restarts and reaches devices that connect
 * later. Bounded: past CAP the oldest rows are pruned on insert. Capture stays gated
 * on a device actually debugging (`anyDebug` in index.ts). Toggled off, nothing is
 * ever written.
 */

import { serverDb } from './db';
import type { GenerationTuning } from './llm/types';
import type { RoutingConfig } from './llm/registry';

export interface PromptLogMessage {
	role: string;
	content: string;
	/** Chat image attachments as server-relative paths (never raw bytes). */
	images?: string[];
}

export type PromptLogStatus = 'pending' | 'done' | 'error' | 'cancelled';

export interface PromptLogEntry {
	id: string;
	source: string;
	kind: 'completion';
	provider: string;
	model: string;
	messages: PromptLogMessage[];
	params?: Record<string, string | number>;
	maxTokens?: number;
	temperature?: number;
	stream: boolean;
	/** Reasoning/verbosity/media/caching tuning the request carried. Part of what was sent,
	 *  so the panel can answer "was reasoning even on for this call". */
	tuning?: GenerationTuning;
	/** The connection's OpenRouter routing for this request (null/absent elsewhere). It
	 *  decides which upstream served the call. */
	routing?: RoutingConfig | null;
	startedAt: number;
	status: PromptLogStatus;
	endedAt?: number;
	usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
	finishReason?: string;
	resultModel?: string;
	resultProvider?: string;
	error?: string;
	/** The response body the provider returned (thinking is extracted separately). */
	responseContent?: string;
	responseThinking?: string;
}

/** The result envelope patched onto a request once it returns. */
export interface PromptLogResult {
	status: 'done' | 'error' | 'cancelled';
	endedAt: number;
	usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
	finishReason?: string;
	model?: string;
	provider?: string;
	error?: string;
	responseContent?: string;
	responseThinking?: string;
}

/** The incremental change broadcast to panels, mirroring the client bus shape. */
export type PromptLogEvent =
	| { type: 'request'; entry: PromptLogEntry }
	| { type: 'result'; id: string; result: PromptLogResult };

/** Above this the oldest entries are pruned. Newest-first. */
const CAP = 500;

/** Persist a fresh request snapshot, pruning the oldest rows past the cap. */
export function recordRequest(entry: PromptLogEntry): void {
	serverDb.insertPromptLogEntry(entry.id, entry.startedAt, JSON.stringify(entry), CAP);
}

/** Merge a result envelope onto the matching request. Returns false when that request
 *  was never captured (or aged out), so the caller can skip the broadcast too. */
export function patchResult(id: string, result: PromptLogResult): boolean {
	const raw = serverDb.getPromptLogEntry(id);
	if (!raw) return false;
	const e = JSON.parse(raw) as PromptLogEntry;
	e.status = result.status;
	e.endedAt = result.endedAt;
	if (result.usage) e.usage = result.usage;
	if (result.finishReason) e.finishReason = result.finishReason;
	if (result.model) e.resultModel = result.model;
	if (result.provider) e.resultProvider = result.provider;
	if (result.error) e.error = result.error;
	if (result.responseContent) e.responseContent = result.responseContent;
	if (result.responseThinking) e.responseThinking = result.responseThinking;
	serverDb.updatePromptLogEntry(id, JSON.stringify(e));
	return true;
}

/**
 * Boot sweep: an entry still `pending` belongs to a request whose process died before the
 * provider answered, and nothing will ever settle it. Left alone it reads as "in flight"
 * forever, which makes a request that never returned indistinguishable from one still
 * running. Settle it as an error naming the cause, and return the count.
 *
 * A row that fails to parse is left exactly as it is: `snapshot()` is where a corrupt row
 * throws loudly, and a debug-log row must not take the whole server's boot down with it.
 */
export function settleInterrupted(): number {
	let settled = 0;
	for (const raw of serverDb.getAllPromptLogEntries()) {
		let e: PromptLogEntry;
		try {
			e = JSON.parse(raw) as PromptLogEntry;
		} catch {
			continue;
		}
		if (e.status !== 'pending') continue;
		e.status = 'error';
		e.endedAt = Date.now();
		e.error = 'The server stopped before this request returned, so no result was ever received.';
		serverDb.updatePromptLogEntry(e.id, JSON.stringify(e));
		settled += 1;
	}
	return settled;
}

/** Every stored entry, newest first. Served for backfill when a panel opens. A corrupt
 *  row throws (the panel surfaces the error loudly) instead of being silently dropped. */
export function snapshot(): PromptLogEntry[] {
	return serverDb.getAllPromptLogEntries().map((raw) => JSON.parse(raw) as PromptLogEntry);
}

export function clear(): void {
	serverDb.clearPromptLog();
}
