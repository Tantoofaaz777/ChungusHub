<!--
  The find & replace a preset carries with it.

  This is what makes a preset arrive looking the way its author designed it: the rules that
  turn the model's plain `<details>` blocks into the panels they drew, the ones that strip a
  scaffold out of the outgoing prompt. They live inside the preset, apply on top of the
  reader's own rules while it is active, and withdraw with it: nobody has to install
  anything by hand for the thing they downloaded to work.

  Each row's switch is the position the rule ARRIVES in for a reader, not a mute: ship the
  optional ones off and a reader turns on the ones they want. What a reader may do with
  these is on the Regex page: move the switch, read the rule, copy it out; the rule itself
  is never theirs to edit.

  Rules are written here, in the same `RegexRuleEditor` the Regex page mounts for the
  reader's own, so the tester an author needs to get a panel-styling pattern right is the
  one they already know. Three doors in: write one, take a copy of one of your own, or
  import a file (ours or SillyTavern's, same parser as the Regex page). Order is
  configuration (each rule sees the previous one's output), so the list drags.
-->
<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import RegexRoutingIcons from '#lib/components/regex/RegexRoutingIcons.svelte';
	import RegexRuleEditor from '#lib/components/regex/RegexRuleEditor.svelte';
	import { untrack } from 'svelte';
	import { dragHandleZone, dragHandle, type DndEvent } from 'svelte-dnd-action';
	import { regexRulesStore } from '#lib/stores/regex-rules.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import {
		createRegexRule,
		isRuleInert,
		parseRegexRulesImport,
		regexRuleError,
		routingSentence,
		REGEX_TESTER_SEED,
		type RegexRule
	} from '#lib/utils/regex-rules.ts';

	interface Props {
		rules: RegexRule[];
		onChange: (rules: RegexRule[] | undefined) => void;
		/** The active chat's last AI reply, for the tester's sample. */
		lastReply?: string;
	}

	let { rules, onChange, lastReply }: Props = $props();

	const flipDurationMs = 160;

	let fileInput = $state<HTMLInputElement | null>(null);
	let expandedId = $state<string | null>(null);
	let pickerOpen = $state(false);
	let sampleText = $state(REGEX_TESTER_SEED);

	// Local list the drag zone reorders: `consider` fires continuously through a drag and
	// must not write the preset draft on every frame, so only `finalize` does. Seeded
	// untracked and then re-seeded by the effect, which is what keeps the first paint from
	// flashing the empty state before the effect has run once.
	let list = $state<RegexRule[]>(untrack(() => [...rules]));
	$effect(() => {
		list = [...rules];
	});

	function set(next: RegexRule[]): void {
		onChange(next.length > 0 ? next : undefined);
	}

	async function importFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			if (file.size > 2 * 1024 * 1024) throw new Error('Rule files must be smaller than 2 MB.');
			const imported = parseRegexRulesImport(await file.text());
			set([...rules, ...imported]);
			toastStore.success(`Added ${imported.length} rule${imported.length === 1 ? '' : 's'} to this preset`);
		} catch (e) {
			toastStore.failed('import those rules', e);
		}
	}

	function addBlank(): void {
		const rule = createRegexRule({ name: 'New rule' });
		set([...rules, rule]);
		expandedId = rule.id;
		pickerOpen = false;
	}

	/** Take one of the author's own rules into the preset. A copy with a fresh id, never a
	 *  link: the preset has to be self-contained, and later edits to the personal rule must
	 *  not silently change what everybody downloaded.
	 *
	 *  Deliberately does not expand the copy the way a blank rule does: an adopted rule is
	 *  already finished, and unfolding a full editor between each pick would push the list
	 *  being picked from off the screen. */
	function adopt(source: RegexRule): void {
		const { id: _ownId, ...body } = source;
		const copy = createRegexRule({ ...body, targets: [...source.targets], scopes: [...source.scopes] });
		set([...rules, copy]);
		toastStore.success(`Added “${copy.name}” to this preset`);
	}

	function remove(id: string): void {
		if (expandedId === id) expandedId = null;
		set(rules.filter((r) => r.id !== id));
	}

	function setEnabled(id: string, enabled: boolean): void {
		set(rules.map((r) => (r.id === id ? { ...r, enabled } : r)));
	}

	function patch(id: string, changes: Partial<Omit<RegexRule, 'id'>>): void {
		set(rules.map((r) => (r.id === id ? { ...r, ...changes } : r)));
	}

	function consider(e: CustomEvent<DndEvent<RegexRule>>): void {
		list = e.detail.items;
	}

	function finalize(e: CustomEvent<DndEvent<RegexRule>>): void {
		list = e.detail.items;
		set([...e.detail.items]);
	}
