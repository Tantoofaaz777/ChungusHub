/**
 * Regex rules: user-defined find & replace over chat text.
 *
 * Pure engine (no stores, no Svelte): types, normalization, compilation with a
 * small cache, application, and import/export including SillyTavern regex-script
 * conversion. The store ({@link ../stores/regex-rules.svelte}) persists rules on
 * the settings spine; this module is what the display path and prompt assembly
 * actually run.
 *
 * Rules are deliberately non-destructive: they rewrite what is DISPLAYED in the
 * chat transcript and/or what is SENT in the outgoing prompt, never the stored
 * message rows. Toggling a rule off instantly restores the original text.
 */

import type { Message } from '#lib/types/chat.ts';

export type RegexRuleRole = 'user' | 'assistant';
export type RegexRuleScope = 'display' | 'prompt';

export interface RegexRule {
	id: string;
	name: string;
	/** One-line human note shown under the name in the settings list. */
	description: string;
	enabled: boolean;
	/** JS regex source, without surrounding slashes. */
	pattern: string;
	/** Subset of {@link ALLOWED_RULE_FLAGS}, canonical order, deduped. */
	flags: string;
	/** JS replacement string: $&, $1…$n and $<name> work as in String.replace. */
	replacement: string;
	/** Whose messages the rule touches. Empty = applies to nothing. */
	targets: RegexRuleRole[];
	/** Where the rewrite happens. Empty = applies to nothing. */
	scopes: RegexRuleScope[];
	/**
	 * How far back the rule reaches, counted in turns from the newest one: depth 0 is the
	 * newest turn, 1 the one before it. `minDepth` is the closest turn it may touch and
	 * `maxDepth` the furthest; `undefined` on either end is no bound, and both undefined
	 * (the default) is every turn.
	 *
	 * This is what lets one rule treat the live turn differently from the ones behind it:
	 * a state block worth reading on the newest reply is dead weight on the ten before it,
	 * and stripping it from those on the way out is the difference between paying for it
	 * once and paying for it every turn.
	 */
	minDepth?: number;
	maxDepth?: number;
}

/** Flag order doubles as the canonical serialization order. */
export const ALLOWED_RULE_FLAGS = 'gimsu';

const ALL_ROLES: RegexRuleRole[] = ['user', 'assistant'];
const ALL_SCOPES: RegexRuleScope[] = ['display', 'prompt'];

/** The starter pack: worked examples of common LLM-output cleanups, every one
 *  shipped disabled so nothing rewrites anyone's text until they opt in. They
 *  seed in cleanup-first order (invisible characters before the text-shaping
 *  rules, so those see clean input when several are enabled together). */
