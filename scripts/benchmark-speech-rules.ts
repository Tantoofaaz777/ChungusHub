import { SpeechRuleProcessor, type SpeechProcessingTiming } from '../src/lib/services/speech-rules';
import type { SpeechRule } from '../src/lib/utils/speech-rules';

// Synthetic text only. Compare new-worker startup with a ready, reused worker.
// This measures this machine's Bun runtime, not an Android device or a speech engine.
const text = ('OOC A long paragraph with a [tracker] and dialogue. Another sentence!\n').repeat(150);
const rules: SpeechRule[] = [
 { id: 'ooc', pattern: 'OOC', regex: false, caseSensitive: false, enabled: true },
 { id: 'tracker', pattern: '\\[[^\\]]*\\]', regex: true, caseSensitive: false, enabled: true },
 ...Array.from({ length: 18 }, (_, i) => ({ id: `word${i}`, pattern: `absent${i}`, regex: false, caseSensitive: false, enabled: true }))
];
function summary(samples: number[]) {
 const sorted = [...samples].sort((a, b) => a - b);
 const round = (n: number) => Math.round(n * 100) / 100;
 return { medianMs: round(sorted[Math.floor(sorted.length / 2)]), p95Ms: round(sorted[Math.ceil(sorted.length * .95) - 1]) };
}
async function measure(reuse: boolean) {
 let processor = new SpeechRuleProcessor();
 const samples: SpeechProcessingTiming[] = [];
 const run = async (record: boolean) => {
  const result = await processor.process(text, rules, timing => { if (record) samples.push(timing); });
  if (result.text.includes('OOC') || result.text.includes('[tracker]')) throw new Error('Filtering failed.');
 };
 try {
  if (reuse) await run(false);
  for (let i = 0; i < 30; i++) {
   if (!reuse) { processor.dispose(); processor = new SpeechRuleProcessor(); }
   await run(true);
  }
  return {
   samples: samples.length,
   total: summary(samples.map(t => t.totalMs)),
   workerWait: summary(samples.map(t => t.workerWaitMs)),
   processing: summary(samples.map(t => t.processingMs))
  };
 } finally { processor.dispose(); }
}
console.log(JSON.stringify({ characters: text.length, rules: rules.length, cold: await measure(false), ready: await measure(true) }, null, 2));
