/** Line- + word-level diff for side-by-side branch comparisons, with no dependencies. */

export type DiffRow = { type: 'same' | 'add' | 'del' | 'gap'; text: string };

/** A run of text inside a changed line, flagged as changed (added/removed) or carried over. */
export type WordSeg = { text: string; changed: boolean };

/**
 * A rendered diff line. `same`/`gap` are plain; `add`/`del` carry word-level segments so
 * the UI can highlight the exact words that changed inside an otherwise-similar line:
 * the difference between "this whole block changed" and "this one word changed".
 */
export type DiffLine =
	| { type: 'same'; text: string }
	/** A run of unchanged lines left out, named by how many and by where they sit in the
	 *  UNCONDENSED array, which is what lets a view offer to put them back. */
	| { type: 'gap'; count: number; from: number; to: number }
	| { type: 'add'; segs: WordSeg[] }
	| { type: 'del'; segs: WordSeg[] };

// Above this many DP cells we skip the LCS and fall back to a wholesale replacement,
// so a pathological edit can't lock up the UI.
const MAX_CELLS = 1_000_000;

export function lineDiff(before: string, after: string): DiffRow[] {
	const a = before.length ? before.split('\n') : [];
	const b = after.length ? after.split('\n') : [];
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return [];

	if (n * m > MAX_CELLS) {
		return [
			...a.map((text) => ({ type: 'del' as const, text })),
			...b.map((text) => ({ type: 'add' as const, text }))
		];
	}

	// dp[i][j] = LCS length of a[i..] and b[j..].
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const rows: DiffRow[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			rows.push({ type: 'same', text: a[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			rows.push({ type: 'del', text: a[i] });
			i++;
		} else {
			rows.push({ type: 'add', text: b[j] });
			j++;
		}
	}
	while (i < n) rows.push({ type: 'del', text: a[i++] });
	while (j < m) rows.push({ type: 'add', text: b[j++] });
	return rows;
}

/** Split into runs of whitespace / word / punctuation so highlighting lands on whole words. */
function tokenize(text: string): string[] {
	return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu) ?? [];
}

/** Merge adjacent tokens that share a changed-flag into the fewest spans. */
function mergeSegs(tokens: string[], changed: boolean[]): WordSeg[] {
	const segs: WordSeg[] = [];
	for (let k = 0; k < tokens.length; k++) {
		const last = segs[segs.length - 1];
		if (last && last.changed === changed[k]) last.text += tokens[k];
		else segs.push({ text: tokens[k], changed: changed[k] });
	}
	return segs;
}

/**
 * Absorb whitespace-only unchanged spans that sit between two changed spans, then re-merge.
 * Without this, a run of changed words ("so good for you") renders as a separate box per word,
 * because the spaces between them matched as unchanged. One run reads as one highlight.
 */
function coalesceSegs(segs: WordSeg[]): WordSeg[] {
	for (let i = 1; i < segs.length - 1; i++) {
		if (!segs[i].changed && /^\s+$/.test(segs[i].text) && segs[i - 1].changed && segs[i + 1].changed) {
			segs[i].changed = true;
		}
	}
	const out: WordSeg[] = [];
	for (const seg of segs) {
		const last = out[out.length - 1];
		if (last && last.changed === seg.changed) last.text += seg.text;
		else out.push({ text: seg.text, changed: seg.changed });
	}
	return out;
}

/**
 * Word-level diff of two lines: returns the removed line and added line each split into
 * segments, with the words unique to that side flagged `changed`. Shared words stay calm
 * so the eye jumps straight to what actually changed.
 */
export function wordDiff(before: string, after: string): { del: WordSeg[]; add: WordSeg[] } {
	const a = tokenize(before);
	const b = tokenize(after);
	const n = a.length;
	const m = b.length;
	if (n === 0 && m === 0) return { del: [], add: [] };
	if (n * m > MAX_CELLS) {
		return {
			del: before ? [{ text: before, changed: true }] : [],
			add: after ? [{ text: after, changed: true }] : []
		};
	}

	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const aChanged = new Array(n).fill(true);
	const bChanged = new Array(m).fill(true);
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			aChanged[i] = false;
			bChanged[j] = false;
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			i++;
		} else {
			j++;
		}
	}
	return { del: coalesceSegs(mergeSegs(a, aChanged)), add: coalesceSegs(mergeSegs(b, bChanged)) };
}

/**
 * Full line diff enriched with word-level segments. Within each changed block, removed
 * lines are paired with added lines in order and word-diffed against each other; unpaired
 * lines (pure additions/removals) are flagged whole.
 */
export function richDiff(before: string, after: string): DiffLine[] {
	const rows = lineDiff(before, after);
	const out: DiffLine[] = [];
	let k = 0;
	while (k < rows.length) {
		if (rows[k].type === 'same') {
			out.push({ type: 'same', text: rows[k].text });
			k++;
			continue;
		}
		// Collect a maximal run of changed rows, then pair dels with adds for word diffing.
		const dels: string[] = [];
		const adds: string[] = [];
		while (k < rows.length && rows[k].type !== 'same') {
			if (rows[k].type === 'del') dels.push(rows[k].text);
			else adds.push(rows[k].text);
			k++;
		}
		const pairs = Math.min(dels.length, adds.length);
		const paired = Array.from({ length: pairs }, (_, p) => wordDiff(dels[p], adds[p]));
		for (let p = 0; p < dels.length; p++) {
			out.push({ type: 'del', segs: p < pairs ? paired[p].del : wholeLine(dels[p]) });
		}
		for (let p = 0; p < adds.length; p++) {
			out.push({ type: 'add', segs: p < pairs ? paired[p].add : wholeLine(adds[p]) });
		}
	}
	return out;
}

function wholeLine(text: string): WordSeg[] {
	return text ? [{ text, changed: true }] : [{ text: '', changed: false }];
}

/**
 * Collapses long runs of unchanged lines into a single `gap` marker, keeping a few
 * context lines around each change, the compact "hunk" view for inline diffs.
 */
export function condenseLines(lines: DiffLine[], context = 2): DiffLine[] {
	const keep = new Array(lines.length).fill(false);
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].type === 'same') continue;
		for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
	}
	const out: DiffLine[] = [];
	let gapFrom = -1;
	const closeGap = (end: number) => {
		if (gapFrom < 0) return;
		out.push({ type: 'gap', count: end - gapFrom, from: gapFrom, to: end });
		gapFrom = -1;
	};
	for (let i = 0; i < lines.length; i++) {
		if (keep[i]) {
			closeGap(i);
			out.push(lines[i]);
		} else if (gapFrom < 0) {
			gapFrom = i;
		}
	}
	closeGap(lines.length);
	return out;
}

/**
 * For the height-clipped inline preview: drop everything before the first changed line so
 * the change leads the box. Leading unchanged context (which for prose is a whole
 * paragraph) would otherwise fill the clip and push the actual edit out of view. The
 * expanded modal keeps full context.
 */
export function leadWithChange(lines: DiffLine[]): DiffLine[] {
	const first = lines.findIndex((l) => l.type === 'add' || l.type === 'del');
	return first <= 0 ? lines : lines.slice(first);
}

export function diffLineCounts(lines: DiffLine[]): { add: number; del: number } {
	let add = 0;
	let del = 0;
	for (const line of lines) {
		if (line.type === 'add') add++;
		else if (line.type === 'del') del++;
	}
	return { add, del };
}
