/**
 * The memory engine: extraction batches, recursive promotion, and branch reconciliation.
 *
 * It orchestrates the pure helpers (branching/prompts/recall) against two injected
 * ports, a MemoryDb and an LlmFn, so it can be driven by the real app or by in-memory
 * fakes in tests. It generates no ids or timestamps itself; the db adapter owns those.
 *
 * Reconciling with a branch change is not a write here. The archive boundary is derived
 * from the stored episodes on every read (`resolveCoverage`), so switching branches costs
 * nothing and loses nothing. The only thing ever deleted is an episode whose turns are
 * gone from the chat or were rewritten under it.
 */

import {
	activePath,
	nextBatch,
	overlappingEpisodeIds,
	pendingCount,
	plannedExtractions,
	resolveCoverage,
	type Coverage
} from './branching';
import {
	buildExtractionMessages,
	buildPromotionMessages,
	longestRepeatedRun,
	parseEpisode
} from './prompts';
import { EXTRACT_CONTEXT_EPISODES, resolveConfig } from './config';
import type { BatchResult, Episode, LlmFn, MemoryConfig, MemoryDb, MemoryMessage, PromotionResult } from './types';

export interface EngineTemplates {
	extract: string;
	promote: string;
}

export interface EngineDeps {
	db: MemoryDb;
	llm: LlmFn;
	templates: EngineTemplates;
	/** Rendered character + persona sheets (same text the generation prompt shows), injected
	 *  into extraction so the summary never re-states what the cards already say.
	 *  Optional: tests / headless paths omit it and the extractor just sees "(none)". */
	cards?: { character: string; persona: string };
	/** Resolves the global engine macros a template references ({{user}}, {{char}}, …), so
	 *  memory templates share the app-wide macro pool. Flow values win on a collision.
	 *  Optional: tests / headless paths omit it and only the flow macros resolve. */
	globals?: (template: string) => Record<string, string>;
}

/** The tree a pass works against. */
export interface TreeSnapshot {
	allMessages: MemoryMessage[];
	leafId: string | null;
}

export interface ProcessOptions {
	signal?: AbortSignal;
	/**
	 * Re-asked before every model call: false ends the run, as an abort would.
	 *
	 * The signal covers what the caller knew when it started. This covers what changes under
	 * it: the app-wide Chat Memory switch, and a preset edited to drop `{{memory}}`. Neither
	 * touches this chat's own `enabled` flag (the only gate the engine can see for itself),
	 * so without this a build carried on spending paid calls after the user switched the
	 * whole engine off, with the Stop button already unmounted behind it.
	 */
	stillActive?: () => boolean;
	/** Cap batches processed in one call (keeps a foreground build responsive). */
	maxBatches?: number;
	/**
	 * Cap merge calls across the whole run. Promotion answers to the layer caps rather than
	 * to the backlog, so a `maxPerLayer` dragged from 60 to 3 owes dozens of paid merges at
	 * once, and the automatic post-turn pass must not spend them on a trigger as small as
	 * sending a message. Omitted = unlimited, which is right only for a run the user priced
	 * and confirmed.
	 */
	maxPromotions?: number;
	/** Called after each batch, for live progress. */
	onProgress?: (info: ProcessProgress) => void;
	/**
	 * Re-read the tree before every commit. A build over a long backlog runs for minutes, and
	 * the user keeps playing, branching, editing and deleting through it. Without this the
	 * loop folds against the snapshot it started with and can summarise turns that no longer
	 * exist, burning a paid call on an episode the next pass immediately reaps.
	 *
	 * It is also the ONLY way an edit made mid-call is detectable: the systemic staleness
	 * rule compares `edited_at` against the episode's `created_at`, and an episode written
	 * after the edit passes that test forever. Omitted (tests, one-shot paths) = the initial
	 * snapshot is reused, and that race is not covered.
	 */
	latest?: () => TreeSnapshot;
}

export interface ProcessProgress {
	phase: 'reconcile' | 'extract' | 'done';
	batchesDone: number;
	/** Merge calls spent so far. Reported separately because they are paid calls the batch
	 *  count says nothing about: a lowered layer cap can owe more of them than there are
	 *  batches, and folding them into the batch count renders the whole lot as "pass 1". */
	promotionsDone: number;
	pending: number;
	cursorMessageId: string | null;
}

