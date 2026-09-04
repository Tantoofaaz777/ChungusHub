<!--
  One rule's editor: the fields that define it, and the sample it is tried against.

  Mounted in two places (the reader's own rules on the Regex page, and the rules a preset
  carries in the Prompt Builder), because a rule is the same object wherever it is written
  and a second editor is a second thing to keep in step. The host owns the row around it
  and the actions under it (the `footer` snippet); everything from the name field to the
  result pane lives here.

  Edits leave as patches, so each host keeps its own write cadence: the Regex page coalesces
  keystrokes through its store, the builder writes its preset draft on every one, exactly
  like the rest of the builder does.

  With no `onPatch` it reads instead of writes, and that mount is what a reader gets for a
  rule a preset carries: the same fields, frozen, above a tester that still runs. Reading
  somebody else's pattern proves very little; watching it chew your own last reply proves
  the thing you actually wanted to know.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import ExpandableTextarea from '$lib/components/ui/ExpandableTextarea.svelte';
	import {
		depthInverted,
		depthSentence,
		normalizeRuleFlags,
		regexRuleError,
		type RegexRule,
		type RegexRuleRole,
		type RegexRuleScope
	} from '$lib/utils/regex-rules';

	interface Props {
		rule: RegexRule;
		/** Omitted on a read-only mount, which is what makes it read-only: there is exactly
		 *  one state to get wrong instead of a flag and a handler that can disagree. */
		onPatch?: (patch: Partial<Omit<RegexRule, 'id'>>) => void;
		/** Shared across rules by the host, so a phrase you are tuning against survives
		 *  switching between them. */
		sampleText: string;
		/** The active chat's last AI reply, when there is one. The host reaches for it so
		 *  this component stays a view over a rule and nothing else. */
		lastReply?: string;
		/** The row's own actions (duplicate, export, delete, copy). */
		footer?: Snippet;
	}

	let { rule, onPatch, sampleText = $bindable(''), lastReply, footer }: Props = $props();

	let readonly = $derived(!onPatch);

	let mirrorEl = $state<HTMLDivElement | null>(null);

	const FLAG_OPTIONS: { flag: string; hint: string }[] = [
		{ flag: 'g', hint: 'Replace every match, not just the first' },
		{ flag: 'i', hint: 'Ignore case' },
		{ flag: 'm', hint: '^ and $ match at every line break' },
		{ flag: 's', hint: 'Dot also matches newlines' },
		{ flag: 'u', hint: 'Unicode mode, enables \\p{...} classes' }
	];

	const ROLE_OPTIONS: { role: RegexRuleRole; label: string; icon: 'user' | 'sparkles' }[] = [
		{ role: 'user', label: 'Your messages', icon: 'user' },
		{ role: 'assistant', label: 'AI replies', icon: 'sparkles' }
	];

	const SCOPE_OPTIONS: { scope: RegexRuleScope; label: string; icon: 'eye' | 'upload'; hint: string }[] = [
		{ scope: 'display', label: 'Chat display', icon: 'eye', hint: 'What you read in the transcript' },
		{ scope: 'prompt', label: 'Outgoing prompt', icon: 'upload', hint: 'What the model receives as history' }
	];

	/** Toggle membership while keeping the canonical order stable. */
	function toggled<T>(list: T[], item: T, order: readonly T[]): T[] {
		const has = list.includes(item);
		return order.filter((x) => (x === item ? !has : list.includes(x)));
	}

	/** An empty box is no bound, not zero: the two mean opposite things, and a rule narrowed
	 *  to the newest turn because a field was cleared would be silent. Anything that isn't a
	 *  whole turn count clears the bound rather than being swallowed, so the reach sentence
	 *  under the boxes is always describing the rule as it actually stands. */
	function patchDepth(end: 'minDepth' | 'maxDepth', raw: string): void {
		const trimmed = raw.trim();
		const value = Number(trimmed);
		const bounded = trimmed !== '' && Number.isInteger(value) && value >= 0;
		onPatch?.({ [end]: bounded ? value : undefined });
	}

	let depthReach = $derived(depthSentence(rule));
	let inverted = $derived(depthInverted(rule));

	function toggleFlag(flag: string): void {
		onPatch?.({
			flags: normalizeRuleFlags(
				rule.flags.includes(flag) ? rule.flags.replaceAll(flag, '') : rule.flags + flag
			)
		});
	}

	let error = $derived(regexRuleError(rule));

	// Tester output. Runs the rule directly, ignoring its enabled/target switches: you are
	// testing the pattern, not the routing.
	let testOutput = $derived.by(() => {
		if (error) return null;
		return sampleText.replace(new RegExp(rule.pattern, rule.flags), rule.replacement);
	});

	// DOM-sanity bound for the highlight layer, not a correctness limit: a match-everything
	// pattern over a pasted wall of text shouldn't mint thousands of <mark>s.
	const MATCH_CAP = 300;

	// Matches that render at zero width (zero-length lookarounds, or text made purely of
	// zero-width characters) get a visible sliver instead of an invisible zero-area highlight.
	const ZERO_WIDTH_ONLY = /^[\u200B-\u200D\u2060\uFEFF]+$/;

	interface MatchSegment {
		text: string;
		match: boolean;
	}

	// Where the rule hits the sample: what the highlight layer under the sample textarea
	// paints. Honors the g flag the same way replace does: without it only the first match
	// fires, so only the first match lights up.
	let matchInfo = $derived.by((): { segments: MatchSegment[]; count: number; capped: boolean } | null => {
		if (error) return null;
		const re = new RegExp(rule.pattern, rule.flags);
		const segments: MatchSegment[] = [];
		let count = 0;
		let capped = false;
		let cursor = 0;
		if (re.global) {
			for (const m of sampleText.matchAll(re)) {
				if (count >= MATCH_CAP) {
					capped = true;
					break;
				}
				const start = m.index ?? 0;
				if (start > cursor) segments.push({ text: sampleText.slice(cursor, start), match: false });
				segments.push({ text: m[0], match: true });
				cursor = start + m[0].length;
				count++;
			}
		} else {
			const m = re.exec(sampleText);
			if (m) {
				if (m.index > 0) segments.push({ text: sampleText.slice(0, m.index), match: false });
				segments.push({ text: m[0], match: true });
				cursor = m.index + m[0].length;
				count = 1;
			}
		}
		if (cursor < sampleText.length) segments.push({ text: sampleText.slice(cursor), match: false });
		return { segments, count, capped };
	});
