/** A trailing throttle: bursts replace the pending work without moving its deadline. */
export type TaskScheduler = (run: () => void, delayMs: number) => () => void;
const schedule: TaskScheduler = (run, delayMs) => {
	const timer = setTimeout(run, delayMs);
	return () => clearTimeout(timer);
};

export class CoalescedTask {
	private pending: (() => void) | null = null;
	private clearTimer: (() => void) | null = null;
	private revision = 0;
	constructor(private delayMs: number, private scheduler: TaskScheduler = schedule) {}

	queue(task: () => void): void {
		this.pending = task;
		if (this.clearTimer) return;
		const revision = ++this.revision;
		this.clearTimer = this.scheduler(() => {
			if (revision !== this.revision) return;
			this.clearTimer = null;
			const pending = this.pending;
			this.pending = null;
			pending?.();
		}, this.delayMs);
	}
	/** Publish the latest work now, including a final update shorter than one interval. */
	flush(): void {
		const pending = this.pending;
		this.cancel();
		pending?.();
	}
	/** Invalidate even a callback that has already entered the event queue. */
	cancel(): void {
		++this.revision;
		this.clearTimer?.();
		this.clearTimer = null;
		this.pending = null;
	}
}
