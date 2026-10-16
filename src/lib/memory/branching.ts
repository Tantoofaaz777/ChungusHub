/**
 * Tree-/branch-aware coverage resolution.
 *
 * The chat is a message tree; memory follows the active path (root → active leaf). What is
 * archived is not stored anywhere: it is **derived** from the episodes themselves, by
 * tiling the active path with their coverage from the root and stopping at the first gap.
 *
 * That derivation is the whole reason memory survives branching. The same stored episodes
 * yield a deep boundary on a long timeline and a shallow one on a branch that forks below
 * it, and neither answer costs a write. Walking back to the long timeline restores the
 * deep boundary exactly, because the episodes were never touched.
 *
 * So an episode is in one of three standings against the path you are looking at:
 *
 * - **active**: its turns are on this path, inside the tail window, and part of the
 *   gap-free run from the root. It is recalled, and its turns are ghosted.
 * - **dormant**: still perfectly good, just not applicable here. Its turns are on another
 *   branch, or they are inside the verbatim tail, or they sit past a gap this path has.
 *   Kept untouched. It applies again the moment the path comes back to it.
 * - **dead**: it can never apply again. A turn it covers no longer exists in the chat, or
 *   was rewritten after the summary was written, or its coverage has a hole in the path it
 *   otherwise sits on. The summary describes something nobody can read (or nothing this
 *   walk can tile with), so the caller reaps it.
 *
 * Everything here is pure and works off plain message slices, so it is unit-testable with
 * no app dependencies.
 */

import type { Episode, MemoryMessage } from './types';

/** Walk root → leaf, returning the active path in order. Stops cleanly on a bad link. */
export function activePath(messages: MemoryMessage[], leafId: string | null): MemoryMessage[] {
	if (!leafId) return [];
	const byId = new Map(messages.map((m) => [m.id, m]));
	const out: MemoryMessage[] = [];
	const seen = new Set<string>();
	let cur: string | null = leafId;
	while (cur && !seen.has(cur)) {
		const m = byId.get(cur);
		if (!m) break;
		seen.add(cur);
		if (!m.excludedFromPrompt) out.unshift(m);
		cur = m.parentId;
	}
	return out;
}

/** Where every stored episode stands against one active path. See the module header. */
export interface Coverage {
	/** The archive boundary: the last active-path message folded into memory, or null when
	 *  nothing is. Derived on every read; never persisted. */
	cursorMessageId: string | null;
	/** The archived prefix, root → cursor. */
	archivedIds: Set<string>;
	/** Every path turn some episode already covers: the archived prefix plus whatever sits
	 *  past a hole or inside the tail. What is NOT in here is what a build still has to pay
	 *  for, which is why pricing a pass reads this rather than the pending count. */
	onPathCoveredIds: Set<string>;
	/** Episodes covering that prefix, in coverage order (oldest span first). */
	active: Episode[];
	/** Episodes kept but not applicable to this path right now. */
	dormant: Episode[];
	/** Episodes that can never apply again. The caller reaps these. */
	dead: Episode[];
	/**
	 * Exclusive path index the extractor must not fold past, or null when the verbatim tail
	 * is the only limit.
	 *
	 * It is the start of the first episode that is dormant *but still on this path*: a link
	 * the tail floor pushed out, or one stranded past a hole. Those come back on their own,
	 * so folding over them would destroy a summary that was about to apply again, and pay
	 * for the privilege.
	 */
	foldCeilingIndex: number | null;
}

const EMPTY_COVERAGE: Coverage = Object.freeze({
	cursorMessageId: null,
	archivedIds: new Set<string>(),
	onPathCoveredIds: new Set<string>(),
	active: [],
	dormant: [],
	dead: [],
	foldCeilingIndex: null
});

/**
 * The tail actually enforced against a path, never shorter than the configured one.
 *
 * The configured floor of 1 assumes the leaf **is** the last user turn. When the path ends
 * with assistant or system turns it is not, and a tail of 1 then archives the last USER turn.
 * That turn rides `{{chatHistory}}` like every other, and `{{chatHistory}}` filters archived
 * ids, so archiving it drops the turn being answered out of its own prompt entirely, with
 * only a summary standing in for it (architecture/prompt-pipeline.md).
 *
 * So the real invariant is not a number, it is "the last user turn is always live": the
 * tail must clear the trailing run of non-user turns. Reachable from the composer menu
 * (insert a dummy assistant turn, then regenerate) and from Continue, whose path ends on an
 * assistant turn by definition.
 */