export interface ProcessResult {
	/** True when episodes were reaped: their turns are back in the live prompt. */
	reaped: number;
	batchesDone: number;
	promotionsDone: number;
	cursorMessageId: string | null;
	/** True when the run stopped because `maxBatches` was reached with work still pending. */
	capped: boolean;
}

/**
 * A repeated run this long is a degenerate n-gram loop, not prose. Real summaries reuse
 * short phrases; they do not re-emit a dozen words verbatim inside one paragraph.
 */
const MAX_REPEATED_RUN = 12;

/**
 * Placeholders a memory template cannot do its job without.
 *
 * The templates are user-editable, and deleting one of these is silent damage of exactly
 * the kind the engine refuses everywhere else: an extraction prompt with no `{{batch}}`
 * still returns *something*, which then gets committed as the summary of turns that are
 * dropped from the prompt in its favour. Check before spending the call.
 */
const REQUIRED_EXTRACT_MACROS = ['{{batch}}'];
const REQUIRED_PROMOTE_MACROS = ['{{episodes}}'];

function assertTemplate(template: string, required: string[], label: string): void {
	const missing = required.filter((m) => !template.includes(m));
	if (missing.length) {
		throw new Error(
			`Memory ${label} template is missing ${missing.join(', ')}. Without it the model never sees the text it is meant to summarize. Restore it in Settings → Engines → Chat Memory.`
		);
	}
}

/**
 * Episodes of one layer, IN STORY ORDER, which means `episodes` must already be in it
 * (`Coverage.active` is; a raw table read is not).
 *
 * Nothing is sorted by `createdAt` here any more, and that is load-bearing. Write time
 * stopped being a proxy for story position the moment holes became re-foldable: a stretch
 * re-read after a deleted turn produces the NEWEST row covering some of the OLDEST turns.
 * Promotion picking "the oldest N by createdAt" would then merge two spans with a gap
 * between them, and a merged episode whose coverage isn't contiguous can never apply to any
 * path again, taking its sources' coverage down with it.
 */
function episodesAtLayer(episodes: Episode[], layer: number): Episode[] {
	return episodes.filter((e) => e.layer === layer);
}

/**
 * The oldest run of `count` episodes at `layer` that are ADJACENT in `active`, the only
 * selection a promotion may merge.
 *
 * `Coverage.active` is the tiling chain, so each link starts where the previous one ended:
 * a run of consecutive entries covers one unbroken span, and any other selection does not.
 * Being at the same layer is NOT adjacency. Once a hole is re-folded in front of an
 * already-promoted region, that region's higher-layer block sits between the fresh layer-0
 * episode and the rest of layer 0, and merging across it produces an episode whose
 * coverage has a hole, which can never apply to any path again and takes its sources'
 * coverage down with it. Returns [] when no such run exists; the layer then stays over its
 * cap, which is a cost, not a corruption.
 */
function oldestAdjacentRun(active: Episode[], layer: number, count: number): Episode[] {
	let run: Episode[] = [];
	for (const ep of active) {
		if (ep.layer !== layer) {
			run = [];
			continue;
		}
		run.push(ep);
		if (run.length === count) return run;
	}
	return [];
}

/**
 * One extraction LLM call, validated. Returns the episode text.
 *
 * A compliant extraction always carries an episode (the template mandates exactly one).
 * An empty one means the response was refused, truncated, or not the JSON we asked for;
 * a long verbatim repeat means the model looped. Either way, committing it would bake a
 * broken scene into canon permanently (every later promotion preserves it faithfully), so
 * retry once and then fail loud, leaving the boundary put for the next pass.
 */
async function extractEpisode(
	deps: EngineDeps,
	batch: MemoryMessage[],
	deep: Episode[],
	recent: Episode[],
	signal?: AbortSignal
): Promise<string> {
	const messages = buildExtractionMessages(
		deps.templates.extract,
		{
			character: deps.cards?.character ?? '',
			persona: deps.cards?.persona ?? '',
			deep,
			recent,
			batch
		},
		deps.globals?.(deps.templates.extract)
	);

	let lastProblem = '';
	for (let attempt = 0; attempt < 2; attempt++) {
		const raw = await deps.llm(messages, signal);
		const episode = parseEpisode(raw);
		if (!episode) {
			lastProblem = `returned no episode (response started: "${raw.slice(0, 160)}")`;
			continue;
		}
		const repeat = longestRepeatedRun(episode);
		if (repeat >= MAX_REPEATED_RUN) {
			lastProblem = `looped, repeating ${repeat} words verbatim (episode started: "${episode.slice(0, 160)}")`;
			continue;
		}
		return episode;
	}
	throw new Error(`Memory extraction ${lastProblem}`);
}