export const DEFAULT_REGEX_RULES: RegexRule[] = [
	// Zero-width characters and the BOM: never typed on purpose; they break
	// copy/paste, search and token counts invisibly. Both roles: paste carries
	// them in just as often as models emit them. (RTL direction marks are left
	// alone: they can be load-bearing in mixed-direction text.)
	{
		id: 'default-invisible-chars',
		name: 'Strip invisible characters',
		description:
			'Deletes zero-width characters and the BOM: invisible marks that silently break search, copy/paste, and token counts.',
		enabled: false,
		pattern: '[\\u200B-\\u200D\\u2060\\uFEFF]',
		flags: 'g',
		replacement: '',
		targets: ['user', 'assistant'],
		scopes: ['display', 'prompt']
	},
	// No-break spaces (plus the narrow form) render like spaces but wrap and
	// tokenize differently.
	{
		id: 'default-nbsp',
		name: 'Non-breaking spaces to spaces',
		description:
			'Turns no-break spaces into plain ones. They look identical but wrap and tokenize differently.',
		enabled: false,
		pattern: '[\\u00A0\\u202F]',
		flags: 'g',
		replacement: ' ',
		targets: ['user', 'assistant'],
		scopes: ['display', 'prompt']
	},
	// Em dashes (and runs of them) plus their surrounding spaces become ", ".
	// The letter/number lookarounds only fire on a dash BETWEEN words, so a
	// line-leading dialogue dash, and a trailing one on interrupted speech,
	// both stay intact.
	{
		id: 'default-em-dash',
		name: 'Em dash to comma',
		description:
			'Softens em dashes between words into ", ": dialogue dashes and interrupted speech ("Don\'t you dare—") stay intact.', // em-dash: data
		enabled: false,
		pattern: '(?<=[\\p{L}\\p{N}])[^\\S\\r\\n]*—+[^\\S\\r\\n]*(?=[\\p{L}\\p{N}])', // em-dash: data
		flags: 'gu',
		replacement: ', ',
		targets: ['assistant'],
		scopes: ['display', 'prompt']
	},
	// Any run containing an ellipsis character, and runs of four or more dots,
	// settle to a plain "...". Exactly three dots pass untouched.
	{
		id: 'default-ellipsis',
		name: 'Ellipsis runs to three dots',
		description:
			'Settles … characters and runs of four-plus dots into a plain "...": exactly three dots pass through untouched.',
		enabled: false,
		pattern: '[.…]*…[.…]*|\\.{4,}',
		flags: 'g',
		replacement: '...',
		targets: ['assistant'],
		scopes: ['display', 'prompt']
	},
	// Three or more consecutive line breaks (whitespace-only ghost lines
	// included) collapse to one blank line. Mostly a prompt-token saving:
	// markdown already renders the gap the same either way.
	{
		id: 'default-blank-lines',
		name: 'Collapse extra blank lines',
		description:
			'Collapses three or more consecutive line breaks into one blank line: reads the same, costs fewer prompt tokens.',
		enabled: false,
		pattern: '(?:\\r?\\n[^\\S\\r\\n]*){3,}',
		flags: 'g',
		replacement: '\n\n',
		targets: ['assistant'],
		scopes: ['display', 'prompt']
	},
	// Typographic double quotes to straight ones, so dialogue stops flip-
	// flopping between styles mid-story. Guillemets are deliberately spared:
	// they're a legitimate house style, not model drift.
	{
		id: 'default-curly-double-quotes',
		name: 'Curly double quotes to straight',
		description:
			'Straightens typographic double quotes so dialogue stops flip-flopping between quote styles mid-story.',
		enabled: false,
		pattern: '[\\u201C\\u201D\\u201E\\u201F]',
		flags: 'g',
		replacement: '"',
		targets: ['assistant'],
		scopes: ['display', 'prompt']
	},
	// Typographic single quotes and apostrophes to straight ones.
	{
		id: 'default-curly-single-quotes',
		name: 'Curly single quotes to straight',
		description: 'Straightens typographic single quotes and curly apostrophes.',
		enabled: false,
		pattern: '[\\u2018\\u2019\\u201A\\u201B]',
		flags: 'g',
		replacement: "'",
		targets: ['assistant'],
		scopes: ['display', 'prompt']
	}
];

/** The live tester's seeded sample. One little scene that every shipped rule
 *  matches: em dashes between words (plus a spared trailing dialogue dash), an
 *  ellipsis char and a four-dot run (plus a spared exact "..."), curly double
 *  and single quotes, a three-break blank gap, a no-break space and a
 *  zero-width space (the invisibles are escaped; keep them that way). */
export const REGEX_TESTER_SEED =
	'The night was cold—almost freezing—and she whispered, “Don’t you dare—”\n' + // em-dash: data
	'He hesitated… reached for the door.... and stopped...\n\n\n' +
	'Some words are glued\u00A0tight; one hides a zero\u200Bwidth space.';

export function normalizeRuleFlags(raw: string): string {
	return [...ALLOWED_RULE_FLAGS].filter((f) => raw.includes(f)).join('');
}

function normalizeRoles(raw: unknown): RegexRuleRole[] {
	if (!Array.isArray(raw)) return [...ALL_ROLES];
	return ALL_ROLES.filter((r) => raw.includes(r));
}

function normalizeScopes(raw: unknown): RegexRuleScope[] {
	if (!Array.isArray(raw)) return [...ALL_SCOPES];
	return ALL_SCOPES.filter((s) => raw.includes(s));
}

