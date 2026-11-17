import { expect, test } from 'bun:test';
import { synthesizeEdgeSpeech } from './edge-speech';

const choice = { text: 'A quiet night.', voice: 'en-US-AriaNeural', rate: 1 };

function synthesize(body: string, type = 'application/json') {
	return synthesizeEdgeSpeech(new Request('http://localhost/api/tts/synthesize', {
		method: 'POST', headers: { 'content-type': type }, body
	}));
}

test('synthesis rejects unsupported locales, invalid settings and oversized input before contacting Edge', async () => {
	for (const body of [
		{ ...choice, voice: 'pt-BR-FranciscaNeural' },
		{ ...choice, voice: 'en-GB-SoniaNeural\"' },
		{ ...choice, rate: 3 },
		{ ...choice, text: ' ' },
		{ ...choice, text: 'a'.repeat(3001) },
		{ ...choice, unknown: 'a'.repeat(25_000) }
	]) {
		const result = await synthesize(JSON.stringify(body));
		expect(result.status).toBe(400);
		expect(result.headers.get('cache-control')).toBe('no-store');
	}
	expect((await synthesize(JSON.stringify(choice), 'text/plain')).status).toBe(415);
});
