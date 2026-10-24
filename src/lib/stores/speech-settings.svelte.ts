import { canConfigureReadAloud, type AndroidSpeechChoice, type AndroidSpeechSettings } from '$lib/services/android-client';

/** Voice IDs belong to a particular phone/engine. These never enter server settings. */
export class SpeechSettingsStore {
	data = $state<AndroidSpeechSettings | null>(null);
	loading = $state(false);
	saving = $state(false);
	error = $state('');
	unsaved = $state(false);
	private timer: ReturnType<typeof setTimeout> | undefined;
	private revision = 0;
	private dirty = false;
	get available() { return canConfigureReadAloud(); }
	get canMixAudio() { return typeof window !== 'undefined' && window.ChungusAndroidClient?.readingMixAudio === true; }
	get canHighlight() { return typeof window !== 'undefined' && window.ChungusAndroidClient?.readingHighlights === true; }

	async load(refresh = false) {
		if (!this.available || this.loading || this.saving || (this.unsaved && (!refresh || !this.error)) || (this.data && !refresh)) return;
		this.loading = true; this.error = '';
		try { this.data = await window.ChungusAndroidClient!.readingSettings!(); this.unsaved = false; }
		catch (error) { this.error = error instanceof Error ? error.message : 'Could not load voices.'; }
		finally { this.loading = false; }
	}
	update(change: Partial<Pick<AndroidSpeechChoice, 'voice' | 'rate' | 'mixAudio' | 'highlightSpeech'>>) {
		if (!this.data || this.loading) return;
		this.data = { ...this.data, ...change, selectionAvailable: change.voice !== undefined ? true : this.data.selectionAvailable };
		this.revision++; this.dirty = true; this.unsaved = true; this.error = '';
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.save(), 250);
	}
	async save() {
		clearTimeout(this.timer);
		if (!this.data || this.saving || !this.available) return;
		this.dirty = false;
		this.saving = true;
		const revision = this.revision;
		const { engine, voice, rate, mixAudio, highlightSpeech } = this.data;
		try {
			const saved = await window.ChungusAndroidClient!.saveReadingSettings!({ engine, voice, rate, ...(mixAudio !== undefined ? { mixAudio } : {}), ...(highlightSpeech !== undefined ? { highlightSpeech } : {}) });
			if (revision === this.revision) { this.data = { ...this.data!, ...saved }; this.unsaved = false; this.error = ''; }
		} catch (error) { if (revision === this.revision) this.error = error instanceof Error ? error.message : 'Could not save speech settings.'; }
		finally {
			this.saving = false;
			// A later gesture wins even if an earlier native write finished afterward.
			if (this.dirty) await this.save();
		}
	}
}
export const speechSettingsStore = new SpeechSettingsStore();
