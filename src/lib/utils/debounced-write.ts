/**
 * One debounced write per key.
 *
 * Every store that lets the user type into something it owns needs the same four things:
 * collapse a burst of keystrokes into one write, commit early when something is about to
 * read the data (navigation, a prompt build, a sync reload), know whether a key still
 * holds an unwritten change, and drop a pending write for a thing being deleted. Written
 * out per store, that is where the differences crept in: one would forget the
 * tab-going-away commit, another would write rows nobody had touched.
 *
 * Timers record unsent changes; active promises record saves awaiting acknowledgement.
 * A commit only starts for a key with a timer; flush also waits for active saves.
 * Writing unprompted is not a harmless extra write:
 * every write broadcasts a sync scope, so it lands this device's copy on all the others.
 *
 * `commit` receives the key and nothing else: the store reads its own current state for
 * that key, so a burst of edits writes the newest value exactly once. Errors are left to
 * surface (an unhandled rejection on the timer path, a rejected promise on the flush path)
 * rather than swallowed; a store that wants a toast catches inside its own callback.
 *
 * Construct one per store, at module scope: the `flushOnHide` listeners are never removed.
 */
import { SvelteMap } from 'svelte/reactivity';
import { flushOnHide } from '$lib/utils/flush-on-hide';

/** The key for a store with exactly one thing to write (regex rules: one settings blob). */
const SINGLE = '';

export class DebouncedWriter {
	// Reactive so `pending` can be read from a `$derived`: an editor showing "Saving…"
	// wants the answer to change under it, and a plain Map would answer once and never
	// again. Nothing else about the timers is state.
	private timers = new SvelteMap<string, ReturnType<typeof setTimeout>>();
	private writes = new SvelteMap<string, Promise<void>>();

	constructor(
		private readonly delayMs: number,
		private readonly commit: (key: string) => unknown
	) {
		// A backgrounded tab freezes its timers and may be discarded without another event,
		// so the window's worth of typing dies with it. No store has to remember this: it is
		// part of having a debounced write at all.
		flushOnHide(() => void this.flush());
	}

	/** (Re)start the window for `key`; the newest call wins. */
	schedule(key: string = SINGLE): void {
		this.cancel(key);
		this.timers.set(
			key,
			setTimeout(() => void this.run(key), this.delayMs)
		);
	}

	/** Drop a pending write without performing it, for a thing being deleted. */
	cancel(key: string = SINGLE): void {
		const timer = this.timers.get(key);
		if (timer === undefined) return;
		clearTimeout(timer);
		this.timers.delete(key);
	}

	/** Does this key hold a change that hasn't reached the server yet? Reactive. */
	pending(key: string = SINGLE): boolean {
		return this.timers.has(key) || this.writes.has(key);
	}

	/** Commit now and wait for it: one key, or every pending key when called with none. */
	async flush(key?: string): Promise<void> {
		if (key !== undefined) {
			await this.run(key);
			return;
		}
		await Promise.all([...new Set([...this.timers.keys(), ...this.writes.keys()])].map((pending) => this.run(pending)));
	}

	private async run(key: string): Promise<void> {
		if (!this.timers.has(key)) {
			await this.writes.get(key);
			return;
		}
		this.cancel(key);
		const previous = this.writes.get(key);
		const write = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => { await this.commit(key); });
		this.writes.set(key, write);
		try { await write; }
		finally { if (this.writes.get(key) === write) this.writes.delete(key); }
	}
}