/** A depth bound, or undefined for no bound. Anything that isn't a whole turn count
 *  (a negative, a fraction, a string, ST's `null`) reads as no bound rather than as 0,
 *  which would silently narrow an imported rule to the newest turn alone. */
function normalizeDepth(raw: unknown): number | undefined {
	if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return undefined;
	return raw;
}

/** Coerce one raw entry into a valid rule; null when it isn't salvageable.
 *  An empty or uncompilable pattern is kept (the rule is inert and the UI
 *  flags it). Dropping it would silently delete a half-written rule. */
function normalizeRule(raw: unknown): RegexRule | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.pattern !== 'string') return null;
	return {
		id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
		name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Untitled rule',
		description: typeof r.description === 'string' ? r.description : '',
		enabled: r.enabled === true,
		pattern: r.pattern,
		flags: normalizeRuleFlags(typeof r.flags === 'string' ? r.flags : 'g'),
		replacement: typeof r.replacement === 'string' ? r.replacement : '',
		targets: normalizeRoles(r.targets),
		scopes: normalizeScopes(r.scopes),
		minDepth: normalizeDepth(r.minDepth),
		maxDepth: normalizeDepth(r.maxDepth)
	};
}

/** Fresh deep copies of the shipped starter pack. */
export function defaultRegexRules(): RegexRule[] {
	return DEFAULT_REGEX_RULES.map((r) => ({ ...r, targets: [...r.targets], scopes: [...r.scopes] }));
}

/**
 * Coerce a stored rules array. A missing blob seeds the default set; a present
 * (even empty) array is respected as-is, so deleting the shipped default sticks.
 */
export function normalizeRegexRules(raw: unknown): RegexRule[] {
	if (!Array.isArray(raw)) return defaultRegexRules();
	return raw.map(normalizeRule).filter((r): r is RegexRule => r !== null);
}

/** A fresh rule with UI-facing defaults (AI output, both scopes, replace-all). */
export function createRegexRule(partial: Partial<RegexRule> = {}): RegexRule {
	return {
		id: crypto.randomUUID(),
		name: 'New rule',
		description: '',
		enabled: true,
		pattern: '',
		flags: 'g',
		replacement: '',
		targets: ['assistant'],
		scopes: ['display', 'prompt'],
		...partial
	};
}

// Compiled-pattern cache. null marks an invalid pattern so it isn't re-tried on
// every message. Bounded crudely: the live tester can churn keys per keystroke.
const compiledCache = new Map<string, RegExp | null>();
const COMPILED_CACHE_MAX = 200;

function compile(pattern: string, flags: string): RegExp | null {
	// NUL separates the halves. Flags are only ever letters, so the first NUL is always the
	// boundary and no two flag/pattern pairs can fold into the same key.
	const key = flags + '\0' + pattern;
	const hit = compiledCache.get(key);
	if (hit !== undefined) return hit;
	if (compiledCache.size >= COMPILED_CACHE_MAX) compiledCache.clear();
	let re: RegExp | null;
	try {
		re = new RegExp(pattern, flags);
	} catch {
		re = null;
	}
	compiledCache.set(key, re);
	return re;
}

/** The fields that decide which text a rule can reach: the reach half of a rule, as
 *  opposed to what it finds and writes. */
type RuleReach = Pick<RegexRule, 'targets' | 'scopes' | 'minDepth' | 'maxDepth'>;

/** A depth range that can never contain a turn: the rule starts further back than it ends.
 *  Exported because the editor tints its reach line on it, and a second copy of the
 *  comparison there is how the two would start disagreeing about what "inert" means. */
export function depthInverted(rule: RuleReach): boolean {
	return rule.minDepth !== undefined && rule.maxDepth !== undefined && rule.minDepth > rule.maxDepth;
}

/** How far back a rule reaches, in words; null when it reaches every turn. Phrased in whole
 *  turns rather than raw depth numbers, because "the newest 3 turns" is a thing a reader can
 *  picture and "maxDepth 2" is not. The one description, shared by the rule lists and the
 *  editor's own reach line. */
