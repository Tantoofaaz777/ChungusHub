<script lang="ts">
	/**
	 * The composer's steering surface: quick guidance, recent reuse and switches for saved
	 * steering. The footer opens the Steering library in Settings; saved rows only toggle.
	 *
	 * Its quick box is the cheap half of exactly one axis: guidance that rides one request
	 * and deletes itself. Everything configurable about a note (lifetime, scope, placement,
	 * a name) belongs to the editor, which is one click away, so the box carries no controls
	 * of its own at all.
	 *
	 * It renders the dialog body only; InputArea owns the shared Dialog, open state, close
	 * commit, trigger button and its active dot.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { autoResize } from '$lib/actions/autoResize';
	import { toggleRow } from '$lib/actions/toggleRow';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { steeringStore } from '$lib/stores/steering.svelte';
	import { bindingLabel } from '$lib/utils/steering-labels';
	import { noteLabel, steeringTargetForChat, type SteeringScope } from '$lib/types/steering';

	let { onManageLibrary }: { onManageLibrary: () => void } = $props();

	let chat = $derived(chatStore.activeChat);
	let target = $derived(steeringTargetForChat(chat));
	// The list shows every note bound here, on or off.
	let scoped = $derived(steeringStore.scopedFor(target));
	let history = $derived(chat ? chatStore.featureState(chat.id).steeringHistory : []);

	// The quick box: guidance for THIS reply and nothing more. Deliberately one-shot with no
	// lifetime picker and no commit button: anything that outlives one request is what the
	// editor below is for, and duplicating it here with a mode pill only made the cheap
	// action look like the expensive one. Write, it fires, it's gone.
	let quickText = $state('');
	let recentOpen = $state(false);

	// A chat switch discards guidance that belonged to the previous chat.
	let seenChatId: string | null = null;
	$effect(() => {
		const id = chatStore.activeChatId;
		if (id === seenChatId) return;
		seenChatId = id;
		quickText = '';
		recentOpen = false;
	});

	/** Where a fresh note goes: the story you're in, or globally when there is none, since
	 *  global is the only scope that resolves without a chat. */
	function freshScope(): { scope: SteeringScope; scopeId: string | null } {
		return chat ? { scope: 'chat', scopeId: chat.id } : { scope: 'global', scopeId: null };
	}

	async function addQuick() {
		const text = quickText.trim();
		if (!text) return;
		// Always one-shot, always the inherited placement: this box exists to steer the next
		// request, so the two knobs it could offer both belong to the editor instead.
		await steeringStore.create({ text, ...freshScope(), mode: 'once' });
		quickText = '';
	}

	/** Commit what is sitting in the quick box, called by InputArea's close before this
	 *  panel unmounts. The box holds real guidance the user typed; letting it die with the
	 *  component made "write a line, click back into the composer, send" silently steer
	 *  nothing at all. Only an explicit close routes through here. A chat switch discards
	 *  instead, which is what the effect below is for: it would bind to the wrong story. */
	export function commitQuick(): void {
		void addQuick();
	}

	function handleQuickKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void addQuick();
	}

</script>

