import type { SpeechRule, SpeechRuleResult } from '../utils/speech-rules';

/** Terminate pathological regex without freezing the WebView. Asset loading has its own deadline. */
export function processSpeechText(text: string, rules: SpeechRule[]): Promise<SpeechRuleResult> {
 if (!rules.length) return Promise.resolve({ text: text.trim(), errors: {} });
 return new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./speech-rules.worker.ts', import.meta.url), { type: 'module' });
  const finish = () => { clearTimeout(timer); worker.terminate(); };
  let timer = setTimeout(() => { finish(); reject(new Error('Could not load text processing. Check your connection and try again.')); }, 15000);
  worker.onmessage = event => {
   if (event.data.ready) {
    clearTimeout(timer);
    timer = setTimeout(() => { finish(); reject(new Error('Text processing took too long. Simplify your regex rules in Settings > TTS.')); }, 1500);
    worker.postMessage({ text, rules });
    return;
   }
   finish();
   if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data);
  };
  worker.onerror = () => { finish(); reject(new Error('Could not process speech rules. Check Settings > TTS.')); };
 });
}