function effectiveTail(path: MemoryMessage[], verbatimTail: number): number {
	let lastUser = -1;
	for (let i = path.length - 1; i >= 0; i--) {
		if (path[i].role === 'user') {
			lastUser = i;
			break;
		}
	}
	// No user turn at all: nothing on this path may be archived. There is no last user turn
	// to anchor the live zone on, so there is no safe boundary to derive.
	return Math.max(verbatimTail, path.length - lastUser);
}

/**
 * Resolve every stored episode against the active path, and derive the archive boundary
 * from the ones that apply.
 *
 * `verbatimTail` is a hard floor on the live zone: the boundary may never sit inside the
 * last N messages of the path, so the immediate scene is always in full fidelity. That
 * floor never *deletes* the episodes it pushes past; they simply go dormant, so lowering
 * the tail again, or playing the branch forward past them, brings them straight back at no
 * cost.
 */
export function resolveCoverage(
	allMessages: MemoryMessage[],
	leafId: string | null,
	episodes: Episode[],
	verbatimTail: number
): Coverage {
	if (episodes.length === 0) return EMPTY_COVERAGE;

	const path = activePath(allMessages, leafId);
	const pathIndex = new Map<string, number>();
	path.forEach((m, i) => pathIndex.set(m.id, i));
	// Indexed over the WHOLE tree, not just the path: a legacy off-path turn can be rewritten too,
	// and the summary covering it is just as wrong for it.
	// Membership in this map doubles as "does this turn still exist in the chat".
	const editedAt = new Map(allMessages.filter((m) => !m.excludedFromPrompt).map((m) => [m.id, m.editedAt ?? 0] as const));

	const dead: Episode[] = [];
	const dormant: Episode[] = [];
	/** Starts of dormant episodes that ARE on this path: they gate how far folding may go. */
	const onPathDormantStarts: number[] = [];
	/** Turns some path-resolvable episode already covers, whatever standing it ends up in. */
	const onPathCoveredIds = new Set<string>();
	/** Path-resolvable episodes, keyed by the path index their coverage starts at. */
	const byStart = new Map<number, { ep: Episode; start: number; end: number }>();

	for (const ep of episodes) {
		const ids = ep.sourceMessageIds ?? [];
		// A coverage-less episode can never archive anything and would stall the tiling
		// walk at whatever index it claimed. It is not a state the engine can produce.
		if (ids.length === 0) {
			dead.push(ep);
			continue;
		}
		let gone = false;
		let stale = false;
		for (const id of ids) {
			const edited = editedAt.get(id);
			if (edited === undefined) gone = true;
			// >= so a same-tick rewrite re-folds rather than risking a stale recall. The
			// `> 0` guard keeps a never-edited turn (stamp 0) from reading as edited.
			else if (edited > 0 && edited >= ep.createdAt) stale = true;
		}
		if (gone || stale) {
			dead.push(ep);
			continue;
		}
		let start = Infinity;
		let end = -1;
		let offPath = false;
		for (const id of ids) {
			const i = pathIndex.get(id);
			if (i === undefined) {
				offPath = true;
				break;
			}
			if (i < start) start = i;
			if (i > end) end = i;
		}
		if (offPath) {
			dormant.push(ep);
			continue;
		}
		// Coverage is a contiguous run by construction. A batch is a slice of the path and
		// parent links are immutable, so nothing can be inserted into the middle of a span,
		// and a deletion takes the id out of the tree entirely (caught above as `gone`). A
		// hole here therefore means a bad write reached the table: a promotion that merged
		// two spans with something between them, an imported row, a hand-edited one.
		//
		// DEAD, not dormant, and the difference is the whole chat's memory. Dormant means
		// "will apply again on its own", and this never will: filling the hole means folding
		// past the very index this episode sets as the fold ceiling, so the window is
		// zero-width for as long as the row exists: nothing folds again, ever. Reaping it
		// costs one re-read of its turns and restores forward progress.
		if (end - start + 1 !== ids.length) {
			dead.push(ep);
			continue;
		}
		for (const id of ids) onPathCoveredIds.add(id);
		const clash = byStart.get(start);
		if (!clash) {
			byStart.set(start, { ep, start, end });
		} else if (end > clash.end) {
			// The db forbids overlapping coverage, so this is a repaired-from-elsewhere edge
			// case (a copy, a hand-edited row). Take the longer reach so the walk still makes
			// progress, and leave the loser dormant rather than deleting a summary on a guess.
			dormant.push(clash.ep);
			onPathDormantStarts.push(clash.start);
			byStart.set(start, { ep, start, end });
		} else {
			dormant.push(ep);
			onPathDormantStarts.push(start);
		}
	}

	// Tile from the root. Coverage must be gap-free (a turn is either recalled or sent
	// verbatim, never neither), so the run stops at the first index no episode starts on.
	const chain: { ep: Episode; start: number; end: number }[] = [];
	for (let p = 0; ; ) {
		const next = byStart.get(p);
		if (!next) break;
		chain.push(next);
		byStart.delete(p);
		p = next.end + 1;
	}
	// Whatever is left begins inside (or past) a hole this path has. Dormant, not dead: the
	// batch that bridges the hole can still be folded, and then these apply again.
	for (const leftover of byStart.values()) {
		dormant.push(leftover.ep);
		onPathDormantStarts.push(leftover.start);
	}

	// Apply the tail floor. Ends are strictly increasing along the chain, so the first link
	// that reaches into the tail truncates everything after it too.
	const maxCursorIdx = path.length - 1 - effectiveTail(path, verbatimTail);
	const active: Episode[] = [];
	let cursorIdx = -1;
	let capped = false;
	for (const link of chain) {
		if (capped || link.end > maxCursorIdx) {
			capped = true;
			dormant.push(link.ep);
			onPathDormantStarts.push(link.start);
			continue;
		}
		active.push(link.ep);
		cursorIdx = link.end;
	}

	const archivedIds = new Set<string>();
	for (let i = 0; i <= cursorIdx; i++) archivedIds.add(path[i].id);

	const ahead = onPathDormantStarts.filter((i) => i > cursorIdx);
	return {
		cursorMessageId: cursorIdx >= 0 ? path[cursorIdx].id : null,
		archivedIds,
		onPathCoveredIds,
		active,
		dormant,
		dead,
		foldCeilingIndex: ahead.length ? Math.min(...ahead) : null
	};
}

