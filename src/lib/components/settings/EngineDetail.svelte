<script lang="ts">
	import { panelActivity } from '#lib/components/ui/panelActivity.ts';
	const panelActive = panelActivity();
	/**
	 * One engine's detail view, drilled into from the Engines list
	 * (uiStore.settingsEngineId, the connection editor's pattern). Three cards:
	 * identity (icon, name, its description on an InfoTip, switch), Model (the
	 * read-only truth about which connection this engine is routed to, with a
	 * link to the Connections page where routing lives), and Prompts (the
	 * registry-declared templates, edited inline). Extra cards configure Steering's
	 * inherited placement and Memory/Threads generation context.
	 *
	 * Prompt edits auto-save on a short debounce and flush on unmount, the same
	 * live-write contract as every other settings surface; there is no Save
	 * button and nothing to lose by leaving. Reset returns a field to the
	 * shipped default.
	 */
	import { onDestroy, untrack } from 'svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import InfoTip from '#lib/components/ui/InfoTip.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import PillRow from '#lib/components/ui/PillRow.svelte';
	import ExpandableTextarea from '#lib/components/ui/ExpandableTextarea.svelte';
	import ThreadsPromptEditor from '#lib/components/threads/ThreadsPromptEditor.svelte';
	import SteeringLibrary from './SteeringLibrary.svelte';
	import { STEERING_ROLES, type SteeringRole } from '#lib/types/steering.ts';
	import { engineById, type EngineId } from '#lib/engines/registry.ts';
	import {
		FEATURE_PROMPT_DEFAULTS,
		featurePromptsStore,
		type FeaturePromptKey
	} from '#lib/stores/featurePrompts.svelte.ts';
	import { llmService } from '#lib/services/llm/provider.ts';
	import { connectionStore } from '#lib/stores/connections.svelte.ts';
	import { uiStore } from '#lib/stores/ui.svelte.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';
	import type { CallTarget } from '#lib/types/llm.ts';
	import { threadsConfigStore } from '#lib/threads/config.svelte.ts';
	import { toggleRow } from '#lib/actions/toggleRow.ts';

	import { copyText } from '#lib/utils/clipboard.ts';

	/** The host list keys this component on the id, so it remounts per engine. */
	let { id }: { id: string } = $props();

	const engine = $derived(engineById(id as EngineId));

	/** Resolved `connection · model · provider` for whatever serves a call target. */
	function connectionLine(target: CallTarget): string {
		const name = connectionStore.connectionFor(target)?.name ?? 'no connection';
		const model = llmService.modelFor(target) || 'no model set';
		const provider = llmService.providerFor(target);
		const providerLabel = provider
			? (llmService.getProviderMeta(provider)?.displayName ?? provider)
			: 'no provider';
		return `${name} · ${model} · ${providerLabel}`;
	}

	/** The keys this template is written around, read off the shipped default so the
	 *  list survives you deleting one from your own edit. */
	function flowKeys(key: FeaturePromptKey): string[] {
		return [...new Set(FEATURE_PROMPT_DEFAULTS[key].match(/\{\{\w+\}\}/g) ?? [])];
	}

	// Live drafts, auto-committed on a short debounce (and flushed on unmount),
	// the same write-through contract as the rest of Settings. The draft map only
	// exists so half-typed text isn't persisted on every keystroke. Seeded once per
	// mount on purpose: the host keys this component on the engine id.
	const initialDrafts: Record<string, string> = {};
	// svelte-ignore state_referenced_locally
	for (const field of engine.prompts.filter(field => field.key !== 'threads')) initialDrafts[field.key] = featurePromptsStore.promptFor(field.key);
	let drafts = $state<Record<string, string>>(initialDrafts);

	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function commit(): void {
		saveTimer = null;
		for (const field of engine.prompts) {
			if (field.key === 'threads') continue;
			const value = drafts[field.key];
			if (value !== undefined && value !== featurePromptsStore.promptFor(field.key)) {
				featurePromptsStore.setPrompt(field.key, value);
			}
		}
	}

	function queueCommit(): void {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(commit, 600);
	}

	$effect(() => {
		if (!panelActive()) untrack(() => { if (saveTimer) { clearTimeout(saveTimer); commit(); } });
	});
	onDestroy(() => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			commit();
		}
	});

	function resetField(key: FeaturePromptKey): void {
		if (saveTimer) clearTimeout(saveTimer);
		featurePromptsStore.resetPrompt(key);
		drafts = { ...drafts, [key]: featurePromptsStore.promptFor(key) };
		// Commit any other field's pending edit now: the reset field matches the
		// store again, so this is a no-op for it.
		commit();
	}

	/** Instant, draft-based: what you see differs from the shipped default. */
	function isModified(key: FeaturePromptKey): boolean {
		return (drafts[key] ?? '') !== FEATURE_PROMPT_DEFAULTS[key];
	}

	let copied = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	// Waits for the copy so the tick only ever means the token really is on the clipboard.
	async function copyKey(token: string): Promise<void> {
		try {
			await copyText(token);
		} catch {
			toastStore.error('Copy failed. Type the token out instead.');
			return;
		}
		copied = token;
		if (copyTimer) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = null), 1300);
	}

	/** Rows follow the template's own length, so a one-line wrapper gets a small box
	 *  and a long memory template opens fully. Deliberately the `rows` attribute and
	 *  not a JS height: dragging the resize grip writes an inline height that wins
	 *  from then on, so the box stays yours once you have sized it. */
	function promptRows(draft: string): number {
		return Math.min(20, Math.max(3, draft.split('\n').length + 1));
	}
