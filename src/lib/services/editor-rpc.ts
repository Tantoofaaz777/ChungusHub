/** Editor CRUD must keep local save/delete order; refreshes wait for writes already sent. */
const WRITES: Record<string, string> = {
	insertLibraryEntry: 'library', updateLibraryEntry: 'library', updateLibraryEntryFavorite: 'library', deleteLibraryEntry: 'library',
	insertCharacterVersion: 'library', renameCharacterVersion: 'library', deleteCharacterVersion: 'library',
	insertLorebook: 'lorebooks', updateLorebook: 'lorebooks', deleteLorebook: 'lorebooks',
	insertSteeringNote: 'steering', updateSteeringNote: 'steering', deleteSteeringNote: 'steering',
	addInputHistory: 'history', clearInputHistory: 'history'
};
const READS: Record<string, string> = {
	getAllLibraryEntries: 'library', getLibraryEntry: 'library', getAllCharacterVersions: 'library', getCharacterVersion: 'library',
	getAllLorebooks: 'lorebooks', getLorebook: 'lorebooks', getAllSteeringNotes: 'steering', getInputHistory: 'history'
};

export class EditorRpc {
	private writes = new Map<string, { scope: string; promise: Promise<unknown> }>();
	constructor(private send: (method: string, args: unknown[]) => Promise<unknown>) {}

	async call<T>(method: string, args: unknown[]): Promise<T> {
		const readScope = READS[method];
		if (readScope) {
			for (;;) {
				const pending = [...this.writes.values()].filter(write => write.scope === readScope).map(write => write.promise);
				if (!pending.length) break;
				await Promise.all(pending);
			}
			return await this.send(method, args) as T;
		}
		const scope = WRITES[method];
		if (!scope) return await this.send(method, args) as T;
		const first = args[0];
		const id = scope === 'history' ? '*' : typeof first === 'string' ? first : (first as { id: string }).id;
		const key = `${scope}:${id}`;
		// Snapshot at invocation: a queued write must not read a later mutable editor object.
		const payload = JSON.stringify(args);
		const previous = this.writes.get(key)?.promise;
		const promise = (previous ? previous.catch(() => {}) : Promise.resolve()).then(() => this.send(method, JSON.parse(payload)));
		this.writes.set(key, { scope, promise });
		try { return await promise as T; }
		finally { if (this.writes.get(key)?.promise === promise) this.writes.delete(key); }
	}
}
