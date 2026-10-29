<script lang="ts">
	/**
	 * One steering note's editor, mounted inside the Steering library in Engines settings.
	 * The composer only toggles saved guidance and links to this manager.
	 *
	 * Every field writes through the store immediately except text and title, which ride
	 * the store's debounce (`scheduleEdit`): a click must never sit in a timer, while
	 * keystrokes must not become one write each. The store's `flush()` is what generation
	 * calls before reading the rows, so nothing here needs a save.
	 */
	import Icon from '#lib/components/ui/Icon.svelte';
	import OverrideMark from '#lib/components/ui/OverrideMark.svelte';
	import { autoResize } from '#lib/actions/autoResize.ts';
	import { chatStore } from '#lib/stores/chat.svelte.ts';
	import { featurePromptsStore } from '#lib/stores/featurePrompts.svelte.ts';
	import { steeringStore } from '#lib/stores/steering.svelte.ts';
	import {
		bindingIsForeign,
		bindingLabel,
		scopeChoices,
		scopeIdFor,
		versionChoices,
		versionLabel
	} from '#lib/utils/steering-labels.ts';
	import {
		clampSteeringDepth,
		noteLabel,
		resolvePlacement,
		STEERING_ROLES,
		steeringTargetForChat,
		type SteeringNote,
		type SteeringScope
	} from '#lib/types/steering.ts';

	interface Props {
		note: SteeringNote;
		/** Rows in the guidance textarea, its floor, since the box grows with content.
		 *  The popover is cramped, the panel is not. */
		rows?: number;
		/** Ceiling the guidance box grows to before it scrolls. */
		maxHeight?: number;
		/** Shown as a back chip when given; omitted where the editor is already beside its list. */
		onback?: () => void;
		ondeleted?: () => void;
	}

	let { note, rows = 4, maxHeight = 180, onback, ondeleted }: Props = $props();

	let advancedOpen = $state(false);
	let target = $derived(steeringTargetForChat(chatStore.activeChat));
	let choices = $derived(scopeChoices(target));
	let foreign = $derived(bindingIsForeign(note, target));
	let defaults = $derived(featurePromptsStore.steeringDefaults);

	let versionListOpen = $state(false);
	let versions = $derived(versionChoices(target));
	/** The version a scope switch left behind, so coming back to the rung doesn't have to
	 *  ask again. Only consulted while the note is bound elsewhere: a version-scoped note
	 *  already carries its own answer. */
	let strandedVersionId = $state<string | null>(null);
	let versionPick = $derived(note.scope === 'version' ? note.scopeId : strandedVersionId);

	function setScope(scope: SteeringScope) {
		void steeringStore.update(note.id, { scope, scopeId: scopeIdFor(scope, target) });
	}

	function chooseVersion(versionId: string) {
		versionListOpen = false;
		void steeringStore.update(note.id, { scope: 'version', scopeId: versionId });
	}

	/** Version is the one rung that needs a second answer, so its pill asks for it exactly
	 *  once: no pick yet means the list opens, a remembered pick binds straight away, and
	 *  changing your mind is what the chevron is for. */
	function pickScope(scope: SteeringScope) {
		if (scope !== 'version') {
			// Hold on to the version we're leaving: this is the pick coming back reuses.
			if (note.scope === 'version') strandedVersionId = note.scopeId;
			versionListOpen = false;
			setScope(scope);
			return;
		}
		if (note.scope === 'version') return;
		const remembered = versions.find((v) => v.id === strandedVersionId);
		if (remembered) chooseVersion(remembered.id);
		else versionListOpen = true;
	}

	/** What this note will actually inject with: its own values over the app-wide defaults. */
	let placement = $derived(resolvePlacement(note, defaults));

	// The field shows the depth that will be used, inherited or not, so it never stands empty
	// for a value the prompt does have. Digits commit as they land; anything else waits for
	// blur, which puts the shown value back. The way back to inheriting is the mark, not an
	// empty field.
	let depthDraft = $state('');
	$effect(() => {
		depthDraft = String(placement.depth);
	});

	function commitDepth(raw: string) {
		depthDraft = raw;
		if (/^\d+$/.test(raw.trim())) {
			void steeringStore.update(note.id, { depth: clampSteeringDepth(Number(raw)) });
		}
	}

	async function remove() {
		await steeringStore.remove(note.id);
		ondeleted?.();
	}
