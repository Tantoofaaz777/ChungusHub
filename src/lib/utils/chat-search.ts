/**
 * Find-in-chat: turning a query into highlightable spans of the rendered transcript.
 *
 * The search runs over the RENDERED text, never the stored rows. Display regex rules,
 * {{char}}/{{user}} expansion and markdown have all been applied by the time a turn is on
 * screen (architecture/chat-sessions.md coupling 6), so matching the DOM is the only way "what I
 * read" and "what I searched" can agree. It also lets a match cross inline markup, which
 * the reader sees as one run of text and the DOM stores as three separate nodes.
 *
 * Nothing here mutates message markup: matches come back as DOM Ranges, which the search
 * bar paints through the CSS Custom Highlight API. Svelte's {@html} ownership and Copy
 * both stay byte-identical.
 */

/** Ceiling on the ranges handed to the highlight registry. A one-letter query in a long
 *  story matches tens of thousands of times, and painting them all stalls the tab for no
 *  reader value. The bar shows the cap as "N+" rather than truncating quietly. */
export const MAX_MATCHES = 2000;

/** Ceiling on the off-path branch rows listed. Same honesty rule as MAX_MATCHES: the bar
 *  says "N+" rather than pretending the list is complete. */
export const MAX_BRANCH_HITS = 100;

/** Characters of context kept either side of a branch hit's first match. */
const SNIPPET_PAD = 60;

/** Elements that do NOT break a run of text. Everything else (p, li, blockquote, pre, td,
 *  br, …) ends the segment, so a match can never span two blocks: "Ali" and "Veli" in
 *  adjacent <li>s must not read as the single word "AliVeli" to a whole-word search. */
const INLINE_TAGS = new Set([
	'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DEL', 'DFN', 'EM', 'I', 'INS', 'KBD',
	'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR'
]);

/** Only the regex syntax characters: under the `u` flag every other backslash escape (the
 *  usual `\-`, `\/`) is a SyntaxError, so over-escaping would break the pattern outright. */
