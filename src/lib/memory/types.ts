/**
 * Chat-memory domain types.
 *
 * This file (and the rest of the pure engine) is deliberately decoupled from the app:
 * it defines its own minimal message/LLM shapes instead of importing from `$lib`, so
 * the engine can be unit-tested under `bun test` with no Svelte/Vite resolution.
 */

/**
 * A narrative summary, the single thing memory stores. Layer 0 = one delta per
 * extraction batch; higher layers are LLM-merged compactions of lower ones.
 * `sourceMessageIds` is the union of raw message ids this episode ultimately covers;
 * `anchorMessageId` is the newest of them.
 */
export interface Episode {
	id: string;
	chatId: string;
	layer: number;
	content: string;
	sourceMessageIds: string[];
	anchorMessageId: string | null;
	createdAt: number;
}

/**
 * Per-chat memory state (toggles + overrides).
 *
 * Deliberately holds NO cursor. The archive boundary is derived from the stored episodes
 * against whatever path is active (`resolveCoverage`), which is what makes memory
 * branch-aware: the same episodes yield one boundary on the long timeline and a shallower
 * one on a branch that forks below it, with nothing written either way.
 */
export interface MemoryState {
	chatId: string;
	enabled: boolean;
	/** true = extraction fires on its own after each reply; false = only via the panel's
	 *  Process. Reaping dead episodes is never gated by this. */
	autoExtract: boolean;
	config: Partial<MemoryConfig> | null;
	updatedAt: number;
}

/** Tunables. Defaults live in config.ts; a chat may override a subset. */
export interface MemoryConfig {
	/** Messages folded into memory per extraction batch. */
	batchSize: number;
	/** Most-recent messages always kept live (never archived). */
	verbatimTail: number;
	/** Episodes per layer before the oldest are promoted up. */
	maxPerLayer: number;
	/** How many oldest episodes merge into one on promotion. */
	promoteCount: number;
	/** Number of episode layers (top one compacts in place). */
	maxLayers: number;
}

/** A chat message as the engine consumes it (a thin slice of the app's Message). */
export interface MemoryMessage {
	id: string;
	parentId: string | null;
	role: 'user' | 'assistant' | 'system';
	content: string;
	/** Hidden turns remain tree links, but must never be summarized or recalled. */
	excludedFromPrompt?: boolean;
	/** Display name of the speaker, resolved by the caller (persona/character name). */
	speaker: string;
	/** Last in-place content rewrite (the row's edited_at). An archived message edited
	 *  after its episode was created marks that episode stale, the hook that lets
	 *  coverage-based sync see same-id rewrites from any source (editor, assistant,
	 *  another device). Absent/null = never edited. */
	editedAt?: number | null;
}

/** Minimal LLM message shape (matches the app's LLMMessage by structure). */
export interface LlmMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/** The model port. Returns the raw completion text. */
export type LlmFn = (messages: LlmMessage[], signal?: AbortSignal) => Promise<string>;

// ===== Write results (engine decides, MemoryDb persists atomically) =====

/**
 * Everything one extraction batch changes, applied atomically by the db adapter.
 *
 * There is no cursor here and no compare-and-swap on one, because the cursor is derived.
 * What the db enforces instead is the invariant the cursor CAS was standing in for:
 * **no two stored episodes may cover the same message**. That guard is strictly stronger
 * (it catches a double-fold from any source, not only one that moved a cursor) and it is
 * what makes a derived boundary safe: the tiling walk in `resolveCoverage` may then
 * assume at most one episode begins at any point on the path.
 */
export interface BatchResult {
	/** The L0 episode for this batch (always present, which keeps coverage gap-free). */
	episode: { content: string; sourceMessageIds: string[]; anchorMessageId: string };
	/** Dormant episodes whose coverage this batch overlaps, deleted in the same
	 *  transaction. A span re-folded on another branch supersedes the summary that covered
	 *  it before; keeping both would double-cover those turns in recall. */
	supersedeEpisodeIds: string[];
}

/** A promotion step: insert the merged episode, delete the ones it replaces. */
export interface PromotionResult {
	insert: Omit<Episode, 'id' | 'chatId' | 'createdAt'>;
	deleteEpisodeIds: string[];
}

/**
 * Persistence port. The pure engine reads through this and hands back result objects
 * for the adapter to persist (atomically where noted). The real adapter maps these to
 * the server RPC db; tests use an in-memory fake.
 */
export interface MemoryDb {
	getState(chatId: string): Promise<MemoryState | null>;
	setState(chatId: string, patch: Partial<Omit<MemoryState, 'chatId'>>): Promise<void>;
	listEpisodes(chatId: string): Promise<Episode[]>;
	applyBatch(chatId: string, result: BatchResult): Promise<void>;
	applyPromotion(chatId: string, result: PromotionResult): Promise<void>;
	/** Delete episodes that can never apply again (a covered turn was deleted or rewritten).
	 *  Plain deletes: idempotent, order-free, and with no boundary to guard. The boundary
	 *  recomputes itself from whatever survives. */
	reapEpisodes(chatId: string, episodeIds: string[]): Promise<void>;
	/** Panel edit of one episode's prose. Coverage is unchanged, so no guard is involved. */
	updateEpisodeContent(chatId: string, episodeId: string, content: string): Promise<void>;
	reset(chatId: string): Promise<void>;
}