/** Build the BatchResult for one batch. */
async function extractBatch(
	deps: EngineDeps,
	batch: MemoryMessage[],
	coverage: Coverage,
	signal?: AbortSignal
): Promise<BatchResult> {
	assertTemplate(deps.templates.extract, REQUIRED_EXTRACT_MACROS, 'summarizing');
	// The "already summarised, do not restate" context is the ACTIVE set, not the table.
	// Showing the extractor another branch's summaries would tell it to leave out events
	// this branch never had, and it has no way to tell the difference.
	const deep = coverage.active.filter((e) => e.layer >= 1);
	const recent = episodesAtLayer(coverage.active, 0).slice(-EXTRACT_CONTEXT_EPISODES);

	const content = await extractEpisode(deps, batch, deep, recent, signal);
	const ids = batch.map((m) => m.id);

	return {
		episode: { content, sourceMessageIds: ids, anchorMessageId: ids[ids.length - 1] },
		// A dormant summary of the same ground was written on a branch this one abandons;
		// the fresh one is authoritative, and two summaries of one span would double-cover.
		supersedeEpisodeIds: overlappingEpisodeIds(coverage.dormant, ids)
	};
}

/**
 * One promotion step at `fromLayer`, over the episodes that currently apply. Returns whether
 * a merge was written (and so whether a model call was spent).
 *
 * `active` (not the whole table), because a dormant episode belongs to another branch:
 * merging it into this branch's ladder would drag that branch's events into this story and
 * strand the merged result the moment the reader walks back.
 *
 * **Opening a fresh layer is not a special case.** A promotion is always `promoteCount`
 * adjacent episodes merged into one, whether or not the layer above already holds anything;
 * an empty one simply gives the merge no already-compacted context to write around. Anything
 * that relabels a single episode upward instead spends no call and compresses nothing, so the
 * oldest span of the story (the one with the most to gain) arrives at the top of the ladder
 * at raw layer-0 length, carried up untouched at every layer it passes through, while its
 * neighbours hold dozens of turns each.
 */
async function promoteOnce(
	deps: EngineDeps,
	chatId: string,
	config: MemoryConfig,
	active: Episode[],
	fromLayer: number,
	signal?: AbortSignal
): Promise<boolean> {
	const inPlace = fromLayer >= config.maxLayers - 1;
	const targetLayer = inPlace ? fromLayer : fromLayer + 1;
	const higher = inPlace ? [] : episodesAtLayer(active, targetLayer);

	const oldest = oldestAdjacentRun(active, fromLayer, config.promoteCount);
	if (oldest.length < config.promoteCount) return false;

	assertTemplate(deps.templates.promote, REQUIRED_PROMOTE_MACROS, 'compaction');
	const reference = inPlace ? episodesAtLayer(active, fromLayer).filter((e) => !oldest.includes(e)) : higher;
	const messages = buildPromotionMessages(
		deps.templates.promote,
		{ higher: reference, merge: oldest, inPlace },
		deps.globals?.(deps.templates.promote)
	);
	const merged = parseEpisode(await deps.llm(messages, signal));
	// A failed merge falls back to concatenation rather than throwing: unlike extraction,
	// nothing is lost by keeping the sources' own text. It is only bigger than it should
	// be, and the next promotion pass gets another chance at compacting it.
	const content = merged || oldest.map((e) => e.content).join(' ');

	const sourceMessageIds = [...new Set(oldest.flatMap((e) => e.sourceMessageIds))];
	const anchorMessageId = oldest[oldest.length - 1].anchorMessageId;
	const result: PromotionResult = {
		insert: { layer: targetLayer, content, sourceMessageIds, anchorMessageId },
		deleteEpisodeIds: oldest.map((e) => e.id)
	};
	await deps.db.applyPromotion(chatId, result);
	return true;
}