/**
 * The exclusive path index range the extractor may fold: after the boundary, before the
 * verbatim tail, and before any on-path dormant episode.
 */
function foldWindow(
	path: MemoryMessage[],
	cursorMessageId: string | null,
	verbatimTail: number,
	foldCeilingIndex: number | null
): { start: number; end: number; cappedByCeiling: boolean } {
	const start = cursorMessageId ? path.findIndex((m) => m.id === cursorMessageId) + 1 : 0;
	// A boundary resolved against a different tree can't be positioned here.
	if (start <= 0 && cursorMessageId) return { start: 0, end: 0, cappedByCeiling: false };
	const tailEnd = path.length - effectiveTail(path, verbatimTail);
	const cappedByCeiling = foldCeilingIndex !== null && foldCeilingIndex < tailEnd;
	return { start, end: cappedByCeiling ? foldCeilingIndex! : tailEnd, cappedByCeiling };
}

/**
 * The next extraction batch's messages, or null when none can be folded yet.
 *
 * Normally a batch fires only once a full `batchSize` is eligible. The exception is a hole:
 * when the window is capped by an on-path dormant episode rather than by the tail, a SHORT
 * batch is allowed, sized to close the hole exactly.
 *
 * That exception is load-bearing. Deleting one archived turn kills the summary covering it,
 * leaving a hole `batchSize - 1` wide, narrower than a batch. The tiling walk stops at the
 * first hole, so without a short batch the hole could never be filled, every summary after
 * it would stay dormant forever, and a long chat would quietly go back to sending its
 * entire history verbatim.
 */
export function nextBatch(
	path: MemoryMessage[],
	cursorMessageId: string | null,
	batchSize: number,
	verbatimTail: number,
	foldCeilingIndex: number | null = null
): MemoryMessage[] | null {
	const { start, end, cappedByCeiling } = foldWindow(path, cursorMessageId, verbatimTail, foldCeilingIndex);
	const room = end - start;
	if (room <= 0) return null;
	if (room >= batchSize) return path.slice(start, start + batchSize);
	return cappedByCeiling ? path.slice(start, end) : null;
}

