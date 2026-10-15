import { sortEntries, type LorebookEntry, type LorebookEntrySort } from './types';

/** One editor session's row positions. Keep live entry values, but only re-sort on an
 * explicit refresh, a different sort choice, or opening another book. A reopened editor
 * creates a fresh session. New rows appear at the end without moving existing rows. */
export function createEntryDisplayOrder() {
	let snapshot: { bookId: string; sort: LorebookEntrySort; revision: number; ids: string[] } | undefined;

	return (entries: LorebookEntry[], bookId: string, sort: LorebookEntrySort, revision: number): LorebookEntry[] => {
		const live = new Map(entries.map((entry) => [entry.id, entry]));
		if (!snapshot || snapshot.bookId !== bookId || snapshot.sort !== sort || snapshot.revision !== revision) {
			snapshot = { bookId, sort, revision, ids: sortEntries(entries, sort).map((entry) => entry.id) };
		} else {
			const known = new Set(snapshot.ids);
			snapshot.ids = [
				...snapshot.ids.filter((id) => live.has(id)),
				...sortEntries(entries.filter((entry) => !known.has(entry.id)), sort).map((entry) => entry.id)
			];
		}
		return snapshot.ids.map((id) => live.get(id)!);
	};
}
