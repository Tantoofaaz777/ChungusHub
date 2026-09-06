/**
 * Word-level diff for Spellcheck's proposal in the composer's transform panel: given the
 * draft before and the model's corrected version after, produce an ordered list of
 * equal/removed/added spans a UI can render as strikethrough + inserted text.
 *
 * Spellcheck's, and deliberately not Impersonate's, though the two share that panel: a
 * redline is the right reading of small edits over the same text, and the wrong reading of
 * a full message grown from a one-line note, where the two texts share only accidental
 * words and the result is an unreadable weave. Impersonate shows what it wrote instead.
 *
 * Tokens split on whitespace RUNS, keeping each run as its own token (never merged into
 * neighboring words). This is what makes reconstruction byte-perfect: concatenating every
 * `equal`/`removed` segment's text reproduces `before` exactly, and every `equal`/`added`
 * segment's text reproduces `after` exactly, whitespace included. See text-diff.test.ts.
 *
 * Deliberately separate from utils/diff.ts (the branch comparison view): that one is
 * line-first and renders a change as PAIRED del/add rows, each side its own segment list:
 * right for comparing story turns, wrong for a one-paragraph composer draft. This one
 * emits a single interleaved stream for an inline redline, and guarantees the reconstruction
 * invariant above, which diff.ts neither needs nor offers. Only the ~20-line LCS walk is
 * shared in shape; folding them together would couple this contract to untested render code.
 */

export type DiffSegment = { type: 'equal' | 'removed' | 'added'; text: string };

/** Above this many DP cells the quadratic LCS is too expensive for a foreground,
 *  user-triggered action. Composer drafts are small, so this only ever bites on a
 *  pathological paste: fall back to a trivial two-segment answer (a worse diff,
 *  never a hang). Mirrors the same guard shape as utils/diff.ts's MAX_CELLS. */
const MAX_CELLS = 250_000;

/** Split on whitespace runs, keeping the runs as their own tokens (the capture group in
 *  the regex keeps them in the result) and dropping the empty strings a leading/trailing
 *  run produces. Dropping empties never changes the reconstruction: an empty token
 *  contributes nothing when concatenated back either way. */
function tokenize(text: string): string[] {
	return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/** Merge adjacent segments of the same type into one, so a run of several changed
 *  tokens in a row renders as a single removed/added span instead of one per token. */
function mergeAdjacent(segments: DiffSegment[]): DiffSegment[] {
	const merged: DiffSegment[] = [];
	for (const segment of segments) {
		const last = merged[merged.length - 1];
		if (last && last.type === segment.type) last.text += segment.text;
		else merged.push({ ...segment });
	}
	return merged;
}

/**
 * Word-level diff of two strings. Tokenizes both by whitespace-preserving split, runs a
 * standard LCS over the token arrays, and walks the LCS matrix into equal/removed/added
 * segments: a mismatch prefers `removed` on a tie, so a substitution reads as "old word
 * struck through, then new word inserted" rather than the reverse.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
	const a = tokenize(before);
	const b = tokenize(after);
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return [];

	if (n * m > MAX_CELLS) {
		const segments: DiffSegment[] = [];
		if (before) segments.push({ type: 'removed', text: before });
		if (after) segments.push({ type: 'added', text: after });
		return segments;
	}

	// dp[i][j] = LCS length of a[i..] and b[j..].
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const segments: DiffSegment[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			segments.push({ type: 'equal', text: a[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			segments.push({ type: 'removed', text: a[i] });
			i++;
		} else {
			segments.push({ type: 'added', text: b[j] });
			j++;
		}
	}
	while (i < n) segments.push({ type: 'removed', text: a[i++] });
	while (j < m) segments.push({ type: 'added', text: b[j++] });

	return mergeAdjacent(segments);
}