function escapeLiteral(query: string): string {
	return query.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** The dotted/dotless i family. Unicode's default case folding pairs I↔i and leaves ı and İ
 *  alone, so a case-insensitive search for "kapı" silently misses "KAPI" and one for
 *  "istanbul" misses "İstanbul", a quiet wrong answer in prose that uses them. With match case
 *  off all four fold onto each other; with it on they stay four distinct letters. Every one
 *  is a single UTF-16 unit, so match lengths are unaffected. */
const DOTTED_I = new Set(['i', 'ı', 'I', 'İ']);
const DOTTED_I_CLASS = '[iıIİ]';

/** The query as a regex body: a literal, one code point at a time. */
function literalBody(query: string, matchCase: boolean): string {
	let body = '';
	for (const char of query) {
		body += !matchCase && DOTTED_I.has(char) ? DOTTED_I_CLASS : escapeLiteral(char);
	}
	return body;
}

/**
 * The matcher for a raw query, or null when there is nothing to search for. Deliberately
 * not trimmed: a leading space is a legitimate thing to look for, exactly as in a
 * browser's find bar.
 */
export function buildSearchRegex(
	query: string,
	opts: { matchCase: boolean; wholeWord: boolean }
): RegExp | null {
	if (!query) return null;
	let body = literalBody(query, opts.matchCase);
	if (opts.wholeWord) {
		// \b is ASCII-only, which is useless past ASCII prose: it never fires beside "ş",
		// so a whole-word search for "şey" would find nothing at all, while "eyler" would
		// happily match inside "şeyler". Unicode letter/number lookarounds are the only
		// correct boundary here.
		body = `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`;
	}
	return new RegExp(body, opts.matchCase ? 'gu' : 'giu');
}

/** A turn that matched somewhere off the branch currently on screen. */
export interface BranchHit {
	messageId: string;
	role: string;
	/** How many times the query matches in this turn. */
	count: number;
	/** The first match with a little context either side, on one line. */
	snippet: string;
}

/**
 * Matches in turns that are NOT rendered: the swipes, alternates and abandoned forks that
 * hang off the visible path. There is no DOM for them, so this searches the stored text and
 * can only report a turn, never a Range: reaching one means navigating to its branch first,
 * at which point it becomes an ordinary on-screen match.
 *
 * That makes the two halves of the search deliberately asymmetric. On-path matching sees the
 * rendered text (markdown resolved, display regex applied); this sees the row as written.
 * Callers expand {{char}}/{{user}} before handing text in, the same call the story map's
 * search makes, and the same reason: a greeting stores its macros raw, so without it a search
 * for the character's own name would skip every greeting.
 */
export function findBranchHits(
	turns: { id: string; role: string; text: string }[],
	regex: RegExp,
	budget: number
): BranchHit[] {
	const hits: BranchHit[] = [];
	if (budget <= 0) return hits;

	for (const turn of turns) {
		const found = [...turn.text.matchAll(regex)];
		if (!found.length) continue;
		const at = found[0].index;
		const from = Math.max(0, at - SNIPPET_PAD);
		const to = Math.min(turn.text.length, at + found[0][0].length + SNIPPET_PAD);
		// Collapsed to one line: the row is a single-line preview, and raw markdown carries
		// newlines that would otherwise blow its height out.
		const body = turn.text.slice(from, to).replace(/\s+/g, ' ').trim();
		hits.push({
			messageId: turn.id,
			role: turn.role,
			count: found.length,
			snippet: `${from > 0 ? '…' : ''}${body}${to < turn.text.length ? '…' : ''}`
		});
		if (hits.length >= budget) break;
	}
	return hits;
}

/** One text node's slice of a segment's joined text. */
interface Chunk {
	node: Text;
	start: number;
	end: number;
}

/** A run of text with no block break inside it, plus the nodes it was joined from. */
interface Segment {
	text: string;
	chunks: Chunk[];
}

/** Split a rendered message into block-bounded runs of text. Joining per block (rather
 *  than one string for the whole message with separators stitched in) keeps every offset
 *  inside a real text node, so the offset → Range mapping below needs no clamping. */
function segmentsOf(root: Element): Segment[] {
	const segments: Segment[] = [];
	let current: Segment = { text: '', chunks: [] };
	const close = () => {
		if (current.text) segments.push(current);
		current = { text: '', chunks: [] };
	};

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.nodeType === Node.ELEMENT_NODE) {
			if (!INLINE_TAGS.has((node as Element).tagName)) close();
			continue;
		}
		const text = node as Text;
		if (!text.data) continue;
		current.chunks.push({
			node: text,
			start: current.text.length,
			end: current.text.length + text.data.length
		});
		current.text += text.data;
	}
	close();
	return segments;
}

/**
 * Every match of `regex` inside `root`, as Ranges in document order, capped at `budget`.
 * A match may start in one inline element and end in another: that is the whole point of
 * joining the text nodes first.
 */
export function findMatchRanges(root: Element, regex: RegExp, budget: number): Range[] {
	const found: Range[] = [];
	if (budget <= 0) return found;

	for (const segment of segmentsOf(root)) {
		// matchAll runs off a clone of the regex, so one instance is safe to reuse across
		// every segment of every message: lastIndex never carries over.
		let first = 0;
		for (const match of segment.text.matchAll(regex)) {
			const from = match.index;
			const to = from + match[0].length;
			// Matches arrive in ascending order, so the chunk cursor only ever moves forward.
			while (segment.chunks[first].end <= from) first++;
			let last = first;
			while (last + 1 < segment.chunks.length && segment.chunks[last + 1].start < to) last++;

			const range = document.createRange();
			range.setStart(segment.chunks[first].node, from - segment.chunks[first].start);
			range.setEnd(segment.chunks[last].node, to - segment.chunks[last].start);
			found.push(range);
			if (found.length >= budget) return found;
		}
	}
	return found;
}
