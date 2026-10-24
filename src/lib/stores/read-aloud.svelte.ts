import { canReadAloud, type AndroidReadingState, type ReadingCommand } from '$lib/services/android-client';

import { prepareSpeechProcessing, processSpeechText, suspendSpeechProcessing, type SpeechProcessingTiming } from '$lib/services/speech-rules';

/** Device-local playback state, never synced to the server or another device. */
class ReadAloudStore {
	available = $state(false);
	state = $state<AndroidReadingState>({ phase: 'idle' });
	busy = $state(false);
	/** Local durations only, never message text, titles, patterns or server telemetry. */
	lastProcessingTiming = $state<(SpeechProcessingTiming & { rulesFetchMs: number }) | null>(null);
	private revision = 0;
	suspend() { suspendSpeechProcessing(); }

	async refresh() {
		this.available = canReadAloud();
		if (this.available && window.ChungusAndroidClient?.readingRules && window.ChungusAndroidClient.foreground !== false &&
			(typeof document === 'undefined' || document.visibilityState !== 'hidden')) prepareSpeechProcessing();
		else suspendSpeechProcessing();
		if (!this.available || this.busy) return;
		const revision = this.revision;
		const state = await window.ChungusAndroidClient!.readingState!();
		if (revision === this.revision && !this.busy) this.state = state;
	}
	async start(text: string, title: string) {
		if (this.busy) return;
		if (!canReadAloud()) throw new Error('Update the Android app to read messages aloud.');
		this.busy = true;
		this.lastProcessingTiming = null;
		this.revision++;
		try {
			const client = window.ChungusAndroidClient!;
			if (client.readingRules) {
				const at = performance.now();
				const rules = await client.readingRules();
				const rulesFetchMs = performance.now() - at;
				const processed = await processSpeechText(text, rules, timing => {
					this.lastProcessingTiming = { rulesFetchMs, ...timing };
					console.debug('[TTS startup] rules', this.lastProcessingTiming);
				});
				if (Object.keys(processed.errors).length) throw new Error('Fix invalid text processing rules in Settings > TTS.');
				text = processed.text;
				if (!text.trim()) throw new Error('Nothing remains to read after applying your text processing rules.');
			}
			await client.readAloud!(text, title);
			// Service startup is asynchronous; the next native snapshot confirms playback.
			this.state = { phase: 'preparing', title };
		} finally { this.busy = false; }
		await this.refresh();
	}
	async command(command: ReadingCommand) {
		if (this.busy || !this.available) return;
		this.busy = true;
		this.revision++;
		try { this.state = await window.ChungusAndroidClient!.readingCommand!(command); }
		finally { this.busy = false; }
	}
}
export const readAloudStore = new ReadAloudStore();