/**
 * A runaway backstop, not the real limit. The real one is the run's promotion budget
 * (`ProcessOptions.maxPromotions`); this only stops a mis-shaped ladder spinning forever.
 */
const PROMOTION_GUARD = 200;

/**
 * Promote across all layers until every layer is within its cap, or the budget runs out.
 * Returns the number of model calls spent, which is one per merge.
 *
 * Layers at or above `maxLayers` are compacted too, at their own level. Skip them and
 * lowering the setting strands whatever already sits above the new ceiling: it falls out of
 * the loop's range entirely and grows forever while the panel reports a shallower ladder.
 *
 * The budget is per RUN, shared across every batch: promotion is driven by the layer caps,
 * not by the backlog, so a lowered `maxPerLayer` owes dozens of merges at once and the
 * automatic post-turn pass must not spend them on a trigger as small as sending a message.
 */
async function checkAndPromote(
	deps: EngineDeps,
	chatId: string,
	config: MemoryConfig,
	tree: TreeSnapshot,
	budget: { left: number },
	opts: ProcessOptions
): Promise<number> {
	let spent = 0;
	// Re-read each round so counts reflect prior promotions, and re-resolve so a branch
	// change mid-build can't merge episodes that just went dormant.
	for (let guard = 0; guard < PROMOTION_GUARD; guard++) {
		if (stopped(opts) || budget.left <= 0) return spent;
		const { active } = resolveCoverage(
			tree.allMessages,
			tree.leafId,
			await deps.db.listEpisodes(chatId),
			config.verbatimTail
		);
		const layers = [...new Set(active.map((e) => e.layer))].sort((a, b) => a - b);
		const over = layers.filter((l) => episodesAtLayer(active, l).length > config.maxPerLayer);
		if (over.length === 0) return spent;
		// A layer can be over its cap with nothing mergeable at it: a higher-layer block
		// between its episodes splits them into runs shorter than promoteCount, and merging
		// across that block is exactly what must never happen. Try the next over-cap layer
		// rather than stalling the whole ladder on the lowest one.
		let progressed = false;
		for (const layer of over) {
			if (!(await promoteOnce(deps, chatId, config, active, layer, opts.signal))) continue;
			budget.left--;
			spent++;
			progressed = true;
			break;
		}
		if (!progressed) return spent;
	}
	return spent;
}

/**
 * Merge calls the ladder still owes, once `extractions` more layer-0 episodes land: the
 * other half of what a build costs, and the half a price is most likely to leave out.
 *
 * Promotion fires from the layer caps, not from the backlog, so dragging `maxPerLayer` down
 * turns one ordinary reply into dozens of paid merges. This walks the same rules
 * `checkAndPromote` does, over layer counts alone: each merge takes `promoteCount` episodes
 * off a layer and puts one on the layer above (or back on the same layer, at the top), and an
 * empty layer above is no exception: it is filled by a merge like any other. Total episodes
 * strictly drop every step, so it terminates. Adjacency can only make the real number
 * smaller, never larger.
 */
export function plannedPromotions(active: Episode[], config: MemoryConfig, extractions: number): number {
	const counts = new Map<number, number>();
	for (const e of active) counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);
	counts.set(0, (counts.get(0) ?? 0) + extractions);

	let calls = 0;
	for (let guard = 0; guard < PROMOTION_GUARD; guard++) {
		const over = [...counts.keys()].sort((a, b) => a - b).find((l) => (counts.get(l) ?? 0) > config.maxPerLayer);
		if (over === undefined) return calls;
		const target = over >= config.maxLayers - 1 ? over : over + 1;
		counts.set(over, counts.get(over)! - config.promoteCount);
		counts.set(target, (counts.get(target) ?? 0) + 1);
		calls++;
	}
	return calls;
}

/** Abort, or a gate the caller owns that has closed since the run started. */
function stopped(opts: ProcessOptions): boolean {
	return opts.signal?.aborted === true || opts.stillActive?.() === false;
}

