<script lang="ts">
	/**
	 * The keyword chips, each carrying how it is matched.
	 *
	 * A key is the smallest thing a lorebook gets wrong, and one bad key drags the whole entry
	 * with it: an acronym that has to be case-sensitive would otherwise force every other key on
	 * the entry to be, and an inflected stem that has to tolerate suffixes would force the rest to
	 * tolerate them too. So the mode rides on the chip, not on the entry, and the entry's own
	 * two switches are what a chip falls back to.
	 *
	 * A chip written `/pattern/flags` IS a regex, which is also how SillyTavern writes one, so
	 * that mode needs no stored rule and survives the trip there and back untouched.
	 */
	import { scale } from 'svelte/transition';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { anchorTo } from '$lib/actions/anchorTo';
	import {
		addLorebookKeys,
		compileRegexKey,
		LOREBOOK_KEY_MODES,
		parseKeys,
		parseRegexKey,
		resolveKeyMatch,
		type LorebookKeyRule,
		type LorebookKeyRules
	} from '$lib/lorebook/types';
	import { toastStore } from '$lib/stores/toast.svelte';

	interface Props {
		/** Current keys (source of truth lives in the store). */
		keys: string[];
		/** Emit the next list whenever a chip is added or removed. */
		onChange: (next: string[]) => void;
		/** Per-key overrides, shared with the entry's other key list. */
		rules?: LorebookKeyRules;
		/** Emit the next rule map when a chip's mode or case changes. */
		onRulesChange: (next: LorebookKeyRules) => void;
		/** What a chip that sets nothing falls back to: the entry's resolved match settings. */
		defaults: { caseSensitive: boolean; matchWholeWords: boolean };
		placeholder?: string;
		ariaLabel?: string;
	}

	let {
		keys,
		onChange,
		rules,
		onRulesChange,
		defaults,
		placeholder = 'Add keyword…',
		ariaLabel = 'Keywords'
	}: Props = $props();

	let draft = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	/** The chip whose picker is open, the chip button it hangs off, and the panel itself. */
	let openKey = $state<string | null>(null);
	let anchorEl = $state<HTMLElement | undefined>(undefined);
	let pickerEl = $state<HTMLElement | null>(null);

	const reduce =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	/** How a chip matches now, and what it would match like if it set nothing of its own. */
	function matchOf(key: string) {
		return {
			effective: resolveKeyMatch(key, rules, defaults),
			inherited: resolveKeyMatch(key, undefined, defaults)
		};
	}

	/** The short words on a chip: only what differs from the entry it sits in. */
	function marks(key: string): string[] {
		const { effective, inherited } = matchOf(key);
		// A regex wears its slashes; naming its mode again would only take room.
		if (effective.mode === 'regex') return [];
		const out: string[] = [];
		if (effective.mode !== inherited.mode) {
			out.push(LOREBOOK_KEY_MODES.find((m) => m.id === effective.mode)?.label.toLowerCase() ?? '');
		}
		if (effective.caseSensitive !== inherited.caseSensitive) out.push('Aa');
		return out;
	}

	/** A pattern that will not compile fires nothing, so it is marked where it is written. */
	function isBroken(key: string): boolean {
		const regex = parseRegexKey(key);
		return !!regex && !compileRegexKey(regex);
	}

	function setRule(key: string, patch: LorebookKeyRule) {
		const next: LorebookKeyRules = { ...rules };
		const merged = { ...next[key], ...patch };
		// An empty rule is no rule: storing one would leave the chip claiming an override it
		// no longer has, and the star on the entry's own switches reads the same way.
		for (const field of ['mode', 'caseSensitive'] as const) {
			if (merged[field] === undefined) delete merged[field];
		}
		if (Object.keys(merged).length === 0) delete next[key];
		else next[key] = merged;
		onRulesChange(next);
	}

	/** Add every comma-separated token in `raw` that this list does not already hold, and say
	 *  what it turned away. `addLorebookKeys` owns the decision; this owns the wording. */
	function commit(raw: string) {
		const parts = parseKeys(raw);
		draft = '';
		if (parts.length === 0) return;
		const { next, refused } = addLorebookKeys(keys, parts);
		// A refusal, not a failure, but it is the one thing here that answers a keystroke with
		// nothing happening, so it carries more than the quiet weight an info note has.
		if (refused.length === 1) {
			toastStore.warning(`"${refused[0]}" is already a keyword here`);
		} else if (refused.length > 1) {
			toastStore.warning(`${refused.length} keywords were already here: ${refused.join(', ')}`);
		}
		if (next.length !== keys.length) onChange(next);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			commit(draft);
		} else if (e.key === 'Backspace' && draft === '' && keys.length > 0) {
			e.preventDefault();
			onChange(keys.slice(0, -1));
		}
	}

	function onPaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text') ?? '';
		if (text.includes(',')) {
			e.preventDefault();
			commit(draft + text);
		}
	}

	function remove(i: number) {
		if (keys[i] === openKey) openKey = null;
		onChange(keys.filter((_, idx) => idx !== i));
		inputEl?.focus();
	}

	function openPicker(key: string, el: HTMLElement) {
		openKey = openKey === key ? null : key;
		anchorEl = el;
	}

	// The app's popover idiom: document listeners while open, so Escape is CONSUMED here and
	// never also reaches the page behind (which would close the row the chip lives in). The
	// panel itself sits on <body> (anchorTo), so containment is asked of it and the chip both.
	$effect(() => {
		if (openKey === null) return;
		// The panel lives at the end of <body>, unreachable by tabbing from the chip, so focus
		// moves into it on open; Escape hands it back to the chip that opened it.
		pickerEl?.focus();
		const onDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (!anchorEl?.contains(target) && !pickerEl?.contains(target)) openKey = null;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.stopPropagation();
			anchorEl?.focus();
			openKey = null;
		};
		document.addEventListener('mousedown', onDown, true);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', onDown, true);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<label class="input-base flex flex-wrap items-center gap-1.5 px-2.5 py-2 cursor-text" aria-label={ariaLabel}>
	{#each keys as key, i (key + '|' + i)}
		<span
			in:scale={{ duration: reduce ? 0 : 120, start: 0.85 }}
			class="chip inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5"
			class:is-broken={isBroken(key)}
		>
			<button
				type="button"
				class="chip-key font-mono text-xs"
				aria-expanded={openKey === key}
				aria-label={`Matching for ${key}`}
				title={isBroken(key) ? 'This pattern does not compile, so it never matches.' : 'How this key matches'}
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					openPicker(key, e.currentTarget as HTMLElement);
				}}
			>
				<span class="chip-key-text">{key}</span>
				{#each marks(key) as m (m)}
					<span class="chip-mark">{m}</span>
				{/each}
			</button>
			<button
				type="button"
				class="chip-x flex items-center justify-center w-4 h-4 rounded-full transition-colors"
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					remove(i);
				}}
				aria-label={`Remove ${key}`}
			>
				<Icon name="x" class="w-3 h-3" />
			</button>
		</span>
	{/each}
	<input
		bind:this={inputEl}
		bind:value={draft}
		onkeydown={onKeydown}
		onpaste={onPaste}
		onblur={() => commit(draft)}
		placeholder={keys.length ? '' : placeholder}
		class="flex-1 min-w-[6rem] bg-transparent border-0 outline-none text-sm font-ui text-text-primary placeholder:text-text-muted"
	/>
