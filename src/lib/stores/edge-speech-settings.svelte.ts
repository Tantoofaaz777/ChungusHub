import {
	DEFAULT_EDGE_SPEECH_VOICE, EDGE_SPEECH_VOICES_PATH, isEdgeSpeechVoice, isSpeechRate, type EdgeSpeechChoice, type EdgeSpeechVoice
} from '#shared/edge-speech.ts';

const STORAGE_KEY = 'chungus-edge-speech';

class EdgeSpeechSettings {
	voice = $state('');
	rate = $state(1);
	voices = $state<EdgeSpeechVoice[]>([]);
	loading = $state(false);
	error = $state('');
	private initialized = false;

	initialize() {
		if (this.initialized || typeof window === 'undefined') return;
		this.initialized = true;
		try {
			const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
			if (isEdgeSpeechVoice(saved.voice)) this.voice = saved.voice;
			if (isSpeechRate(saved.rate)) this.rate = saved.rate;
		} catch { /* Storage can be disabled. */ }
	}

	selection(native: boolean): EdgeSpeechChoice {
		this.initialize();
		return { voice: this.voice || (native ? '' : DEFAULT_EDGE_SPEECH_VOICE), rate: this.rate };
	}

	update(selection: Partial<EdgeSpeechChoice>) {
		this.initialize();
		if (selection.voice === '' || isEdgeSpeechVoice(selection.voice)) this.voice = selection.voice;
		if (isSpeechRate(selection.rate)) this.rate = selection.rate;
		try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ voice: this.voice, rate: this.rate })); }
		catch { /* Voice and speed still work for this page. */ }
	}

	async load() {
		this.initialize();
		if (this.loading || this.voices.length) return;
		this.loading = true;
		this.error = '';
		try {
			const response = await fetch(EDGE_SPEECH_VOICES_PATH);
			if (!response.ok) throw new Error();
			const { voices } = await response.json() as { voices: EdgeSpeechVoice[] };
			this.voices = voices.toSorted((a, b) => a.name.localeCompare(b.name));
		} catch { this.error = 'Could not load Edge voices. Try again in a moment.'; }
		finally { this.loading = false; }
	}
}

export const edgeSpeechSettings = new EdgeSpeechSettings();