</script>

<div class="detail">
	<section class="card">
		<div class="identity" use:toggleRow>
			<span class="orb">
				<Icon name={engine.icon} class="w-5 h-5" strokeWidth={1.75} />
			</span>
			<div class="identity-text">
				<span class="identity-name">{engine.name}</span>
				<InfoTip text={engine.description} />
			</div>
			<Toggle
				checked={engine.enabled.get()}
				onchange={(v) => engine.enabled.set(v)}
				label="Enable {engine.name}"
			/>
		</div>
	</section>

	<section class="card">
		<div class="card-head">
			<span class="card-title">Model</span>
			{#if engine.makesCalls}
				<button
					type="button"
					class="link-btn head-action"
					onclick={() => uiStore.gotoSettingsPage('connections')}
				>
					Change on Connections
				</button>
			{/if}
		</div>
		{#if engine.makesCalls}
			<p class="model-line">{connectionLine({ engine: engine.id })}</p>
		{:else}
			<p class="model-line">
				No model call. The guidance you type rides the story generation itself.
			</p>
		{/if}
	</section>

	{#if engine.id === 'threads'}
		<section class="card">
			<div class="card-head"><span class="card-title">Continuity</span></div>
			<div class="card-body">
				<div class="threads-context">
					<h3>Previous story context</h3>
					<PillRow options={[{value:'rounds',label:'Rounds'},{value:'tokens',label:'Tokens'}]} current={threadsConfigStore.value.previousMode} onpick={(v) => threadsConfigStore.set('previousMode', v as 'rounds' | 'tokens')} label="Story context limit mode" />
					{#if threadsConfigStore.value.previousMode === 'tokens'}
						<label class="threads-limit" for="threads-previous-limit">Token budget<input id="threads-previous-limit" class="input-base" type="number" min="0" max="2000000" step="1" value={threadsConfigStore.value.previousTokens} oninput={(e) => { if (Number.isFinite(e.currentTarget.valueAsNumber)) threadsConfigStore.set('previousTokens',e.currentTarget.valueAsNumber); }} /></label>
					{:else}
						<label class="threads-limit" for="threads-previous-limit">Previous story rounds<input id="threads-previous-limit" class="input-base" type="number" min="0" max="50" step="1" value={threadsConfigStore.value.previousRounds} oninput={(e) => { if (Number.isFinite(e.currentTarget.valueAsNumber)) threadsConfigStore.set('previousRounds',e.currentTarget.valueAsNumber); }} /></label>
					{/if}
				</div>
				<div class="threads-context">
					<h3>Fandom continuity</h3>
					<PillRow options={[{value:'threads',label:'Threads'},{value:'tokens',label:'Tokens'}]} current={threadsConfigStore.value.fandomMode} onpick={(v) => threadsConfigStore.set('fandomMode', v as 'threads' | 'tokens')} label="Fandom continuity limit mode" />
					{#if threadsConfigStore.value.fandomMode === 'tokens'}
						<label class="threads-limit" for="threads-fandom-limit">Token budget<input id="threads-fandom-limit" class="input-base" type="number" min="0" max="2000000" step="1" value={threadsConfigStore.value.fandomTokens} oninput={(e) => { if (Number.isFinite(e.currentTarget.valueAsNumber)) threadsConfigStore.set('fandomTokens',e.currentTarget.valueAsNumber); }} /></label>
					{:else}
						<label class="threads-limit" for="threads-fandom-limit">Previous fandom threads<input id="threads-fandom-limit" class="input-base" type="number" min="0" max="50" step="1" value={threadsConfigStore.value.fandomThreads} oninput={(e) => { if (Number.isFinite(e.currentTarget.valueAsNumber)) threadsConfigStore.set('fandomThreads',e.currentTarget.valueAsNumber); }} /></label>
					{/if}
				</div>
				<p class="placement-note">Story context keeps the newest whole messages; fandom continuity keeps whole threads. The selected scene is never trimmed. Set a limit to 0 to omit that context.</p>
			</div>
		</section>
	{/if}

	{#if engine.id === 'memory'}
		<section class="card">
			<div class="card-head"><span class="card-title">Generation context</span></div>
			<div class="card-body">
				<label class="threads-limit" for="memory-previous-summaries">
					Previous summaries
					<input id="memory-previous-summaries" class="input-base" type="number" min="0" step="1"
						value={featurePromptsStore.memoryPreviousSummaries}
						oninput={(e) => { if (Number.isFinite(e.currentTarget.valueAsNumber)) featurePromptsStore.setMemoryPreviousSummaries(e.currentTarget.valueAsNumber); }} />
				</label>
				<p class="placement-note">Include up to this many earlier summaries when generating chapters, arcs or volumes, oldest to newest. Compacted memories use their highest active summary. Default: 6. Set to 0 to omit previous summaries.</p>
			</div>
		</section>
		<section class="card">
			<div class="card-head" use:toggleRow>
				<span class="card-title">Memory reminders</span>
				<Toggle checked={featurePromptsStore.memoryReminderEnabled}
					onchange={(value) => featurePromptsStore.setMemoryReminderEnabled(value)} label="Enable memory reminders" />
			</div>
			<div class="card-body">
				<label class="threads-limit" for="memory-reminder-interval">
					Remind every (tokens)
					<input id="memory-reminder-interval" class="input-base" type="number" min="1" max="2000000" step="1"
						disabled={!featurePromptsStore.memoryReminderEnabled}
						value={featurePromptsStore.memoryReminderInterval}
						onchange={(e) => { if (Number.isFinite(e.currentTarget.valueAsNumber)) featurePromptsStore.setMemoryReminderInterval(e.currentTarget.valueAsNumber); }} />
				</label>
				<p class="placement-note">Show an in-app reminder after each interval of message text since the latest valid saved memory on this branch. Token counts are estimates; prompts, lorebooks, reasoning and hidden messages are excluded. Saving a memory moves the starting point to the end of its source range.</p>
			</div>
		</section>
	{/if}

	<!-- Steering's one extra card: the placement every note inherits. A note overrides either
	     field per note (its `depth`/`role` are tri-state, null = inherit), so this is the
	     bottom of that chain, not a competing setting. -->
	{#if engine.id === 'steering'}
		<!-- No `data-setting` anchor: the detail view lives behind a drill-down keyed on
		     uiStore.settingsEngineId, which a deep link cannot set, so an anchor here
		     would be unreachable by the very thing anchors exist for. -->
		<section class="card">
			<div class="card-head">
				<span class="card-title">Default placement</span>
			</div>
			<div class="card-body">
				<div class="slider-block">
					<div class="slider-top">
						<label for="steering-depth" class="slider-label">Depth</label>
						<span class="slider-value">
							{featurePromptsStore.steeringDefaults.depth === 0
								? 'after the newest turn'
								: `${featurePromptsStore.steeringDefaults.depth} turns back`}
						</span>
					</div>
					<input
						id="steering-depth"
						type="range"
						class="slider"
						min="0"
						max="20"
						step="1"
						value={featurePromptsStore.steeringDefaults.depth}
						oninput={(e) => featurePromptsStore.setSteeringDefaultDepth(Number(e.currentTarget.value))}
					/>
				</div>
				<div class="sub-block">
					<span class="section-label">Role</span>
					<PillRow
						options={STEERING_ROLES.map((role) => ({ value: role, label: role }))}
						current={featurePromptsStore.steeringDefaults.role}
						onpick={(value) => featurePromptsStore.setSteeringDefaultRole(value as SteeringRole)}
						label="Default steering role"
					/>
				</div>
				<p class="placement-note">
					Guidance sharing a role and depth arrives as one wrapped block instead of scattered turns.
				</p>
			</div>
		</section>

	{/if}



	<section class="card">
		<div class="card-head">
			<span class="card-title">Prompts</span>
		</div>
		<div class="prompt-fields">
			{#each engine.prompts as field (field.key)}
				{@const keys = flowKeys(field.key)}
				{@const missing = (field.requires ?? []).filter((m) => !(drafts[field.key] ?? '').includes(m))}
				<div class="prompt-field">
					{#if field.key === 'threads'}
						<ThreadsPromptEditor {field} />
					{:else}
					<div class="prompt-head">
						<label class="prompt-label" for={`engine-prompt-${field.key}`}>{field.label}</label>
						<InfoTip text={field.hint} />
						{#if isModified(field.key)}
							<span class="modified-badge" title="Differs from the shipped default">Modified</span>
						{/if}
						<button
							type="button"
							class="link-btn prompt-reset"
							onclick={() => resetField(field.key)}
							disabled={!isModified(field.key)}
						>
							Reset
						</button>
					</div>
					{#if engine.id === 'memory'}
						<ExpandableTextarea
							id={`engine-prompt-${field.key}`}
							value={drafts[field.key] ?? ''}
							onValueChange={(value) => {
								drafts[field.key] = value;
								queueCommit();
							}}
							dialogTitle={`${engine.name} · ${field.label}`}
							expandLabel={`Expand ${field.label} prompt`}
							spellcheck={false}
							rows={promptRows(drafts[field.key] ?? '')}
							class={`input-base prompt-input${missing.length ? ' is-broken' : ''}`}
							expandedClass="font-mono text-sm text-text-primary"
						/>
					{:else}
						<textarea
							id={`engine-prompt-${field.key}`}
							class="input-base prompt-input"
							class:is-broken={missing.length > 0}
							spellcheck="false"
							rows={promptRows(drafts[field.key] ?? '')}
							bind:value={drafts[field.key]}
							oninput={queueCommit}
						></textarea>
					{/if}
					<!-- Said here as well as thrown at run time: by the time the engine refuses,
					     the user is looking at a failed generation, not at the edit that caused it. -->
					{#if missing.length}
						<p class="prompt-broken">
							<Icon name="warning" class="w-3.5 h-3.5" />
							Missing {missing.join(', ')}. The engine refuses to run without it, so put it back or press Reset.
						</p>
					{/if}
					{#if keys.length}
						<div class="keys">
							<span class="keys-label">Keys</span>
							{#each keys as token (token)}
								<button
									type="button"
									class="key-chip"
									title="Click to copy"
									onclick={() => copyKey(token)}
								>
									{copied === token ? 'copied' : token}
								</button>
							{/each}
						</div>
					{/if}
					{/if}
				</div>
			{/each}
		</div>
	</section>
	{#if engine.id === 'steering'}<SteeringLibrary />{/if}
</div>

<style>
	.threads-limit { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:.8rem; font-size:.8rem; color:var(--color-text-secondary); }
	.threads-context + .threads-context { margin-top:1.2rem; }
	.threads-context h3 { font-size:.78rem; font-weight:600; color:var(--color-text-secondary); margin-bottom:.5rem; }
	.threads-context .threads-limit { margin-top:.7rem; }
	.threads-limit input { width:7rem; padding:.4rem .6rem; }
	.detail {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	/* ===== Identity ===== */
	.identity {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	.orb {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		background:
			radial-gradient(
				circle at 30% 20%,
				color-mix(in srgb, var(--color-accent) 14%, transparent),
				transparent 60%
			),
			color-mix(in srgb, var(--color-bg-tertiary) 55%, transparent);
		color: var(--color-accent);
	}

	.identity-text {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.identity-name {
		font-family: var(--font-ui);
		font-size: 0.95rem;
		font-weight: 650;
		color: var(--color-text-primary);
	}

	/* ===== Default placement (Steering), Memory defaults ===== */

	/* Labeled sub-group inside a card, the ChatPage recipe. */
	.sub-block {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.placement-note {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	/* ===== Model ===== */
	.head-action {
		margin-left: auto;
		font-size: 0.72rem;
	}

	.model-line {
		font-family: var(--font-ui);
		font-size: 0.76rem;
		line-height: 1.45;
		color: var(--color-text-primary);
		overflow-wrap: anywhere;
	}

	/* ===== Prompts ===== */
	.prompt-fields {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.prompt-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.prompt-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.prompt-label {
		font-family: var(--font-ui);
		font-size: 0.76rem;
		font-weight: 620;
		color: var(--color-text-primary);
	}

	.modified-badge {
		padding: 0.02rem 0.35rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 620;
		color: var(--color-text-muted);
	}

	.prompt-reset {
		margin-left: auto;
		font-size: 0.72rem;
	}

	.prompt-reset:disabled {
		color: var(--color-text-muted);
		text-decoration: none;
		cursor: not-allowed;
	}

	/* Surface, border and focus ring come from .input-base like every other settings
	   input; only the monospace prompt sizing is local. */
	.prompt-field :global(.prompt-input) {
		width: 100%;
		resize: vertical;
		padding: 0.55rem 0.65rem;
		color: var(--color-text-primary);
		font-family: var(--font-mono, monospace);
		font-size: 0.76rem;
		line-height: 1.5;
	}
	.prompt-field :global(.prompt-input.is-broken) {
		border-color: color-mix(in srgb, var(--color-warning) 55%, transparent);
	}

	.prompt-broken {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin: 0;
		font-family: var(--font-ui);
		font-size: 0.74rem;
		line-height: 1.45;
		color: var(--color-warning);
	}

	.keys {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.keys-label {
		font-family: var(--font-ui);
		font-size: 0.66rem;
		color: var(--color-text-muted);
	}

	.key-chip {
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-tertiary) 45%, transparent);
		font-family: var(--font-mono, monospace);
		font-size: 0.68rem;
		color: var(--color-accent);
		cursor: pointer;
		transition: border-color 120ms ease, background-color 120ms ease;
	}

	.key-chip:hover {
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}
</style>