</label>

{#snippet picker(key: string)}
	{@const { effective, inherited } = matchOf(key)}
	{@const regex = parseRegexKey(key)}
	<div class="kp" tabindex="-1" bind:this={pickerEl} use:anchorTo={anchorEl}>
		<p class="kp-key font-mono">{key}</p>
		{#if regex}
			<p class="kp-note">
				{compileRegexKey(regex)
					? 'A pattern matches on its own terms: the flags after the last slash decide case, and the entry’s switches have no say.'
					: 'This pattern does not compile, so the key never matches. Fix it or drop the slashes.'}
			</p>
		{:else}
			<div class="kp-modes" role="radiogroup" aria-label="How this key matches">
				{#each LOREBOOK_KEY_MODES as mode (mode.id)}
					<button
						type="button"
						class="kp-mode"
						class:is-active={effective.mode === mode.id}
						role="radio"
						aria-checked={effective.mode === mode.id}
						title={mode.hint}
						onclick={() => setRule(key, { mode: mode.id === inherited.mode ? undefined : mode.id })}
					>
						{mode.label}
						{#if mode.id === inherited.mode}<span class="kp-inherit">entry</span>{/if}
					</button>
				{/each}
			</div>
			<p class="kp-note">{LOREBOOK_KEY_MODES.find((m) => m.id === effective.mode)?.hint}</p>
			<div class="kp-row">
				<span class="kp-row-name">Case-sensitive</span>
				<Toggle
					checked={effective.caseSensitive}
					label="Case-sensitive"
					onchange={(next) =>
						setRule(key, { caseSensitive: next === inherited.caseSensitive ? undefined : next })}
				/>
			</div>
		{/if}
	</div>
{/snippet}

{#if openKey !== null && keys.includes(openKey)}
	{@render picker(openKey)}
{/if}

<style>
	.chip {
		background: var(--color-accent-muted);
		/* A chip never widens the panel: a long key truncates instead (the picker shows it whole). */
		max-width: 100%;
	}

	.chip-key {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		min-width: 0;
		color: var(--color-accent);
		cursor: pointer;
	}

	.chip-key-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip-key:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* What this key does differently from the entry it sits in, and nothing else. */
	.chip-mark {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		opacity: 0.72;
	}

	.chip-x {
		flex-shrink: 0;
		color: color-mix(in srgb, var(--color-accent) 70%, transparent);
	}

	.chip-x:hover {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 15%, transparent);
	}

	/* A pattern that cannot compile fires nothing, so it stops reading as a working key. */
	.chip.is-broken {
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
	}

	.chip.is-broken .chip-key,
	.chip.is-broken .chip-x {
		color: var(--color-error);
		text-decoration: line-through;
		text-decoration-thickness: 1px;
	}

	/* 16px is unhittable with a thumb, so grow the remove target on coarse pointers
	   without inflating the chip (negative margin keeps the visual size). */
	@media (pointer: coarse) {
		.chip-x {
			width: 1.75rem;
			height: 1.75rem;
			margin: -0.375rem;
		}
	}

	/* ===== the per-key picker ===== */

	.kp {
		z-index: 60;
		outline: none;
		width: 15rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.7rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg-elevated);
		box-shadow: var(--shadow-lg);
	}

	.kp-key {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-text-primary);
		overflow-wrap: anywhere;
	}

	.kp-modes {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.kp-mode {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.32rem 0.5rem;
		border-radius: var(--radius-md);
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-secondary);
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.kp-mode:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
		color: var(--color-text-primary);
	}

	.kp-mode.is-active {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-accent);
		font-weight: 600;
	}

	/* Which row the chip lands on when it sets nothing of its own. */
	.kp-inherit {
		font-size: 0.6rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	.kp-note {
		font-family: var(--font-ui);
		font-size: 0.7rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	.kp-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding-top: 0.15rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.kp-row-name {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		color: var(--color-text-secondary);
	}
</style>
