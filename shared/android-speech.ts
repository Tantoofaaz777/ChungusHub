export interface AndroidVoiceChoice {
	engine: string;
	voice: string;
}

export function normalizeAndroidVoice(value: unknown): AndroidVoiceChoice | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const { engine, voice } = value as Record<string, unknown>;
	if (typeof engine !== 'string' || !engine.trim() || engine.length > 512) return undefined;
	if (typeof voice !== 'string' || !voice.trim() || voice.length > 512) return undefined;
	return { engine, voice };
}
