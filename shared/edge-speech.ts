export const MAX_EDGE_SPEECH_PART = 3000;
export const MAX_READ_ALOUD_TEXT = 80_000;
export const DEFAULT_EDGE_SPEECH_VOICE = 'en-US-AriaNeural';
export const EDGE_SPEECH_VOICES_PATH = '/api/tts/voices';
export const EDGE_SPEECH_AUDIO_PATH = '/api/tts/synthesize';

export interface EdgeSpeechVoice {
	id: string;
	name: string;
	language: 'en-US' | 'en-GB';
}

export interface EdgeSpeechChoice {
	voice: string;
	rate: number;
}

export function isEdgeSpeechVoice(voice: unknown): voice is string {
	return typeof voice === 'string' && /^en-(?:US|GB)-[A-Za-z]{1,64}Neural$/.test(voice);
}

export function isSpeechRate(rate: unknown): rate is number {
	return typeof rate === 'number' && rate >= 0.5 && rate <= 2;
}
