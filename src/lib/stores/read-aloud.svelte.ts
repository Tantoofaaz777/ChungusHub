import { canReadAloud, type AndroidReadingState, type ReadingCommand } from '#lib/services/android-client.ts';

import { prepareSpeechProcessing, processSpeechText, suspendSpeechProcessing, type SpeechProcessingTiming } from '#lib/services/speech-rules.ts';

/** Device-local playback state, never synced to the server or another device. */
class ReadAloudStore {
	available = $state(false);
	state = $state<AndroidReadingState>({ phase: 'idle' });
	busy = $state(false);
	/** Local durations only, never message text, titles, patterns or server telemetry. */
	lastProcessingTiming = $state<(SpeechProcessingTiming & { rulesFetchMs: number }) | null>(null);
	private revision = 0;
	private source = $state<{ key: string; requestId: string; original: string; text: string; offsets: number[] } | null>(null);
	get sourceKey() { return this.source?.key ?? null; }
	get highlight() {
		const { phase, requestId, range, highlightSpeech } = this.state;
		const source = this.source;
		if (!source || requestId !== source.requestId || !highlightSpeech || !range ||
			(phase !== 'playing' && phase !== 'paused') || !Number.isInteger(range.start) || !Number.isInteger(range.end) ||
			range.start < 0 || range.end <= range.start || range.end > source.text.length || range.end - range.start > 3000) return null;
		return { ...source, start: range.start, end: range.end };
	}
	suspend() { suspendSpeechProcessing(); }

	async refresh() {
		this.available = canReadAloud();
		if (this.available && window.ChungusAndroidClient?.readingRules && window.ChungusAndroidClient.foreground !== false &&
			(typeof document === 'undefined' || document.visibilityState !== 'hidden')) prepareSpeechProcessing();
		else suspendSpeechProcessing();
		if (!this.available || this.busy) return;
		const revision = this.revision;
		const state = await window.ChungusAndroidClient!.readingState!();
		if (revision === this.revision && !this.busy) {
			if ((state.phase === 'idle' || state.phase === 'error') && this.source &&
				(state.requestId === this.source.requestId || this.state.requestId === this.source.requestId)) this.source = null;
			this.state = state;
		}
	}
	async start(text: string, title: string, sourceKey?: string) {
		if (this.busy) return;
		if (!canReadAloud()) throw new Error('Update the Android app to read messages aloud.');
		this.busy = true;
		this.lastProcessingTiming = null;
		this.revision++;
		try {
			const client = window.ChungusAndroidClient!;
			const original = text;
			const requestId = client.readingHighlights ? crypto.randomUUID() : undefined;
			const trackOffsets = !!requestId && !!sourceKey;
			let offsets = trackOffsets ? Array.from({ length: text.length }, (_, i) => i) : [];
			if (client.readingRules) {
				const at = performance.now();
				const rules = await client.readingRules();
				const rulesFetchMs = performance.now() - at;
				const processed = await processSpeechText(text, rules, timing => {
					this.lastProcessingTiming = { rulesFetchMs, ...timing };
					console.debug('[TTS startup] rules', this.lastProcessingTiming);
				}, trackOffsets);
				if (Object.keys(processed.errors).length) throw new Error('Fix invalid text processing rules in Settings > TTS.');
				text = processed.text;
				if (trackOffsets) offsets = processed.offsets ?? [];
				if (!text.trim()) throw new Error('Nothing remains to read after applying your text processing rules.');
			}
			await client.readAloud!(text, title, requestId);
			this.source = sourceKey && requestId && offsets.length === text.length ? { key: sourceKey, requestId, original, text, offsets } : null;
			// Service startup is asynchronous; the next native snapshot confirms playback.
			this.state = { phase: 'preparing', title };
		} finally { this.busy = false; }
		await this.refresh();
	}
	async command(command: ReadingCommand) {
		if (this.busy || !this.available) return;
		this.busy = true;
		this.revision++;
		try { this.state = await window.ChungusAndroidClient!.readingCommand!(command); if (command === 'stop') this.source = null; }
		finally { this.busy = false; }
	}
}
export const readAloudStore = new ReadAloudStore();
