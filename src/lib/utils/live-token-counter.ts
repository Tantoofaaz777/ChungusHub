import { CoalescedTask, type TaskScheduler } from './coalesced-task';

type TokenSample = { enabled: false } | {
	enabled: true; text: string; streaming: boolean; identity?: unknown; model?: string;
};
/** Scheduling is separate from the Svelte view so lifecycle races can be tested with a clock. */
export class LiveTokenCounter {
	private wasStreaming = false;
	private identity: unknown;
	private task: CoalescedTask;
	constructor(private count: (text: string, model?: string) => number,
		private publish: (value: number) => void, scheduler?: TaskScheduler) {
		this.task = new CoalescedTask(200, scheduler);
	}
	update(sample: TokenSample): void {
		if (!sample.enabled) { this.task.cancel(); this.publish(0); this.wasStreaming = false; this.identity = undefined; return; }
		const { text, model, streaming, identity } = sample;
		if (!streaming) {
			this.task.cancel(); this.wasStreaming = false; this.identity = undefined;
			this.publish(this.count(text, model));
			return;
		}
		if (!this.wasStreaming || this.identity !== identity) { this.task.cancel(); this.publish(0); }
		this.wasStreaming = true; this.identity = identity;
		this.task.queue(() => this.publish(this.count(text, model)));
	}
	dispose(): void { this.task.cancel(); this.identity = undefined; this.wasStreaming = false; }
}