/**
 * Did any turn in the batch change its wording (or vanish) between being read and now?
 *
 * `edited_at` is the systemic staleness signal, but the ordinary rule compares it against
 * the episode's `created_at`, which is stamped only once the model has answered. An edit
 * that lands mid-call therefore *predates* the summary it invalidates, so that summary
 * reads as fresh forever while describing text the user has already replaced, and every
 * later pass agrees with it. The only honest comparison for a batch in flight is against
 * the wording it was actually read with.
 */
function rewrittenSinceRead(tree: TreeSnapshot, readAs: Map<string, number>): boolean {
	const now = new Map(tree.allMessages.filter((m) => !m.excludedFromPrompt).map((m) => [m.id, m.editedAt ?? 0] as const));
	for (const [id, stamp] of readAs) {
		if (now.get(id) !== stamp) return true;
	}
	return false;
}

/**
 * Reconcile memory with the active path and extract any newly-eligible batches.
 * Safe to call after every turn and on chat load: it no-ops when there's nothing to do.
 */
export async function processChat(
	deps: EngineDeps,
	chatId: string,
	allMessages: MemoryMessage[],
	leafId: string | null,
	opts: ProcessOptions = {}
): Promise<ProcessResult> {
	const state = await deps.db.getState(chatId);
	if (!state || !state.enabled) {
		return { reaped: 0, batchesDone: 0, promotionsDone: 0, cursorMessageId: null, capped: false };
	}
	const config = resolveConfig(state.config);
	let tree: TreeSnapshot = { allMessages, leafId };

	// 1. Reap: the only destructive step, and only for episodes that can never apply again.
	const reaped = await reap(deps, chatId, tree, config);

	let coverage = resolveCoverage(tree.allMessages, tree.leafId, await deps.db.listEpisodes(chatId), config.verbatimTail);
	let path = activePath(tree.allMessages, tree.leafId);
	opts.onProgress?.({
		phase: reaped ? 'reconcile' : 'extract',
		batchesDone: 0,
		promotionsDone: 0,
		pending: pending(path, coverage, config),
		cursorMessageId: coverage.cursorMessageId
	});

	// 2. Extract eligible batches.
	let batchesDone = 0;
	const cap = opts.maxBatches ?? Infinity;
	let capped = false;
	// One budget for the whole run, not one per batch: the merges owed by a lowered layer
	// cap are owed once, and charging them per batch is how three extraction passes turned
	// into hundreds of paid calls.
	const budget = { left: opts.maxPromotions ?? Infinity };
	let promotionsDone = 0;

	while (true) {
		if (stopped(opts)) break;
		const batch = nextBatch(path, coverage.cursorMessageId, config.batchSize, config.verbatimTail, coverage.foldCeilingIndex);
		if (!batch) break;
		if (batchesDone >= cap) {
			capped = true;
			break;
		}

		// The wording this summary is about to describe, as of the moment it was read.
		const readAs = new Map(batch.map((m) => [m.id, m.editedAt ?? 0] as const));
		const result = await extractBatch(deps, batch, coverage, opts.signal);
		// A branch switch may have landed while the model was answering: committing now
		// would summarise a span the reader has left. The db-side overlap guard is the hard
		// guarantee; this check just avoids burning it needlessly.
		if (stopped(opts)) break;

		// Re-read the tree BEFORE writing anything: the user keeps playing, editing and
		// deleting through a call that takes seconds, and both the commit below and the
		// promotion after it must judge the chat as it stands now, not as it stood a model
		// call ago.
		if (opts.latest) tree = opts.latest();
		if (rewrittenSinceRead(tree, readAs)) {
			capped = true;
			break;
		}

		const boundaryBefore = coverage.cursorMessageId;
		await deps.db.applyBatch(chatId, result);
		batchesDone++;

		promotionsDone += await checkAndPromote(deps, chatId, config, tree, budget, opts);

		coverage = resolveCoverage(tree.allMessages, tree.leafId, await deps.db.listEpisodes(chatId), config.verbatimTail);
		path = activePath(tree.allMessages, tree.leafId);

		// A batch that doesn't move the boundary is a batch that didn't apply, the commonest
		// cause being the user rewriting one of its turns while the model was answering, which
		// outdates the summary the moment it lands. Stop rather than re-fold the same span:
		// the next pass reaps the stillborn episode first and then re-reads it properly.
		if (coverage.cursorMessageId === boundaryBefore) {
			capped = true;
			break;
		}
		opts.onProgress?.({
			phase: 'extract',
			batchesDone,
			promotionsDone,
			pending: pending(path, coverage, config),
			cursorMessageId: coverage.cursorMessageId
		});
	}

	// 3. Compact, whether or not anything was folded. Promotion answers to the layer caps,
	// not to the backlog, so lowering `maxPerLayer` owes merges on a chat with nothing left
	// to extract, and inside the loop above that debt was simply unreachable: it waited for
	// a batch that might be a dozen turns away.
	promotionsDone += await checkAndPromote(deps, chatId, config, tree, budget, opts);

	opts.onProgress?.({
		phase: 'done',
		batchesDone,
		promotionsDone,
		pending: pending(path, coverage, config),
		cursorMessageId: coverage.cursorMessageId
	});
	return { reaped, batchesDone, promotionsDone, cursorMessageId: coverage.cursorMessageId, capped };
}