</script>

<input bind:this={fileInput} type="file" accept=".json,application/json" class="hidden" onchange={importFile} />

<div class="cr">
	{#if list.length > 0}
		<div
			class="cr-list"
			use:dragHandleZone={{ items: list, type: 'pb-carried', flipDurationMs, dropTargetStyle: {}, delayTouchStart: 180 }}
			onconsider={consider}
			onfinalize={finalize}
		>
			{#each list as rule (rule.id)}
				{@const error = regexRuleError(rule)}
				{@const inert = isRuleInert(rule)}
				{@const open = expandedId === rule.id}
				<div class="cr-rule" class:is-off={!rule.enabled} class:is-open={open}>
					<div class="cr-row">
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span class="cr-grip" use:dragHandle aria-label="Drag to reorder" title="Drag to reorder">
							<Icon name="menu" class="w-4 h-4" strokeWidth={1.5} />
						</span>
						<Toggle
							checked={rule.enabled}
							label="Ship {rule.name} enabled"
							onchange={(on) => setEnabled(rule.id, on)}
						/>
						<button
							type="button"
							class="cr-main"
							onclick={() => (expandedId = open ? null : rule.id)}
							aria-expanded={open}
						>
							<span class="cr-name">{rule.name}</span>
							{#if error}
								<span class="cr-pill cr-pill-error" title={error}>
									<Icon name="warning" class="w-3 h-3" />
									invalid
								</span>
							{:else if inert}
								<span class="cr-pill cr-pill-warn" title={routingSentence(rule)}>
									inert
								</span>
							{:else}
								<RegexRoutingIcons {rule} />
							{/if}
							<Icon name="chevronDown" class="w-4 h-4 cr-chevron" />
						</button>
					</div>

					{#if open}
						<div class="cr-editor">
							<RegexRuleEditor
								{rule}
								onPatch={(changes) => patch(rule.id, changes)}
								bind:sampleText
								{lastReply}
							>
								{#snippet footer()}
									<span class="cr-foot-note">Readers can switch this, never edit it.</span>
									<button type="button" class="cr-remove" onclick={() => remove(rule.id)}>
										<Icon name="trash" class="w-3.5 h-3.5" />
										Remove from preset
									</button>
								{/snippet}
							</RegexRuleEditor>
						</div>
					{/if}
				</div>
			{/each}
		</div>
		{#if list.length > 1}
			<p class="cr-hint">Rules run top to bottom, after the reader's own, each seeing the last one's output.</p>
		{/if}
	{:else}
		<div class="cr-empty">
			<p>
				No rules. A preset that prints its own panels usually carries the rules that style
				them, so it looks right the moment somebody imports it.
			</p>
		</div>
	{/if}

	<div class="cr-doors">
		<button type="button" class="cr-add" onclick={addBlank}>
			<Icon name="plus" class="w-3.5 h-3.5" strokeWidth={2} />
			New rule
		</button>
		<button
			type="button"
			class="cr-door"
			onclick={() => (pickerOpen = !pickerOpen)}
			aria-expanded={pickerOpen}
			disabled={regexRulesStore.rules.length === 0}
		>
			<Icon name="copy" class="w-3.5 h-3.5" strokeWidth={2} />
			From my rules
		</button>
		<button type="button" class="cr-door" onclick={() => fileInput?.click()}>
			<Icon name="upload" class="w-3.5 h-3.5" strokeWidth={2} />
			From a file
		</button>
	</div>

	<!-- In flow rather than a popover: this page spends most of its life inside a narrow
	     dock whose ancestors clip, and a list that opens downwards there is a list with its
	     bottom half cut off. Each pick copies and the list stays open, so adding three is
	     three clicks and no selection state. -->
	{#if pickerOpen}
		<div class="cr-picker">
			<p class="cr-picker-head">Each one lands as a copy. Later edits to yours leave the preset's alone.</p>
			{#each regexRulesStore.rules as own (own.id)}
				<button type="button" class="cr-pick" onclick={() => adopt(own)}>
					<Icon name="plus" class="w-3 h-3 flex-shrink-0" />
					<span class="cr-pick-name">{own.name}</span>
					{#if !isRuleInert(own)}
						<RegexRoutingIcons rule={own} />
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.cr {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.cr-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-secondary) 84%, transparent);
		overflow: hidden;
	}

	.cr-empty {
		padding: 1.1rem 1rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-lg);
		text-align: center;
	}

	.cr-empty p {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.76rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.cr-rule {
		border-bottom: 1px solid var(--color-border-subtle);
		transition: background-color 120ms ease;
	}

	.cr-rule:last-child {
		border-bottom: 0;
	}

	.cr-rule:hover:not(.is-open) {
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
	}

	.cr-rule.is-open {
		background: color-mix(in srgb, var(--color-bg-tertiary) 40%, transparent);
	}

	.cr-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.45rem 0.6rem;
	}

	/* Only the row dims: an open editor stays legible whatever the switch says. */
	.cr-rule.is-off .cr-row {
		opacity: 0.5;
	}

	.cr-grip {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		cursor: grab;
		opacity: 0.6;
		transition: opacity 120ms ease, color 120ms ease;
	}

	.cr-grip:hover {
		opacity: 1;
		color: var(--color-text-secondary);
	}

	.cr-main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
	}

	.cr-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-text-primary);
	}

	.cr-main :global(.cr-chevron) {
		flex-shrink: 0;
		color: var(--color-text-muted);
		transition: transform 160ms ease;
	}

	.cr-rule.is-open .cr-main :global(.cr-chevron) {
		transform: rotate(180deg);
	}

	.cr-editor {
		padding: 0.6rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.cr-foot-note {
		flex: 1;
		min-width: 8rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}

	.cr-remove {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.55rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease, border-color 120ms ease, background-color 120ms ease;
	}

	.cr-remove:hover {
		color: var(--color-error);
		border-color: color-mix(in srgb, var(--color-error) 45%, transparent);
		background: color-mix(in srgb, var(--color-error) 8%, transparent);
	}

	/* The same badge vocabulary the Regex page uses, so one rule reads the same on
	   both sides of the boundary. */
	.cr-pill {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.22rem;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-full);
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.cr-pill-error {
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
		color: var(--color-error);
	}

	.cr-pill-warn {
		background: color-mix(in srgb, var(--color-warning) 14%, transparent);
		color: var(--color-warning);
	}

	.cr-hint {
		margin: 0;
		padding: 0 0.15rem;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	/* Three ways in, wrapping rather than shrinking: this lives in a ~350px dock most of
	   the time and a truncated verb is worse than a second line. */
	.cr-doors {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.cr-add,
	.cr-door {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.6rem;
		border-radius: var(--radius-md);
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
	}

	.cr-add {
		border: 1px solid color-mix(in srgb, var(--color-accent) 26%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
		color: var(--color-accent);
	}

	.cr-add:hover {
		background: color-mix(in srgb, var(--color-accent) 17%, transparent);
	}

	.cr-door {
		border: 1px solid var(--color-border);
		background: color-mix(in srgb, var(--color-bg-tertiary) 52%, transparent);
		color: var(--color-text-secondary);
	}

	.cr-door:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		color: var(--color-text-primary);
	}

	.cr-door:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.cr-picker {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		max-height: 15rem;
		overflow-y: auto;
		padding: 0.4rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-secondary) 84%, transparent);
	}

	.cr-picker-head {
		margin: 0 0 0.2rem;
		padding: 0 0.25rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		line-height: 1.4;
		color: var(--color-text-muted);
	}

	.cr-pick {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		padding: 0.32rem 0.4rem;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.cr-pick:hover {
		background: color-mix(in srgb, var(--color-accent) 11%, transparent);
		color: var(--color-accent);
	}

	.cr-pick-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-ui);
		font-size: 0.75rem;
	}
</style>