<div class="steering-popover">
	<div class="quick">
		<span class="field-label font-ui">Steer the next reply</span>
		<textarea
			class="quick-box"
			rows="2"
			bind:value={quickText}
			use:autoResize={{ maxHeight: 140, value: quickText, grip: false }}
			onkeydown={handleQuickKeydown}
			placeholder="Rides the next request, then it's gone…"
		></textarea>
	</div>

	<!-- Recent and saved steering share a scroller; the quick field stays at the top. -->
	<div class="pop-body panel-scroll">
		{#if history.length > 0}
			<details class="history" bind:open={recentOpen}>
				<summary class="history-head">
					<Icon name="chevronDown" class="history-chevron w-3.5 h-3.5" aria-hidden="true" />
					<Icon name="clock" class="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
					<span>Recent</span>
					<span class="history-rule" aria-hidden="true"></span>
				</summary>
				<div class="history-list">
					{#each history as entry (entry)}
						<button type="button" class="hist-row" title={entry} onclick={() => (quickText = entry)}>
							{entry}
						</button>
					{/each}
				</div>
			</details>
		{/if}

		{#if scoped.length}
			<div class="stack">
				{#each scoped as note (note.id)}
					<div class="row" class:row--off={!note.enabled} use:toggleRow>
						<Toggle
							checked={note.enabled}
							size="sm"
							label={noteLabel(note)}
							onchange={(on) => steeringStore.update(note.id, { enabled: on })}
						/>
						<span class="row-main">
							<span class="row-title font-ui">{noteLabel(note)}</span>
							<span class="row-scope font-ui">
								{bindingLabel(note)}{#if note.mode === 'once'}<span class="row-once">next reply</span>{/if}
							</span>
						</span>
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty">No saved steering here yet. Type above to steer the next reply.</p>
		{/if}
	</div>

	<div class="foot">
		<button type="button" class="foot-link font-ui" onclick={onManageLibrary}>
			Manage library
			<Icon name="arrowRight" class="w-3 h-3" />
		</button>
	</div>
</div>

<style>
	.steering-popover {
		width: 100%;
		/* The dialog supplies the outer ceiling; this keeps a long note stack compact and
		   leaves room for its fixed title bar on short screens. */
		max-height: min(26rem, 70dvh);
		padding: 0.65rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	/* The lists take whatever the fixed rows leave, and scroll inside it. */
	.pop-body {
		flex: 0 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		overscroll-behavior: contain;
	}

	.quick,
	.foot {
		flex: none;
	}

	.empty {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		margin: 0;
		font-family: var(--font-body);
		font-style: italic;
	}

	/* ===== the stack ===== */

	.stack {
		padding-top: 0.45rem;
		border-top: 1px solid var(--color-border-subtle);
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.3rem;
		border-radius: var(--radius-sm);
	}

	.row:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
	}

	/* A note switched off stays legible: it is still the rule you wrote, just idle. */
	.row--off .row-main {
		opacity: 0.5;
	}

	.row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.05rem;
		text-align: left;
		cursor: pointer;
	}

	.row-title {
		max-width: 100%;
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--color-text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-scope {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		max-width: 100%;
		font-size: 0.65rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-once {
		color: var(--color-accent);
	}

	.row-once::before {
		content: '·';
		margin-right: 0.35rem;
		color: var(--color-text-muted);
	}

	/* ===== quick add, history, foot ===== */

	.field-label {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.quick {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	/* No resize grip. See `autoResize`'s `grip: false`: this panel is anchored to its
	   bottom edge, so a bottom-right handle grows the box away from the pointer. */
	.quick-box {
		width: 100%;
		padding: 0.45rem 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-primary) 65%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-body);
		font-size: 0.82rem;
		line-height: 1.45;
	}

	.quick-box:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
	}

	.quick-box::placeholder {
		color: var(--color-text-muted);
	}

	.history {
		padding-top: 0.45rem;
	}

	.history-head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.125rem 0;
		list-style: none;
		cursor: pointer;
		font-family: var(--font-ui);
		font-size: 0.75rem;
		color: var(--color-accent);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.025em;
	}

	.history-head::-webkit-details-marker { display: none; }
	.history-head :global(.history-chevron) {
		flex-shrink: 0;
		transform: rotate(-90deg);
		transition: transform 150ms;
	}
	.history[open] .history-head :global(.history-chevron) { transform: rotate(0); }
	.history-rule {
		flex: 1;
		min-width: 0.5rem;
		border-top: 1px solid color-mix(in srgb, var(--color-border-subtle) 70%, transparent);
		margin-left: 0.25rem;
	}
	.history + .stack { border-top: 0; }

	.history-list {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding-top: 0.15rem;
	}

	.hist-row {
		text-align: left;
		padding: 0.2rem 0.3rem;
		border-radius: var(--radius-sm);
		color: var(--color-text-secondary);
		font-family: var(--font-body);
		font-size: 0.75rem;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hist-row:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
		color: var(--color-text-primary);
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-top: 0.45rem;
		border-top: 1px solid var(--color-border-subtle);
	}

	.foot-link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.25rem;
		border-radius: var(--radius-sm);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 120ms ease;
	}

	.foot-link:hover {
		color: var(--color-text-primary);
	}
</style>