/** Delete the episodes that can never apply again. Returns how many went. */
async function reap(deps: Pick<EngineDeps, 'db'>, chatId: string, tree: TreeSnapshot, config: MemoryConfig): Promise<number> {
	const { dead } = resolveCoverage(
		tree.allMessages,
		tree.leafId,
		await deps.db.listEpisodes(chatId),
		config.verbatimTail
	);
	if (dead.length === 0) return 0;
	await deps.db.reapEpisodes(chatId, dead.map((e) => e.id));
	return dead.length;
}

/**
 * Reconcile only, no LLM. Reaps episodes whose turns were deleted or rewritten.
 *
 * A branch change alone reaches this and finds nothing to do, which is the point: the
 * boundary that moved was derived, not stored, so it has already moved by the time anyone
 * reads it. Only genuine loss (a deleted turn, an in-place rewrite) writes anything.
 */
export async function syncCoverage(
	deps: Pick<EngineDeps, 'db'>,
	chatId: string,
	allMessages: MemoryMessage[],
	leafId: string | null
): Promise<{ reaped: number }> {
	const state = await deps.db.getState(chatId);
	if (!state || !state.enabled) return { reaped: 0 };
	const config = resolveConfig(state.config);
	return { reaped: await reap(deps, chatId, { allMessages, leafId }, config) };
}

/** Turns waiting to be folded, honouring both the tail and the fold ceiling. */
function pending(path: MemoryMessage[], coverage: Coverage, config: MemoryConfig): number {
	return pendingCount(path, coverage.cursorMessageId, config.verbatimTail, coverage.foldCeilingIndex);
}

/**
 * What a build will cost, in model calls, before it is started.
 *
 * Both halves are real money and both are easy to misreport. Derive extractions from the
 * pending count, which stops at the fold ceiling, and one hole prices a 24-pass backlog at a
 * single pass. Leave promotions out on the theory that they are a fraction of the
 * extractions, and a 1200-message import makes them a fifth of the total, nearly all of it
 * once a layer cap is dragged down.
 */
export function plannedWork(
	allMessages: MemoryMessage[],
	leafId: string | null,
	coverage: Coverage,
	config: MemoryConfig
): { extractions: number; promotions: number; total: number } {
	const path = activePath(allMessages, leafId);
	const extractions = plannedExtractions(path, coverage, config.batchSize, config.verbatimTail);
	const promotions = plannedPromotions(coverage.active, config, extractions);
	return { extractions, promotions, total: extractions + promotions };
}

/** Full rebuild: wipe stored memory and reprocess from root. */
export async function rebuildChat(
	deps: EngineDeps,
	chatId: string,
	allMessages: MemoryMessage[],
	leafId: string | null,
	opts: ProcessOptions = {}
): Promise<ProcessResult> {
	await deps.db.reset(chatId);
	return processChat(deps, chatId, allMessages, leafId, opts);
}

/**
 * The store's pre-flight, so a broken template fails before the run rather than during it.
 *
 * BOTH templates, not just the extraction one. Promotion is checked lazily, when the ladder
 * first fills (which on a long backlog is after every extraction in it has been paid for).
 */
export function assertTemplates(extract: string, promote: string): void {
	assertTemplate(extract, REQUIRED_EXTRACT_MACROS, 'summarizing');
	assertTemplate(promote, REQUIRED_PROMOTE_MACROS, 'compaction');
}
