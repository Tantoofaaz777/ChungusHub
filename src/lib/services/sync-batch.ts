import { CoalescedTask, type TaskScheduler } from '../utils/coalesced-task';

/** Batch invalidations, never writes. Handler declaration order defines dependencies. */
export class SyncBatch<Scope extends string> {
	private pending = new Set<Scope>();
	private running = false;
	private task: CoalescedTask;
	private order: Scope[];

	constructor(
		private handlers: Record<Scope, () => Promise<void>>,
		private report: (scope: string, error?: unknown) => void,
		private aliases: Partial<Record<Scope, Scope>> = {},
		scheduler?: TaskScheduler,
		private paused = false
	) {
		this.order = Object.keys(handlers) as Scope[];
		this.task = new CoalescedTask(50, scheduler);
	}

	enqueue(scope: string): void {
		if (!Object.hasOwn(this.handlers, scope)) {
			this.report(scope);
			return;
		}
		this.pending.add(this.canonical(scope as Scope));
		this.schedule();
	}

	/** Pending hints are covered by the full read; in-flight reads must run again. */
	reconnect(): void {
		for (const scope of this.order) this.pending.add(this.canonical(scope));
		this.schedule();
	}

	private canonical(scope: Scope): Scope {
		return this.aliases[scope] ?? scope;
	}

	private schedule(): void {
		if (!this.paused && !this.running) this.task.queue(() => { void this.drain(); });
	}

	/** Collect startup hints immediately, then apply them after dependent stores initialize. */
	resume(): void { this.paused = false; if (this.pending.size) this.schedule(); }

	private async drain(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			while (this.pending.size) {
				// Recheck order after each read: presets arriving mid-batch still precede settings.
				const scope = this.order.find((scope) => this.pending.has(scope))!;
				// Consume before awaiting so an invalidation during this read survives.
				this.pending.delete(scope);
				try {
					await this.handlers[scope]();
				} catch (error) {
					this.report(scope, error);
				}
			}
		} finally {
			this.running = false;
		}
	}
}