/**
 * Extraction passes this path still owes: the price of a build, which the pending count is
 * not.
 *
 * `pendingCount` stops at the fold ceiling, because that is as far as the *next* batch may
 * reach. One hole therefore prices a whole backlog at a single pass: closing it revives the
 * summaries stranded behind it, the ceiling moves, and two dozen more batches run
 * unannounced. Count the turns nothing covers instead. A run bounded by covered turns costs
 * a batch per `batchSize` plus a short batch for the remainder (that is what the ceiling
 * exception is for); the final run is bounded by the tail, where a partial batch just waits.
 */
export function plannedExtractions(
	path: MemoryMessage[],
	coverage: Coverage,
	batchSize: number,
	verbatimTail: number
): number {
	const tailEnd = path.length - effectiveTail(path, verbatimTail);
	let passes = 0;
	let run = 0;
	for (let i = 0; i < tailEnd; i++) {
		if (coverage.onPathCoveredIds.has(path[i].id)) {
			passes += Math.ceil(run / batchSize);
			run = 0;
		} else {
			run++;
		}
	}
	return passes + Math.floor(run / batchSize);
}

/** Count of archivable-but-not-yet-archived messages (drives the panel's "waiting"). */
export function pendingCount(
	path: MemoryMessage[],
	cursorMessageId: string | null,
	verbatimTail: number,
	foldCeilingIndex: number | null = null
): number {
	const { start, end } = foldWindow(path, cursorMessageId, verbatimTail, foldCeilingIndex);
	return Math.max(0, end - start);
}

/**
 * Dormant episodes whose coverage overlaps `messageIds`: the ones a batch over that span
 * must supersede. Two summaries of the same turns would both render in recall, so the
 * fresh one replaces the stale one in the same transaction that writes it.
 */
export function overlappingEpisodeIds(episodes: Episode[], messageIds: Iterable<string>): string[] {
	const span = new Set(messageIds);
	return episodes.filter((e) => (e.sourceMessageIds ?? []).some((id) => span.has(id))).map((e) => e.id);
}

/**
 * The 1-based seq positions each episode covers on this path, keyed by episode id.
 *
 * A range says everything a coverage list does, because coverage is contiguous on any path
 * that holds all of it. Episodes with a turn off this path get no entry: there is no range
 * to state, and inventing one from the turns that ARE here would name a span the episode
 * does not cover.
 *
 * The same goes for a GAPPY episode, which contiguity makes impossible for anything the
 * engine writes but not for an import, a hand-edited row or a repaired copy (`resolveCoverage`
 * exists partly to catch those). A range over a hole reads as coverage the episode does not
 * have, so such a row gets no entry either rather than a span four turns wider than its truth.
 */
export function episodeSeqRanges(
	path: MemoryMessage[],
	episodes: Episode[]
): Map<string, { from: number; to: number }> {
	const index = new Map(path.map((m, i) => [m.id, i + 1] as const));
	const out = new Map<string, { from: number; to: number }>();
	for (const ep of episodes) {
		const ids = ep.sourceMessageIds ?? [];
		if (!ids.length) continue;
		let from = Infinity;
		let to = -1;
		let complete = true;
		for (const id of ids) {
			const seq = index.get(id);
			if (seq === undefined) {
				complete = false;
				break;
			}
			if (seq < from) from = seq;
			if (seq > to) to = seq;
		}
		if (complete && to - from + 1 === ids.length) out.set(ep.id, { from, to });
	}
	return out;
}

/** What editing or deleting a set of turns costs the chat's memory. See `changeImpact`. */
export interface ChangeImpact {
	/** Summaries in play on this path that the change destroys. */
	dropped: number;
	/** OTHER stored summaries of these turns that go with them: dormant ones, whatever put
	 *  them there. Deliberately not classified further: "belongs to another branch", "sits
	 *  inside the tail" and "is stranded past a hole" all land in the same bucket in
	 *  `Coverage.dormant`, and they return on completely different terms. Say that they go;
	 *  do not promise, or deny, that they come back. */
	droppedStored: number;
	/** Summaries after the resulting hole that stop applying until it is closed. Their rows
	 *  are untouched and they all return together the moment it is. */
	paused: number;
	/** Turns of the dropped coverage that outlive the change. Zero when it removes that
	 *  coverage whole, which is the one shape that leaves no hole behind. */
	survivors: number;
	/** Of those, the ones a fold can still reach. Survivors pushed into the verbatim tail by
	 *  a shortened path are NOT re-read; they simply go back to being sent in full. */
	reread: number;
	/** Model calls that re-read costs, and it can be zero while `reread` is not: a run shorter
	 *  than a batch only folds when something covered sits after it (the short-batch
	 *  exception). Nothing may promise a pass this does not count. */
	passes: number;
	/** 1-based seq span of the dropped coverage, or null when no summary in play is hit. */
	span: { from: number; to: number } | null;
}

