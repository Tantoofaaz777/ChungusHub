import { applySpeechRules, type SpeechRule } from '../utils/speech-rules';
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<{ id: number; text: string; rules: SpeechRule[] }>) => void; postMessage: (result: unknown) => void };
scope.onmessage = event => {
 const { id, text, rules } = event.data;
 try { scope.postMessage({ id, result: applySpeechRules(text, rules) }); }
 catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : 'Could not process text.' }); }
};
scope.postMessage({ ready: true });
