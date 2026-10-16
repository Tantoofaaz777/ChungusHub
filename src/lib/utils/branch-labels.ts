/** Legacy branch labels still appear in chat search; preserve their saved palette keys. */
const COLORS = new Map([
	['crimson', '#e5484d'], ['amber', '#f5a524'], ['emerald', '#30a46c'], ['sky', '#3b9eff'],
	['violet', '#9d7bff'], ['rose', '#e93d82'], ['teal', '#12a594'], ['slate', '#8b98a8']
]);

/** Resolve a palette key to its CSS hex, falling back to slate for unknown/legacy keys. */
export function branchColorHex(key: string | undefined | null): string {
	return (key && COLORS.get(key)) || '#8b98a8';
}
