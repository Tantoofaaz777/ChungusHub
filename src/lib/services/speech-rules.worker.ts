import { applySpeechRules, type SpeechRule } from '../utils/speech-rules';
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<{ text: string; rules: SpeechRule[] }>) => void; postMessage: (result: unknown) => void };
scope.onmessage = event => {
 try { scope.postMessage(applySpeechRules(event.data.text, event.data.rules)); }
 catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : 'Could not process text.' }); }
};
scope.postMessage({ ready: true });