export const EMPTY_IMPACT: ChangeImpact = Object.freeze({
	dropped: 0,
	droppedStored: 0,
	paused: 0,
	survivors: 0,
	reread: 0,
	passes: 0,
	span: null
});

/**
 * Price a rewrite or a delete against stored memory, before it happens.
 *
 * Both actions kill exactly the summaries that COVER a touched turn: a rewrite outdates
 * them (`edited_at`), a delete leaves them describing text nobody can read. Everything
 * after the resulting hole pauses rather than dies, because the tiling walk stops at the
 * first gap; closing the hole brings the lot back in one tick.
 *
 * `removed` is the whole difference between the two, and it costs more than a subtraction: a
 * delete takes turns out of the path, so the survivors of the dropped coverage have to be
 * re-positioned against the SHORTENED path before they can be called re-readable. A subtree
 * delete is a suffix, so the turns just above the cut land inside the verbatim tail and no
 * pass will ever reach them. Counting them as re-read is a promise the engine never keeps.
 */
export function changeImpact(
	path: MemoryMessage[],
	coverage: Coverage,
	changedIds: Iterable<string>,
	opts: { removed: boolean; batchSize: number; verbatimTail: number }
): ChangeImpact {
	const changed = new Set(changedIds);
	if (!changed.size) return EMPTY_IMPACT;
	const hits = (ep: Episode) => (ep.sourceMessageIds ?? []).some((id) => changed.has(id));

	const droppedStored = coverage.dormant.filter(hits).length;
	const first = coverage.active.findIndex(hits);
	if (first === -1) return droppedStored ? { ...EMPTY_IMPACT, droppedStored } : EMPTY_IMPACT;
	const dropped = coverage.active.filter(hits);

	// The path as it will stand afterwards, which is what decides whether a surviving turn is
	// still foldable. A rewrite leaves it alone; a delete takes its turns out of it.
	const after = opts.removed ? path.filter((m) => !changed.has(m.id)) : path;
	const afterIndex = new Map(after.map((m, i) => [m.id, i] as const));
	const foldEnd = after.length - effectiveTail(after, opts.verbatimTail);

	let survivors = 0;
	let reread = 0;
	for (const ep of dropped) {
		for (const id of ep.sourceMessageIds ?? []) {
			const i = afterIndex.get(id);
			if (i === undefined) continue;
			survivors += 1;
			if (i < foldEnd) reread += 1;
		}
	}

	const ranges = episodeSeqRanges(path, dropped);
	let from = Infinity;
	let to = -1;
	for (const r of ranges.values()) {
		if (r.from < from) from = r.from;
		if (r.to > to) to = r.to;
	}

	// Only a hole pauses anything. Episodes between the first drop and the last are dropped
	// themselves, so excluding them is what keeps this a count of survivors.
	const paused = survivors > 0 ? coverage.active.slice(first + 1).filter((e) => !hits(e)).length : 0;
	return {
		dropped: dropped.length,
		droppedStored,
		paused,
		survivors,
		reread,
		// The same rule `plannedExtractions` uses: a run with covered turns after it can close
		// on a short batch, while one bounded by the tail leaves its remainder waiting. It
		// treats the survivors as ONE run, which holds for both callers: a rewrite touches a
		// single episode, and a subtree delete takes a contiguous suffix. A caller that could
		// punch two separate holes would need a run-by-run count instead.
		passes: paused > 0 ? Math.ceil(reread / batchSizeOf(opts.batchSize)) : Math.floor(reread / batchSizeOf(opts.batchSize)),
		span: to >= 0 ? { from, to } : null
	};
}

/** A batch size of zero would price every re-read as infinite passes. */
function batchSizeOf(batchSize: number): number {
	return Math.max(1, Math.floor(batchSize));
}
