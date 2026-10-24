/** Apply a server snapshot without undoing local writes completed while it was in flight. */
export function retainLocalChanges<T extends { id: string; revision: number }>(incoming: T[], before: T[], current: T[]): T[] {
	const baseline = new Map(before.map(row => [row.id, row]));
	const live = new Map(current.map(row => [row.id, row]));
	const result = new Map(incoming.map(row => [row.id, row]));
	for (const id of new Set([...baseline.keys(), ...live.keys()])) {
		const row = live.get(id);
		if (row === baseline.get(id)) continue;
		if (!row) result.delete(id);
		else if (!result.has(id) || result.get(id)!.revision <= row.revision) result.set(id, row);
	}
	return [...result.values()];
}

/** Capture mutable editor rows without copying their potentially large contents. */
export function captureEditorRows<T extends { id: string; updatedAt: number }>(rows: T[]) {
	return new Map(rows.map(row => [row.id, { row, updatedAt: row.updatedAt }]));
}

/** Compare with the read's baseline, never with clocks on another device. */
export function retainEditorChanges<T extends { id: string; updatedAt: number }>(
	incoming: T[], before: ReturnType<typeof captureEditorRows<T>>, current: T[]
): T[] {
	const live = new Map(current.map(row => [row.id, row]));
	const result = new Map(incoming.map(row => [row.id, row]));
	for (const id of new Set([...before.keys(), ...live.keys()])) {
		const row = live.get(id), original = before.get(id);
		if (row === original?.row && row?.updatedAt === original?.updatedAt) continue;
		if (row) result.set(id, row); else result.delete(id);
	}
	return [...result.values()];
}