export function depthSentence(rule: RuleReach): string | null {
	const { minDepth: min, maxDepth: max } = rule;
	/** "the newest turn" for one, "the newest 3 turns" for more. */
	const newest = (n: number) => (n === 1 ? 'the newest turn' : `the newest ${n} turns`);
	if (min === undefined && max === undefined) return null;
	if (depthInverted(rule)) return 'reaches no turn at all';
	if (min !== undefined && max !== undefined) return `only turns ${min} to ${max} back`;
	if (min !== undefined) return min === 0 ? null : `skips ${newest(min)}`;
	return `only ${newest(max! + 1)}`;
}

/** Whether a rule can reach anything at all. An empty target or scope list makes it a
 *  no-op the UI marks as inert rather than silently ignoring, and so does a depth range
 *  with nothing inside it. */
export function isRuleInert(rule: RuleReach): boolean {
	return rule.targets.length === 0 || rule.scopes.length === 0 || depthInverted(rule);
}

/** The one sentence describing where a rule reaches, shared by every surface that lists
 *  rules. Forking it is how two lists start describing the same rule differently. */
export function routingSentence(rule: RuleReach): string {
	if (isRuleInert(rule)) {
		return depthInverted(rule)
			? 'Applies to nothing: it starts further back than it reaches.'
			: 'Applies to nothing: pick who it touches and where it rewrites.';
	}
	const who = rule.targets.map((t) => (t === 'user' ? 'your messages' : 'AI replies')).join(' & ');
	const where = rule.scopes.map((s) => (s === 'display' ? 'chat display' : 'outgoing prompt')).join(' & ');
	const depth = depthSentence(rule);
	return `Applies to ${who} · rewrites ${where}${depth ? ` · ${depth}` : ''}`;
}