</script>

<div class="rx-editor" class:is-readonly={readonly}>
	<div class="rx-editor-grid">
		<label class="rx-field">
			<span class="section-label">Name</span>
			<input
				class="rx-input"
				type="text"
				{readonly}
				value={rule.name}
				oninput={(e) => onPatch?.({ name: e.currentTarget.value })}
			/>
		</label>

		<label class="rx-field">
			<span class="section-label">Description</span>
			<input
				class="rx-input"
				type="text"
				{readonly}
				placeholder="Optional note shown under the name"
				value={rule.description}
				oninput={(e) => onPatch?.({ description: e.currentTarget.value })}
			/>
		</label>

		<div class="rx-field rx-span">
			<span class="section-label">Find</span>
			<div class="rx-refield" class:rx-refield-bad={!!error}>
				<span class="rx-slash" aria-hidden="true">/</span>
				<input
					class="rx-pattern"
					type="text"
					placeholder="pattern, e.g. \bvery\b"
					{readonly}
					spellcheck="false"
					value={rule.pattern}
					oninput={(e) => onPatch?.({ pattern: e.currentTarget.value })}
				/>
				<span class="rx-slash" aria-hidden="true">/</span>
				<div class="rx-flags" role="group" aria-label="Regex flags">
					{#each FLAG_OPTIONS as opt (opt.flag)}
						<button
							type="button"
							class="rx-flag"
							class:is-active-tint={rule.flags.includes(opt.flag)}
							title={opt.hint}
							disabled={readonly}
							aria-pressed={rule.flags.includes(opt.flag)}
							onclick={() => toggleFlag(opt.flag)}
						>
							{opt.flag}
						</button>
					{/each}
				</div>
			</div>
			{#if error}
				<span class="rx-error">{error}</span>
			{/if}
		</div>

		<div class="rx-field rx-span">
			<label for="regex-replacement-{rule.id}" class="section-label">Replace with</label>
			<!-- A textarea, not an <input>: replacements may contain real line breaks (the
			     blank-line default does), which a single-line input silently mangles on edit. -->
			<ExpandableTextarea
				id="regex-replacement-{rule.id}"
				value={rule.replacement}
				onValueChange={(value) => onPatch?.({ replacement: value })}
				dialogTitle="Replace with"
				expandLabel="Expand replacement text"
				placeholder="$& = whole match, $1 = first group, empty removes the match"
				{readonly}
				spellcheck={false}
				rows={1}
				maxHeight={300}
				class="w-full px-[0.6rem] py-[0.45rem] rounded-[var(--radius-md)] border border-border bg-bg-secondary text-text-primary font-mono text-[0.76rem] min-h-[2.15rem] focus:outline-none focus:border-accent"
				expandedClass="font-mono text-[0.76rem] text-text-primary placeholder:text-text-muted"
			/>
		</div>

		<div class="rx-field">
			<span class="section-label">Apply to</span>
			<div class="rx-chips" role="group" aria-label="Which messages">
				{#each ROLE_OPTIONS as opt (opt.role)}
					<button
						type="button"
						class="rx-chip"
						class:is-active-tint={rule.targets.includes(opt.role)}
						disabled={readonly}
						aria-pressed={rule.targets.includes(opt.role)}
						onclick={() => onPatch?.({ targets: toggled(rule.targets, opt.role, ['user', 'assistant']) })}
					>
						<Icon name={opt.icon} class="w-3 h-3" />
						{opt.label}
					</button>
				{/each}
			</div>
			{#if rule.targets.length === 0}
				<span class="rx-warn">Nothing selected, the rule is inert.</span>
			{/if}
		</div>

		<div class="rx-field">
			<span class="section-label">Rewrite</span>
			<div class="rx-chips" role="group" aria-label="Where the rewrite happens">
				{#each SCOPE_OPTIONS as opt (opt.scope)}
					<button
						type="button"
						class="rx-chip"
						class:is-active-tint={rule.scopes.includes(opt.scope)}
						disabled={readonly}
						aria-pressed={rule.scopes.includes(opt.scope)}
						title={opt.hint}
						onclick={() => onPatch?.({ scopes: toggled(rule.scopes, opt.scope, ['display', 'prompt']) })}
					>
						<Icon name={opt.icon} class="w-3 h-3" />
						{opt.label}
					</button>
				{/each}
			</div>
			{#if rule.scopes.length === 0}
				<span class="rx-warn">Nothing selected, the rule is inert.</span>
			{/if}
		</div>

		<!-- Depth is the one part of a rule's reach that isn't a chip, because it is a
		     measurement rather than a choice. Both boxes empty is the common case and reads
		     as "every turn"; the phrase beside them is what turns two bare numbers into
		     something you can picture, and it is the same one the rule lists show. -->
		<div class="rx-field rx-span">
			<span class="section-label">How far back</span>
			<div class="rx-depth">
				<label class="rx-depth-box">
					<span>From</span>
					<input
						class="rx-input rx-depth-input"
						type="number"
						min="0"
						step="1"
						placeholder="0"
						{readonly}
						value={rule.minDepth ?? ''}
						oninput={(e) => patchDepth('minDepth', e.currentTarget.value)}
					/>
				</label>
				<label class="rx-depth-box">
					<span>To</span>
					<input
						class="rx-input rx-depth-input"
						type="number"
						min="0"
						step="1"
						placeholder="any"
						{readonly}
						value={rule.maxDepth ?? ''}
						oninput={(e) => patchDepth('maxDepth', e.currentTarget.value)}
					/>
				</label>
				<span class="rx-depth-reach" class:rx-depth-bad={inverted}>{depthReach ?? 'every turn'}</span>
			</div>
			<span class="rx-note">Turns counted back from the newest one, which is 0.</span>
		</div>
	</div>

	<div class="rx-try">
		<div class="rx-try-head">
			<span class="section-label">Try it</span>
			{#if lastReply}
				<button type="button" class="rx-borrow" onclick={() => (sampleText = lastReply)}>
					<Icon name="sparkles" class="w-3 h-3" />
					Use the last reply
				</button>
			{/if}
			<span class="rx-try-spacer"></span>
			{#if matchInfo}
				<span class="rx-match-count" class:rx-match-zero={matchInfo.count === 0}>
					{#if matchInfo.count === 0}
						No matches
					{:else}
						{matchInfo.count}{matchInfo.capped ? '+' : ''}
						match{matchInfo.count === 1 && !matchInfo.capped ? '' : 'es'}
					{/if}
				</span>
			{/if}
		</div>
		<div class="rx-try-grid">
			<div class="rx-try-pane">
				<span class="rx-try-label">Sample</span>
				<div class="rx-sample-wrap">
					<!-- Highlight layer: same text metrics as the textarea, transparent ink, only
					     the <mark> backgrounds paint. Kept in one template line so pre-wrap sees
					     no stray whitespace. -->
					<div class="rx-mirror" aria-hidden="true" bind:this={mirrorEl}>{#if matchInfo}{#each matchInfo.segments as seg, i (i)}{#if seg.match}<mark class="rx-mark" class:rx-mark-zero={seg.text === '' || ZERO_WIDTH_ONLY.test(seg.text)}>{seg.text}</mark>{:else}{seg.text}{/if}{/each}{/if}{'\u200b'}</div>
					<textarea
						class="rx-sample"
						rows="4"
						spellcheck="false"
						bind:value={sampleText}
						onscroll={(e) => {
							if (mirrorEl) mirrorEl.scrollTop = e.currentTarget.scrollTop;
						}}
					></textarea>
				</div>
			</div>
			<div class="rx-try-pane">
				<span class="rx-try-label">Result</span>
				<div class="rx-test-out" class:rx-test-quiet={testOutput === null || testOutput === sampleText}>
					{#if testOutput === null}
						<span class="rx-test-note">Fix the pattern to see the result.</span>
					{:else if matchInfo && matchInfo.count === 0}
						<span class="rx-test-note">No match, the sample passes through unchanged.</span>
					{:else if testOutput === sampleText}
						<span class="rx-test-note">Matched, but the replacement reads identical.</span>
					{:else}
						{testOutput}
					{/if}
				</div>
			</div>
		</div>
	</div>

	{#if footer}
		<div class="rx-editor-foot">{@render footer()}</div>
	{/if}
</div>

<style>
	/* Its own container: both hosts sit in surfaces that range from a ~220px dock margin
	   to a ~1250px overlay independent of the viewport, so the field grid queries the
	   editor's own width rather than anybody's screen. */
	.rx-editor {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.rx-editor-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.65rem;
	}

	.rx-span {
		grid-column: 1 / -1;
	}

	.rx-field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 0;
	}

	.rx-input {
		width: 100%;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 0.8rem;
	}

	.rx-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	/* Pattern field framed as /pattern/flags: the slashes and flag letters live inside one
	   input-looking shell; on narrow widths the flag row wraps within it. */
	.rx-refield {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.1rem;
		padding: 0.14rem 0.45rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		transition: border-color 120ms ease;
	}

	.rx-refield:focus-within {
		border-color: var(--color-accent);
	}

	.rx-refield-bad {
		border-color: color-mix(in srgb, var(--color-error) 55%, var(--color-border));
	}

	.rx-slash {
		font-family: var(--font-mono, monospace);
		font-size: 0.9rem;
		color: var(--color-text-muted);
		opacity: 0.75;
		user-select: none;
	}

	.rx-pattern {
		flex: 1;
		min-width: 8rem;
		border: none;
		outline: none;
		background: transparent;
		padding: 0.28rem 0.3rem;
		color: var(--color-text-primary);
		font-family: var(--font-mono, monospace);
		font-size: 0.78rem;
	}

	.rx-flags {
		display: flex;
		gap: 0.15rem;
		align-items: center;
		margin-left: 0.1rem;
	}

	.rx-flag {
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		font-weight: 700;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.rx-flag:hover:not(:disabled) {
		border-color: var(--color-border);
		color: var(--color-text-primary);
	}

	.rx-error {
		font-family: var(--font-mono, monospace);
		font-size: 0.68rem;
		color: var(--color-error);
	}

	.rx-warn {
		font-family: var(--font-ui);
		font-size: 0.66rem;
		color: var(--color-warning);
	}

	.rx-note {
		font-family: var(--font-ui);
		font-size: 0.66rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	/* The two boxes and the sentence they produce share one line and wrap together, so a
	   narrow dock stacks the reach under the numbers instead of squeezing them. */
	.rx-depth {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.4rem 0.55rem;
	}

	.rx-depth-box {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
	}

	.rx-depth-input {
		width: 4.4rem;
	}

	.rx-depth-reach {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
	}

	/* Its own modifier rather than the shared .rx-warn: that one also carries a smaller
	   size, and at equal specificity this rule would win the colour back from it. */
	.rx-depth-reach.rx-depth-bad {
		color: var(--color-warning);
	}

	.rx-chips {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

	.rx-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.62rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border-subtle);
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.rx-chip:hover:not(:disabled) {
		border-color: var(--color-border);
		color: var(--color-text-primary);
	}

	/* Scoped active tint: the canonical .is-active-tint recipe is in a cascade layer, so this
	   unlayered scoped base would otherwise override it. Placed after :hover so the active
	   flag/chip stays tinted while hovered. */
	.rx-flag.is-active-tint,
	.rx-chip.is-active-tint {
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 33%, transparent);
	}

	/* Read-only mount: the fields go quiet rather than grey, since nothing here is disabled
	   for a reason the reader could fix: the rule simply is not theirs. The tester below
	   stays fully live, which is the half that answers what the rule actually does. */
	.is-readonly .rx-input,
	.is-readonly .rx-refield {
		background: transparent;
		border-style: dashed;
		color: var(--color-text-secondary);
	}

	.is-readonly .rx-input:focus,
	.is-readonly .rx-refield:focus-within {
		border-color: var(--color-border);
	}

	.is-readonly .rx-flag,
	.is-readonly .rx-chip {
		cursor: default;
	}

	.is-readonly .rx-flag:not(.is-active-tint),
	.is-readonly .rx-chip:not(.is-active-tint) {
		opacity: 0.45;
	}

	/* --- Live tester --- */

	.rx-try {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		border-top: 1px dashed var(--color-border-subtle);
		padding-top: 0.6rem;
	}

	.rx-try-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.rx-try-spacer {
		flex: 1 1 0;
		min-width: 0.25rem;
	}

	/* Borrow the story's own last reply as the sample: the synthetic seed proves a rule
	   compiles, real output proves it does what the author meant. */
	.rx-borrow {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border-subtle);
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 650;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease, border-color 120ms ease;
	}

	.rx-borrow:hover {
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	.rx-match-count {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 650;
		padding: 0.1rem 0.45rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		color: var(--color-accent);
	}

	.rx-match-zero {
		border-color: var(--color-border-subtle);
		background: transparent;
		color: var(--color-text-muted);
	}

	.rx-try-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}

	.rx-try-pane {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}

	.rx-try-label {
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 650;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
		opacity: 0.8;
	}

	/* The sample is a textarea over a mirror div with identical text metrics; the mirror's
	   ink is transparent and only the match <mark> backgrounds show through the
	   (transparent-background) textarea above it. */
	.rx-sample-wrap {
		position: relative;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		transition: border-color 120ms ease;
	}

	.rx-sample-wrap:focus-within {
		border-color: var(--color-accent);
	}

	.rx-mirror,
	.rx-sample {
		font-family: var(--font-mono, monospace);
		font-size: 0.76rem;
		line-height: 1.55;
		padding: 0.45rem 0.6rem;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		word-break: normal;
		text-align: left;
		scrollbar-gutter: stable;
	}

	.rx-mirror {
		position: absolute;
		inset: 0;
		overflow: hidden;
		color: transparent;
		pointer-events: none;
		user-select: none;
	}

	.rx-sample {
		position: relative;
		display: block;
		width: 100%;
		border: none;
		outline: none;
		background: transparent;
		color: var(--color-text-primary);
		resize: vertical;
		min-height: 2.6rem;
	}

	.rx-mark {
		/* The UA paints marks yellow-on-black; here only the background may show. */
		color: transparent;
		background: color-mix(in srgb, var(--color-accent) 30%, transparent);
		border-radius: 2px;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}

	/* Zero-width match (lookarounds, \b, invisible-only characters): no visible text to
	   tint, so paint a thin layout-neutral sliver where it fired. */
	.rx-mark-zero {
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 70%, transparent);
	}

	.rx-test-out {
		flex: 1;
		min-height: 2.6rem;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-md);
		border: 1px dashed color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
		background: color-mix(in srgb, var(--color-accent) 6%, transparent);
		font-family: var(--font-mono, monospace);
		font-size: 0.76rem;
		line-height: 1.55;
		color: var(--color-text-primary);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.rx-test-quiet {
		border-color: var(--color-border-subtle);
		background: transparent;
	}

	.rx-test-note {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	/* --- Footer --- */

	.rx-editor-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	/* --- Width tiers (this editor's own width) --- */

	@container (max-width: 38rem) {
		.rx-try-grid {
			grid-template-columns: 1fr;
		}
	}

	@container (max-width: 28rem) {
		.rx-editor-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
