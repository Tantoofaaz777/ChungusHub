/** Orders local writes and rejects reads overtaken by local edits or newer reloads. */
export class SettingsSync {
	private versions = new Map<string, number>();
	private readers = new Map<string, number>();
	private writes = new Map<string, Promise<void>>();
	private ticket = 0;

	changed(key: string): void {
		this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
	}

	async read<T>(key: string, load: () => Promise<T>): Promise<T> {
		let pending: Promise<void> | undefined;
		while ((pending = this.writes.get(key))) await pending;
		return load();
	}

	async write(key: string, save: () => Promise<void>): Promise<void> {
		this.changed(key);
		const previous = this.writes.get(key);
		const write = (previous ? previous.catch(() => {}) : Promise.resolve()).then(save);
		this.writes.set(key, write);
		try { await write; }
		finally { if (this.writes.get(key) === write) this.writes.delete(key); }
	}

	async reload<T>(keys: string[], read: () => Promise<T>, apply: (value: T) => void): Promise<void> {
		const ticket = ++this.ticket;
		const versions = keys.map(key => this.versions.get(key));
		for (const key of keys) this.readers.set(key, ticket);
		const current = () => keys.every((key, index) => this.readers.get(key) === ticket && this.versions.get(key) === versions[index]);
		// A read issued while a save is in flight must see that save on the server.
		const pending = keys.map(key => this.writes.get(key)).filter((write): write is Promise<void> => !!write);
		if (pending.length) await Promise.all(pending);
		if (!current()) return;
		const value = await read();
		if (current() && keys.every(key => !this.writes.has(key))) apply(value);
	}
}

export const settingsSync = new SettingsSync();