/** Human-readable compile error for a rule's pattern+flags; null when valid. */
export function regexRuleError(rule: Pick<RegexRule, 'pattern' | 'flags'>): string | null {
	if (!rule.pattern) return 'Pattern is empty.';
	try {
		new RegExp(rule.pattern, rule.flags);
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

function ruleApplies(rule: RegexRule, role: string, scope: RegexRuleScope, depth: number): boolean {
	return (
		rule.enabled &&
		// An empty pattern compiles to a match-everywhere regex that would stamp the
		// replacement between every character: a half-typed rule must stay inert.
		rule.pattern.length > 0 &&
		rule.scopes.includes(scope) &&
		rule.targets.includes(role as RegexRuleRole) &&
		(rule.minDepth === undefined || depth >= rule.minDepth) &&
		(rule.maxDepth === undefined || depth <= rule.maxDepth)
	);
}

/**
 * Run every applicable rule over a piece of text, in list order. Invalid
 * patterns are skipped here (the settings UI is where they're surfaced).
 *
 * `depth` is how far back the text sits, in turns from the newest one (0 = newest).
 * It is required rather than optional: a caller that guessed would have to guess 0,
 * and every depth-bounded rule would then quietly run on text it was told to leave
 * alone. The rule editor's tester is not a caller: it runs the pattern directly,
 * because you are testing what it finds, not where it is allowed to look.
 */
export function applyRegexRules(
	text: string,
	rules: RegexRule[],
	role: string,
	scope: RegexRuleScope,
	depth: number
): string {
	if (!text) return text;
	let out = text;
	for (const rule of rules) {
		if (!ruleApplies(rule, role, scope, depth)) continue;
		const re = compile(rule.pattern, rule.flags);
		if (!re) continue;
		out = out.replace(re, rule.replacement);
	}
	return out;
}

/**
 * Prompt-side application: map chat messages through the prompt-scope rules.
 * Returns the input array untouched (same reference) when no rule can apply,
 * and reuses message objects whose content survives unchanged, cheap enough
 * for the reactive token meters to call on every recompute.
 *
 * Depth is read off the array's own tail, so the last entry is turn 0. The caller
 * passes the turns it is about to send, which is what makes a depth-bounded rule
 * price and send the same thing.
 */
export function applyPromptRegex(messages: Message[], rules: RegexRule[] | undefined): Message[] {
	if (!rules?.length || messages.length === 0) return messages;
	if (!rules.some((r) => r.enabled && r.scopes.includes('prompt') && r.targets.length > 0)) {
		return messages;
	}
	let changed = false;
	const last = messages.length - 1;
	const mapped = messages.map((m, index) => {
		const content = applyRegexRules(m.content, rules, m.role, 'prompt', last - index);
		if (content === m.content) return m;
		changed = true;
		return { ...m, content };
	});
	return changed ? mapped : messages;
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

const EXPORT_TYPE = 'chungushub-regex-rules';

export function serializeRegexRules(rules: RegexRule[]): string {
	return JSON.stringify({ type: EXPORT_TYPE, version: 1, rules }, null, 2);
}

/** SillyTavern regex-script shape (the fields we translate). */
interface SillyTavernRegexScript {
	scriptName?: unknown;
	findRegex?: unknown;
	replaceString?: unknown;
	disabled?: unknown;
	placement?: unknown;
	markdownOnly?: unknown;
	promptOnly?: unknown;
	minDepth?: unknown;
	maxDepth?: unknown;
}

function isSillyTavernScript(raw: Record<string, unknown>): boolean {
	return typeof raw.findRegex === 'string';
}

/**
 * Convert one SillyTavern regex script. Faithful where the models overlap:
 * `/body/flags` find strings keep their flags (a bare string compiles flagless,
 * exactly like ST), `{{match}}` becomes `$&`, placement 1/2 map to user/AI,
 * and the depth bounds carry across unchanged: both formats count turns back
 * from the newest, so the numbers mean the same thing on both sides.
 * ST's "neither markdownOnly nor promptOnly" means a permanent edit of the
 * stored message. We never mutate stored rows, so it maps to both scopes.
 */
function fromSillyTavernScript(raw: SillyTavernRegexScript): RegexRule | null {
	if (typeof raw.findRegex !== 'string' || raw.findRegex.length === 0) return null;

	let pattern = raw.findRegex;
	let flags = '';
	const wrapped = /^\/(.+)\/([a-z]*)$/s.exec(raw.findRegex);
	if (wrapped) {
		pattern = wrapped[1];
		flags = normalizeRuleFlags(wrapped[2]);
	}

	const placement = Array.isArray(raw.placement) ? raw.placement : [2];
	const targets: RegexRuleRole[] = [];
	if (placement.includes(1)) targets.push('user');
	if (placement.includes(2)) targets.push('assistant');

	const markdownOnly = raw.markdownOnly === true;
	const promptOnly = raw.promptOnly === true;
	const scopes: RegexRuleScope[] =
		markdownOnly && !promptOnly ? ['display'] : promptOnly && !markdownOnly ? ['prompt'] : ['display', 'prompt'];

	return {
		// Kept when the script declares one so a preset's carried rules have stable
		// identity across loads; `importOne` freshens it for the Regex page's own imports.
		id: typeof (raw as { id?: unknown }).id === 'string' && (raw as { id: string }).id
			? (raw as { id: string }).id
			: crypto.randomUUID(),
		name:
			typeof raw.scriptName === 'string' && raw.scriptName.trim()
				? raw.scriptName.trim()
				: 'Imported script',
		description: '',
		enabled: raw.disabled !== true,
		pattern,
		flags,
		replacement:
			typeof raw.replaceString === 'string' ? raw.replaceString.replace(/\{\{match\}\}/gi, '$$&') : '',
		targets,
		scopes,
		minDepth: normalizeDepth(raw.minDepth),
		maxDepth: normalizeDepth(raw.maxDepth)
	};
}

function importOne(raw: unknown): RegexRule | null {
	if (!raw || typeof raw !== 'object') return null;
	const obj = raw as Record<string, unknown>;
	if (isSillyTavernScript(obj)) return fromSillyTavernScript(obj as SillyTavernRegexScript);
	const rule = normalizeRule(obj);
	// Imports are new rows: never adopt the file's ids into this install.
	return rule ? { ...rule, id: crypto.randomUUID() } : null;
}

/**
 * Parse an import file into fresh rules. Accepts our export envelope, a bare
 * rule array, a single rule, a SillyTavern regex script, or an array of them.
 * Throws with a readable message when nothing usable is found: the caller
 * surfaces it, silent partial success is only allowed within a recognized list.
 */
export function parseRegexRulesImport(json: string): RegexRule[] {
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		throw new Error('Not valid JSON.');
	}

	let items: unknown[];
	if (Array.isArray(data)) {
		items = data;
	} else if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).rules)) {
		items = (data as { rules: unknown[] }).rules;
	} else {
		items = [data];
	}

	const rules = items.map(importOne).filter((r): r is RegexRule => r !== null);
	if (rules.length === 0) {
		throw new Error('No regex rules found. Expected a rules export or a SillyTavern regex script.');
	}
	return rules;
}

