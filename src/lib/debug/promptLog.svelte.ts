/**
 * Prompt debug log store.
 *
 * The debug log is captured server-side, persisted in SQLite, and shared across every
 * device (see server/promptLog.ts). This store subscribes to the transport prompt-log
 * bus for live changes, and backfills the stored log over REST whenever the panel is
 * enabled, so opening it on any device, any time, shows the same log.
 */
import { apiGet, apiSend, onPromptLog, onPromptLogClear, setPromptLogEnabled, type PromptLogEvent } from '$lib/services/transport';
import type { PromptLogEntry } from './types';

/** Above this, the panel surfaces a "log is large" warning. The server caps the buffer. */
const SAFETY_THRESHOLD = 1000;

class PromptLogStore {
	/** Newest first. */
	entries = $state<PromptLogEntry[]>([]);
	loaded = $state(false);
	/** Surfaced loudly in the panel; a failed backfill must never break generation. */
	error = $state<string | null>(null);

	selectedId = $state<string | null>(null);
	/** Up to two ids selected for side-by-side compare. */
	compareIds = $state<string[]>([]);

	large = $derived(this.entries.length >= SAFETY_THRESHOLD);
	selected = $derived(this.entries.find((e) => e.id === this.selectedId) ?? null);

	constructor() {
		if (typeof window === 'undefined') return;
		onPromptLog((ev) => this.handle(ev));
		onPromptLogClear(() => this.reset());
	}

	/** Driven by the Advanced toggle. Tells the server this device wants the feed, and
	 *  backfills the shared buffer so the panel isn't empty when it opens. */
	setEnabled(value: boolean): void {
		setPromptLogEnabled(value);
		if (value) void this.backfill();
	}

	private async backfill(): Promise<void> {
		try {
			const data = (await apiGet('/api/debug/prompt-log')) as { entries: PromptLogEntry[] };
			this.entries = (data.entries ?? []).slice().sort((a, b) => b.startedAt - a.startedAt);
			this.error = null;
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loaded = true;
		}
	}

	private handle(ev: PromptLogEvent): void {
		if (ev.type === 'request') {
			// The server may re-broadcast around a reconnect; de-dupe by id.
			if (this.entries.some((e) => e.id === ev.entry.id)) return;
			this.entries.unshift(ev.entry as PromptLogEntry);
		} else {
			const i = this.entries.findIndex((e) => e.id === ev.id);
			if (i === -1) return;
			this.entries[i] = {
				...this.entries[i],
				status: ev.result.status,
				endedAt: ev.result.endedAt,
				usage: ev.result.usage,
				finishReason: ev.result.finishReason,
				resultModel: ev.result.model,
				resultProvider: ev.result.provider,
				error: ev.result.error,
				responseContent: ev.result.responseContent,
				responseThinking: ev.result.responseThinking
			};
		}
	}

	private reset(): void {
		this.entries = [];
		this.selectedId = null;
		this.compareIds = [];
	}

	// ===== Selection =====

	select(id: string): void {
		this.selectedId = id;
	}

	/** Back out of the detail view: the phone layout shows one pane at a time. */
	deselect(): void {
		this.selectedId = null;
	}

	/** Toggle an entry into the compare set, capped at two (drops the oldest pick). */
	toggleCompare(id: string): void {
		if (this.compareIds.includes(id)) {
			this.compareIds = this.compareIds.filter((x) => x !== id);
		} else {
			this.compareIds = [...this.compareIds, id].slice(-2);
		}
	}

	clearCompare(): void {
		this.compareIds = [];
	}

	/** Wipe the shared debug log for every device. The server broadcasts the clear back,
	 *  which resets this store too; we also clear locally for an instant response. */
	clear(): void {
		this.reset();
		void apiSend('/api/debug/prompt-log/clear', 'POST');
	}
}

export const promptLogStore = new PromptLogStore();
