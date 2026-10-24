import type { SpeechRule, SpeechRuleResult } from '../utils/speech-rules';

export interface SpeechProcessingTiming {
 workerWaitMs: number;
 processingMs: number;
 totalMs: number;
 reusedWorker: boolean;
}
type Job = {
 id: number; text: string; rules: SpeechRule[]; started: number; sent: number; reused: boolean;
 resolve: (result: SpeechRuleResult) => void; reject: (error: Error) => void;
 measured?: (timing: SpeechProcessingTiming) => void;
};

/** One sequential worker, retained while the page is active. A timeout always destroys it. */
export class SpeechRuleProcessor {
 private worker: Worker | null = null;
 private ready = false;
 private warm = true;
 private timer: ReturnType<typeof setTimeout> | undefined;
 private queue: Job[] = [];
 private active: Job | null = null;
 private sequence = 0;

 prepare() { this.warm = true; this.ensureWorker(); }
 suspend() { this.warm = false; if (!this.active && !this.queue.length) this.closeWorker(); }
 dispose() {
  this.warm = false;
  this.closeWorker();
  const jobs = [...(this.active ? [this.active] : []), ...this.queue];
  this.active = null; this.queue = [];
  for (const job of jobs) job.reject(new Error('Text processing was cancelled.'));
 }
 process(text: string, rules: SpeechRule[], measured?: Job['measured']): Promise<SpeechRuleResult> {
  if (!rules.length) {
   measured?.({ workerWaitMs: 0, processingMs: 0, totalMs: 0, reusedWorker: false });
   return Promise.resolve({ text: text.trim(), errors: {} });
  }
  return new Promise((resolve, reject) => {
   this.queue.push({ id: ++this.sequence, text, rules, started: performance.now(), sent: 0, reused: this.ready, resolve, reject, measured });
   this.ensureWorker(); this.dispatch();
  });
 }
 private ensureWorker() {
  if (this.worker) return;
  try {
   const worker = new Worker(new URL('./speech-rules.worker.ts', import.meta.url), { type: 'module' });
   this.worker = worker;
   this.timer = setTimeout(() => this.failed(new Error('Could not load text processing. Check your connection and try again.')), 15000);
   worker.onmessage = event => {
    if (this.worker !== worker) return;
    if (event.data.ready) {
     if (this.ready) return;
     clearTimeout(this.timer); this.ready = true; this.dispatch(); return;
    }
    const job = this.active;
    if (!job || event.data.id !== job.id) return;
    clearTimeout(this.timer); this.active = null;
    const now = performance.now();
    // Diagnostics must never interfere with resolving a reading or draining the queue.
    try { job.measured?.({ workerWaitMs: job.sent - job.started, processingMs: now - job.sent, totalMs: now - job.started, reusedWorker: job.reused }); } catch { /* Optional observer only. */ }
    if (event.data.error) job.reject(new Error(event.data.error));
    else job.resolve(event.data.result);
    this.dispatch();
   };
   worker.onerror = () => { if (this.worker === worker) this.failed(new Error('Could not process speech rules. Check Settings > TTS.')); };
  } catch { this.failed(new Error('Could not load text processing. Check your connection and try again.')); }
 }
 private dispatch() {
  if (!this.ready || this.active) return;
  const job = this.queue.shift();
  if (!job) {
   if (!this.warm) this.closeWorker();
   // Keep only idle workers from holding a Bun test/benchmark process open.
   else (this.worker as Worker & { unref?: () => void })?.unref?.();
   return;
  }
  this.active = job; job.sent = performance.now();
  (this.worker as Worker & { ref?: () => void })?.ref?.();
  this.timer = setTimeout(() => this.failed(new Error('Text processing took too long. Simplify your regex rules in Settings > TTS.')), 1500);
  try { this.worker!.postMessage({ id: job.id, text: job.text, rules: job.rules }); }
  catch { this.failed(new Error('Could not process speech rules. Check Settings > TTS.')); }
 }
 private failed(error: Error) {
  this.closeWorker();
  // Fail closed, including queued previews/reads. A later request gets a fresh worker.
  const jobs = [...(this.active ? [this.active] : []), ...this.queue];
  this.active = null; this.queue = [];
  for (const job of jobs) job.reject(error);
 }
 private closeWorker() {
  clearTimeout(this.timer); this.timer = undefined;
  const worker = this.worker;
  this.worker = null; this.ready = false;
  worker?.terminate();
 }
}

const processor = new SpeechRuleProcessor();
export const prepareSpeechProcessing = () => processor.prepare();
export const suspendSpeechProcessing = () => processor.suspend();
export const processSpeechText = (text: string, rules: SpeechRule[], measured?: Job['measured']) => processor.process(text, rules, measured);
