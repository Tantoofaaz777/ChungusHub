/** A short-lived read batch for boot, never a cache of settings during normal use. */
export class SettingsSnapshot {
	private current: {
		rows: Map<string, string> | null;
		dirty: Set<string>;
		invalidated: boolean;
	} | null = null;

	async run<T>(load: () => Promise<Record<string, string>>, task: () => Promise<T>): Promise<T> {
		if (this.current) throw new Error('A settings snapshot is already active');
		const scope = { rows: null as Map<string, string> | null, dirty: new Set<string>(), invalidated: false };
		this.current = scope;
		try {
			scope.rows = new Map(Object.entries(await load()));
			return await task();
		} finally {
			this.current = null;
		}
	}

	read(key: string, fresh: () => Promise<string | null>): Promise<string | null> {
		const scope = this.current;
		if (!scope?.rows || scope.invalidated || scope.dirty.has(key)) return fresh();
		return Promise.resolve(scope.rows.get(key) ?? null);
	}

	/** Invalidate BEFORE a write starts, even if it fails or its response arrives late.
	 * Remote hints/reconnects invalidate the whole batch, including an in-flight load. */
	invalidate(key?: string): void {
		if (!this.current) return;
		if (key === undefined) this.current.invalidated = true;
		else this.current.dirty.add(key);
	}
}