// ---------------------------------------------------------------------------
// Rules a preset carries
// ---------------------------------------------------------------------------

/**
 * Normalize the rules found inside a preset. Accepts our own shape or a SillyTavern script,
 * exactly like the settings importer, but **keeps a declared id**, because the reader's
 * per-rule switch is stored against it and a fresh id would silently return that rule to
 * whatever the author shipped. A rule that declares none is minted a fresh unique id here
 * and then travels inside the preset document, so it is stable from that moment on.
 *
 * This runs at parse time only (an import, or a preset card being read); loading a stored
 * preset goes through `clonePresetBody`, which carries ids across untouched.
 */
export function normalizeCarriedRules(raw: unknown): RegexRule[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const rules = raw
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const obj = entry as Record<string, unknown>;
			// Both readers already mint a UUID for an entry that declares no id of its own.
			return isSillyTavernScript(obj)
				? fromSillyTavernScript(obj as SillyTavernRegexScript)
				: normalizeRule(obj);
		})
		.filter((r): r is RegexRule => r !== null);
	return rules.length > 0 ? rules : undefined;
}

/**
 * The rules that actually run: the reader's own first, then the ones the active preset
 * carries, each at the switch position the reader left it on. Preset rules run last on
 * purpose: an author's presentation layer is meant to sit on top of the reader's own
 * cleanups, not under them.
 *
 * `overrides` is **sparse**: a rule the reader never touched is absent from it and follows
 * the author's shipped `enabled`, so an author who flips a default in the next version of
 * their preset reaches everyone who never had an opinion about that rule. An override that
 * agrees with the author is passed through as the same object, and the whole call returns
 * the input array untouched when there is nothing to add, so the reactive meters that run
 * this on every recompute keep their referential stability.
 */
export function rulesWithCarried(
	userRules: RegexRule[],
	carried: RegexRule[] | undefined,
	overrides: Readonly<Record<string, boolean>> = {}
): RegexRule[] {
	if (!carried?.length) return userRules;
	return [
		...userRules,
		...carried.map((rule) => {
			const enabled = readOverride(overrides, rule.id);
			return enabled === undefined || enabled === rule.enabled ? rule : { ...rule, enabled };
		})
	];
}

/** hasOwnProperty rather than a plain read: a rule id arrives inside a downloaded preset,
 *  and "constructor" is a legal string. */
function readOverride(overrides: Readonly<Record<string, boolean>>, id: string): boolean | undefined {
	if (!Object.prototype.hasOwnProperty.call(overrides, id)) return undefined;
	const value = overrides[id];
	return typeof value === 'boolean' ? value : undefined;
}

/** Whether a carried rule runs: the reader's switch where they set one, the author's
 *  shipped state otherwise. The one answer both the store and the engine give. */
export function carriedRuleEnabled(
	rule: Pick<RegexRule, 'id' | 'enabled'>,
	overrides: Readonly<Record<string, boolean>>
): boolean {
	return readOverride(overrides, rule.id) ?? rule.enabled;
}

/** Coerce a stored override map, dropping anything that isn't a boolean. */
export function normalizeCarriedOverrides(raw: unknown): Record<string, boolean> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const out: Record<string, boolean> = {};
	for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === 'boolean') out[id] = value;
	}
	return out;
}