</script>

<div class="note-editor">
	<div class="editor-head">
		{#if onback}
			<button type="button" class="head-link font-ui" onclick={onback}>
				<Icon name="chevronLeft" class="w-3 h-3" />
				Steering
			</button>
		{:else}
			<span class="head-title font-ui">{noteLabel(note)}</span>
		{/if}
		<button type="button" class="head-link head-danger font-ui" onclick={remove}>
			<Icon name="trash" class="w-3 h-3" />
			Delete
		</button>
	</div>

	<!-- Name first: it is this note's title, and a title under its body reads as a
	     caption. Blank is fine: the lists fall back to the note's own first line. -->
	<input
		class="label-input font-ui"
		value={note.title}
		oninput={(e) => steeringStore.scheduleEdit(note.id, { title: e.currentTarget.value })}
		placeholder="Name"
		aria-label="Steering name"
	/>

	<textarea
		class="guidance"
		{rows}
		value={note.text}
		use:autoResize={{ maxHeight, value: note.text, grip: false }}
		oninput={(e) => steeringStore.scheduleEdit(note.id, { text: e.currentTarget.value })}
		placeholder="Guide the story: injected into the prompt, never shown in the chat…"
	></textarea>

	<!-- Both pill fields stack: four rungs, one of them carrying a version name, never fit
	     beside a label, and a left-aligned wrapping row next to a right-aligned one read as
	     a single blob. Same rhythm for both, label over controls. -->
	<div class="field field--stacked">
		<span class="field-label font-ui">Applies to</span>
		<div class="pills pills-wrap" role="radiogroup" aria-label="Scope">
			{#each choices as choice (choice.scope)}
				{@const disabled = !choice.available && note.scope !== choice.scope}
				{@const hint = choice.available ? choice.hint : `${choice.hint} (nothing here to bind to)`}
				{#if choice.scope === 'version'}
					<!-- Split pill: the face picks the rung, the chevron picks WHICH version. -->
					<div class="pill pill--split" class:pill--active={note.scope === 'version'}>
						<button
							type="button"
							role="radio"
							aria-checked={note.scope === 'version'}
							class="pill-face"
							{disabled}
							title={hint}
							onclick={() => pickScope('version')}
						>
							{versionPick ? `${choice.label} · ${versionLabel(versionPick)}` : choice.label}
						</button>
						<button
							type="button"
							class="pill-chev"
							{disabled}
							aria-haspopup="listbox"
							aria-expanded={versionListOpen}
							aria-label="Choose a version"
							title="Choose a version"
							onclick={() => (versionListOpen = !versionListOpen)}
						>
							<Icon name="chevronDown" class="w-3 h-3" />
						</button>
					</div>
				{:else}
					<button
						type="button"
						role="radio"
						aria-checked={note.scope === choice.scope}
						class="pill"
						class:pill--active={note.scope === choice.scope}
						{disabled}
						title={hint}
						onclick={() => pickScope(choice.scope)}
					>
						{choice.label}
					</button>
				{/if}
			{/each}
		</div>

		<!-- Inside the field, not after it: the list belongs to the pill that opened it and
		     has to sit close enough to say so. -->
		{#if versionListOpen}
			<div class="version-list" role="listbox" aria-label="Version">
				{#each versions as version (version.id)}
					<button
						type="button"
						role="option"
						aria-selected={version.id === versionPick}
						class="version-opt"
						class:version-opt--on={version.id === versionPick}
						onclick={() => chooseVersion(version.id)}
					>
						<span class="version-opt-name">{version.label}</span>
						<!-- The chat's own pin is the only version that leaves the note active here;
						     picking any other is legal and inert, so say which is which. -->
						{#if version.id === target.characterVersionId}
							<span class="version-opt-tag">pinned here</span>
						{/if}
					</button>
				{:else}
					<p class="version-empty">No versions to choose from.</p>
				{/each}
			</div>
		{/if}
	</div>

	<!-- The pills name rungs, not bindings, so a note living somewhere else has to say
	     where. Otherwise "Character" reads as the open chat's character. -->
	{#if foreign}
		<p class="foreign-note">
			Bound to {bindingLabel(note)}. Inert here until the chat matches. Re-pick above to move it.
		</p>
	{/if}

	<div class="field field--stacked">
		<span class="field-label font-ui">Lifetime</span>
		<div class="pills" role="radiogroup" aria-label="Lifetime">
			<button
				type="button"
				role="radio"
				aria-checked={note.mode === 'pinned'}
				class="pill"
				class:pill--active={note.mode === 'pinned'}
				title="Rides every reply until you switch it off"
				onclick={() => steeringStore.update(note.id, { mode: 'pinned' })}
			>
				Every reply
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={note.mode === 'once'}
				class="pill"
				class:pill--active={note.mode === 'once'}
				title="Rides the next reply, then switches off"
				onclick={() => steeringStore.update(note.id, { mode: 'once' })}
			>
				Next reply
			</button>
		</div>
	</div>

	<button
		type="button"
		class="adv-toggle font-ui"
		aria-expanded={advancedOpen}
		onclick={() => (advancedOpen = !advancedOpen)}
	>
		<Icon name="chevronRight" class="w-3 h-3 transition-transform {advancedOpen ? 'rotate-90' : ''}" />
		Advanced placement
	</button>

	{#if advancedOpen}
		<!-- Both rows show what the note will inject with, and carry a star only where that
		     differs from the default, so the block never has to be read against a footnote. -->
		<div class="adv">
			<label
				class="adv-row"
				title="How many story turns back from the end the guidance sits. 0 = right after the newest turn."
			>
				<span class="field-label font-ui">Depth</span>
				<OverrideMark
					overridden={placement.depth !== defaults.depth}
					onRevert={() => steeringStore.update(note.id, { depth: null })}
				/>
				<input
					type="number"
					class="depth-input font-ui"
					min="0"
					max="100"
					value={depthDraft}
					oninput={(e) => commitDepth(e.currentTarget.value)}
					onblur={() => (depthDraft = String(placement.depth))}
				/>
			</label>
			<div class="adv-row" role="radiogroup" aria-label="Injection role">
				<span class="field-label font-ui">Role</span>
				<OverrideMark
					overridden={placement.role !== defaults.role}
					onRevert={() => steeringStore.update(note.id, { role: null })}
				/>
				<div class="pills">
					{#each STEERING_ROLES as role (role)}
						<button
							type="button"
							role="radio"
							aria-checked={placement.role === role}
							class="pill"
							class:pill--active={placement.role === role}
							onclick={() => steeringStore.update(note.id, { role })}
						>
							{role}
						</button>
					{/each}
				</div>
			</div>
			<p class="adv-note">Inherited values come from Settings → Engines → Steering.</p>
		</div>
	{/if}
</div>

<style>
	.note-editor {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-width: 0;
	}

	.editor-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.head-title {
		min-width: 0;
		font-size: 0.78rem;
		font-weight: 640;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.head-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		padding: 0.15rem 0.25rem;
		border-radius: var(--radius-sm);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease;
	}

	.head-link:hover {
		color: var(--color-text-primary);
	}

	.head-danger:hover {
		color: var(--color-error);
	}

	.guidance,
	.label-input {
		width: 100%;
		padding: 0.45rem 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-primary) 65%, transparent);
		color: var(--color-text-primary);
	}

	/* No resize grip: `autoResize`'s `grip: false` drops it, because the popover mount is
	   anchored to its bottom edge and a bottom-right handle there fights the pointer. */
	.guidance {
		font-family: var(--font-body);
		font-size: 0.82rem;
		line-height: 1.45;
	}

	.label-input {
		padding-block: 0.35rem;
		font-size: 0.75rem;
	}

	.guidance:focus,
	.label-input:focus,
	.depth-input:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
	}

	.guidance::placeholder,
	.label-input::placeholder {
		color: var(--color-text-muted);
	}

	.field,
	.adv-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	/* Label above its own controls, and closer to them than the next field is: the editor's
	   own 0.55rem gap has to stay the BIGGER of the two, or a label reads as belonging to
	   whichever row it happens to sit nearest. */
	.field--stacked {
		flex-direction: column;
		align-items: stretch;
		gap: 0.25rem;
	}

	.field--stacked .field-label {
		align-self: flex-start;
	}

	.field--stacked .pills-wrap {
		justify-content: flex-start;
	}

	/* The label takes the slack, so the mark and the control stay together at the far end. */
	.adv-row .field-label {
		flex: 1;
	}

	.field-label {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.foreign-note,
	.adv-note {
		margin: 0;
		font-size: 0.66rem;
		font-style: italic;
		color: var(--color-text-muted);
	}

	.pills {
		display: flex;
		gap: 0.2rem;
	}

	.pills-wrap {
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.pill {
		padding: 0.2rem 0.45rem;
		border-radius: var(--radius-full);
		border: 1px solid transparent;
		background: color-mix(in srgb, var(--color-bg-tertiary) 60%, transparent);
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	/* The split pill has no text of its own: its halves light up individually. */
	.pill:hover:not(:disabled):not(.pill--split) {
		color: var(--color-text-primary);
	}

	.pill:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.pill--active {
		background: color-mix(in srgb, var(--color-accent) 16%, transparent);
		border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
		color: var(--color-accent);
	}

	/* ===== the Version pill: one pill, two targets ===== */

	.pill--split {
		display: inline-flex;
		align-items: stretch;
		padding: 0;
		overflow: hidden;
	}

	.pill-face,
	.pill-chev {
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	/* Block, not flex, so a long version name can actually ellipsize. */
	.pill-face {
		display: block;
		min-width: 0;
		max-width: 10rem;
		padding: 0.2rem 0.35rem 0.2rem 0.45rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pill-chev {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.3rem 0.2rem 0.15rem;
		opacity: 0.75;
	}

	.pill-face:hover:not(:disabled),
	.pill-chev:hover:not(:disabled) {
		color: var(--color-text-primary);
	}

	.pill--active .pill-face:hover:not(:disabled),
	.pill--active .pill-chev:hover:not(:disabled) {
		color: var(--color-accent);
	}

	.pill-chev:hover:not(:disabled) {
		opacity: 1;
	}

	.pill-face:disabled,
	.pill-chev:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* The ring goes on the pill and the half holding the keyboard washes accent, the same pair
	   the title bar's split pill uses and for the same reason: this one clips its own corners,
	   and the app's ring is drawn outside the element it belongs to, so a ring on either half
	   would survive only as the sliver in the seam between them. */
	.pill--split:has(:focus-visible) {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.pill-face:focus-visible,
	.pill-chev:focus-visible {
		outline: none;
		background: color-mix(in srgb, var(--color-accent) 26%, transparent);
	}

	.version-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 0.2rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-primary) 40%, transparent);
	}

	.version-opt {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.18rem 0.3rem;
		border-radius: var(--radius-sm);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.version-opt:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
		color: var(--color-text-primary);
	}

	.version-opt--on {
		color: var(--color-accent);
	}

	.version-opt-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Italic-muted like this editor's other asides, not a shouting uppercase chip: it is
	   a footnote on one row, not the row's headline. */
	.version-opt-tag,
	.version-empty {
		flex: none;
		font-size: 0.66rem;
		font-style: italic;
		color: var(--color-text-muted);
	}

	.version-empty {
		margin: 0;
		padding: 0.18rem 0.3rem;
	}

	.adv-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		align-self: flex-start;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.adv-toggle:hover {
		color: var(--color-text-primary);
	}

	.adv {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 0.5rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-primary) 40%, transparent);
	}

	.depth-input {
		width: 3.4rem;
		padding: 0.15rem 0.3rem;
		text-align: center;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-primary) 65%, transparent);
		color: var(--color-text-primary);
		font-size: 0.72rem;
	}
</style>
