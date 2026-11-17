import { EdgeTTS } from '@andresaya/edge-tts';
import { isEdgeSpeechVoice, isSpeechRate, MAX_EDGE_SPEECH_PART, type EdgeSpeechVoice } from '../shared/edge-speech';
import { readJsonCapped } from './llm/net';

const CATALOG_TTL_MS = 60 * 60_000;
const MAX_ACTIVE_READS = 4;
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 24 * 1024;
const THROTTLE_MS = 15_000;
const noStore = { 'cache-control': 'no-store' };
let catalogRequest: Promise<EdgeSpeechVoice[]> | undefined;
let catalogExpires = 0;
let activeReads = 0;
let retryAt = 0;

export async function edgeSpeechVoices(): Promise<Response> {
	if (!catalogRequest || (catalogExpires !== 0 && Date.now() >= catalogExpires)) {
		catalogExpires = 0;
		catalogRequest = new EdgeTTS().getVoices().then(raw => {
			const voices = raw.filter(voice =>
				(voice.Locale === 'en-US' || voice.Locale === 'en-GB') && isEdgeSpeechVoice(voice.ShortName)
			).map((voice): EdgeSpeechVoice => ({
				id: voice.ShortName,
				name: voice.ShortName.slice(6, -6).replace('Multilingual', ' (Multilingual)'),
				language: voice.Locale === 'en-GB' ? 'en-GB' : 'en-US'
			}));
			if (!voices.length) throw new Error('Empty English voice catalog');
			catalogExpires = Date.now() + CATALOG_TTL_MS;
			return voices;
		}).catch(error => {
			catalogRequest = undefined;
			throw error;
		});
	}
	try {
		return Response.json({ voices: await catalogRequest }, { headers: noStore });
	} catch {
		return speechError('Could not load Edge voices. Try again in a moment.', 502);
	}
}

function speechError(error: string, status: number, headers: Record<string, string> = {}): Response {
	return Response.json({ error }, { status, headers: { ...noStore, ...headers } });
}

export async function synthesizeEdgeSpeech(req: Request): Promise<Response> {
	if (req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
		return speechError('Speech requests require JSON.', 415);
	}
	let body: unknown;
	try {
		body = await readJsonCapped(new Response(req.body), MAX_REQUEST_BYTES, 'Speech request');
	} catch {
		return speechError('Invalid or oversized speech request.', 400);
	}
	const { text, voice, rate } = (body ?? {}) as { text?: unknown; voice?: unknown; rate?: unknown };
	if (typeof text !== 'string' || !text.trim() || text.length > MAX_EDGE_SPEECH_PART ||
		!isEdgeSpeechVoice(voice) || !isSpeechRate(rate)) {
		return speechError('Choose a US or UK English Edge voice and a valid short passage.', 400);
	}
	if (Date.now() < retryAt || activeReads >= MAX_ACTIVE_READS) {
		return speechError('Edge TTS is busy. Try again in a moment.', 429, {
			'retry-after': String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)))
		});
	}
	activeReads++;
	try {
		const percent = Math.round((rate - 1) * 100);
		const { audio } = await new EdgeTTS().generate(text, voice, {
			rate: `${percent >= 0 ? '+' : ''}${percent}%`,
			timeout: 10_000,
			signal: AbortSignal.any([req.signal, AbortSignal.timeout(15_000)])
		});
		if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error('Invalid speech audio');
		return new Response(new Uint8Array(audio), { headers: {
			...noStore, 'content-type': 'audio/mpeg', 'x-content-type-options': 'nosniff'
		} });
	} catch (error) {
		if (typeof error === 'object' && error && 'status' in error && error.status === 429) {
			retryAt = Date.now() + THROTTLE_MS;
			return speechError('Edge TTS is temporarily rate limited. Try again in a moment.', 429, {
				'retry-after': String(THROTTLE_MS / 1000)
			});
		}
		return speechError('Could not generate audio with Edge TTS. Try again in a moment.', 502);
	} finally {
		activeReads--;
	}
}
