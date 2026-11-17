import {
	EDGE_SPEECH_AUDIO_PATH, MAX_EDGE_SPEECH_PART, MAX_READ_ALOUD_TEXT, type EdgeSpeechChoice
} from '#shared/edge-speech.ts';
import type { AndroidReadingState, ReadingCommand } from './android-client';

export interface SpeechPart { text: string; start: number; end: number }

export function englishSpeechParts(text: string, voice: string): SpeechPart[] {
	if (!text.trim() || text.length > MAX_READ_ALOUD_TEXT) {
		throw new Error('The message is empty or too long to read (maximum 80,000 characters).');
	}
	const parts: SpeechPart[] = [];
	const sentences = new Intl.Segmenter(voice.slice(0, 5), { granularity: 'sentence' });
	for (const { segment, index } of sentences.segment(text)) {
		let start = index;
		const end = index + segment.length;
		while (start < end) {
			let cut = Math.min(start + MAX_EDGE_SPEECH_PART, end);
			if (cut < end) {
				const space = text.lastIndexOf(' ', cut);
				if (space > start + MAX_EDGE_SPEECH_PART / 2) cut = space;
				else if (/[\uDC00-\uDFFF]/.test(text.charAt(cut))) cut--;
			}
			const raw = text.slice(start, cut);
			const spoken = raw.trim();
			if (spoken) {
				const offset = start + raw.length - raw.trimStart().length;
				parts.push({ text: spoken, start: offset, end: offset + spoken.length });
			}
			start = cut;
		}
	}
	return parts;
}

async function getAudio(text: string, choice: EdgeSpeechChoice, signal: AbortSignal): Promise<Blob> {
	const response = await fetch(EDGE_SPEECH_AUDIO_PATH, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ text, ...choice }), signal
	});
	if (response.status === 401 || response.status === 403) throw new Error('Unlock ChungusHub and try reading again.');
	if (response.status === 429) throw new Error('Edge TTS is busy. Wait a moment and try again.');
	if (!response.ok || response.headers.get('content-type') !== 'audio/mpeg') {
		throw new Error('Could not generate audio with Edge TTS. Try again in a moment.');
	}
	return response.blob();
}

/** A reading retains the current and next clips in memory. Navigation cancels work
 * outside that window, and a failed prefetch leaves the current clip playing. */
export class BrowserSpeechPlayer {
	private audio: HTMLAudioElement | null = null;
	private url: string | null = null;
	private parts: SpeechPart[] = [];
	private choice: EdgeSpeechChoice = { voice: '', rate: 1 };
	private clips = new Map<number, { abort: AbortController; result: Promise<Blob> }>();
	private index = 0;
	private generation = 0;
	private playAttempt = 0;
	private title = '';
	private requestId = '';
	private wantsPlay = false;
	private audible = false;
	private error: string | null = null;

	constructor(private publish: (state: AndroidReadingState) => void) {}

	start(text: string, title: string, requestId: string, choice: EdgeSpeechChoice): void {
		const parts = englishSpeechParts(text, choice.voice);
		const audio = new Audio();
		this.stop();
		this.audio = audio;
		this.parts = parts;
		this.choice = choice;
		this.title = title;
		this.requestId = requestId;
		this.wantsPlay = true;
		void this.load(0);
	}

	command(command: ReadingCommand): void {
		if (command === 'stop') { this.stop(); return; }
		if (!this.parts.length || this.error) return;
		if (command === 'previous' || command === 'next') {
			const index = this.index + (command === 'previous' ? -1 : 1);
			if (index < this.parts.length) void this.load(Math.max(0, index));
			return;
		}
		this.wantsPlay = command === 'play';
		if (this.wantsPlay) void this.play(this.generation);
		else { this.playAttempt++; this.audio?.pause(); this.status('paused'); }
	}

	stop(): void {
		this.generation++;
		this.unloadClip();
		this.audio = null;
		for (const clip of this.clips.values()) clip.abort.abort();
		this.clips.clear();
		this.parts = [];
		this.error = null;
		this.publish({ phase: 'idle' });
	}

	private clip(index: number): Promise<Blob> {
		const cached = this.clips.get(index);
		if (cached) return cached.result;
		const abort = new AbortController();
		const result = getAudio(this.parts[index].text, this.choice, abort.signal);
		void result.catch(() => {});
		this.clips.set(index, { abort, result });
		return result;
	}

	private async load(index: number): Promise<void> {
		const generation = ++this.generation;
		this.unloadClip();
		this.index = index;
		this.audible = false;
		for (const [i, clip] of this.clips) {
			if (i === index || i === index + 1) continue;
			clip.abort.abort();
			this.clips.delete(i);
		}
		this.status(this.wantsPlay ? 'preparing' : 'paused');
		try {
			const blob = await this.clip(index);
			const audio = this.audio;
			if (generation !== this.generation || !audio) return;
			this.url = URL.createObjectURL(blob);
			audio.src = this.url;
			audio.onended = () => {
				if (generation !== this.generation) return;
				if (index + 1 < this.parts.length) void this.load(index + 1);
				else this.stop();
			};
			audio.onerror = () => { if (generation === this.generation) this.fail('Could not play the speech audio.'); };
			if (this.wantsPlay) await this.play(generation);
		} catch (error) {
			if (generation === this.generation) this.fail(error instanceof Error ? error.message : 'Could not prepare speech.');
		}
	}

	private async play(generation: number): Promise<void> {
		this.status('preparing');
		if (!this.audio || !this.url) return;
		const attempt = ++this.playAttempt;
		try {
			await this.audio.play();
			if (generation !== this.generation || attempt !== this.playAttempt) return;
			this.audible = true;
			this.status('playing');
			if (this.index + 1 < this.parts.length) void this.clip(this.index + 1);
		} catch (error) {
			if (generation !== this.generation || attempt !== this.playAttempt) return;
			if (error instanceof DOMException && error.name === 'NotAllowedError') {
				this.wantsPlay = false;
				this.status('paused');
			} else this.fail('Could not play the speech audio.');
		}
	}

	private fail(message: string): void {
		this.generation++;
		this.unloadClip();
		this.audio = null;
		for (const clip of this.clips.values()) clip.abort.abort();
		this.clips.clear();
		this.error = message;
		this.status('error');
	}

	private unloadClip(): void {
		if (this.audio) {
			this.audio.onended = null;
			this.audio.onerror = null;
			this.audio.pause();
			this.audio.removeAttribute('src');
			this.audio.load();
		}
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
	}

	private status(phase: AndroidReadingState['phase']): void {
		const part = this.parts[this.index];
		this.publish({ phase, title: this.title, requestId: this.requestId, error: this.error,
			sentence: this.index + 1, total: this.parts.length, highlightSpeech: true,
			range: this.audible && part ? { start: part.start, end: part.end } : null });
	}
}
