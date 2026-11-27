<script lang="ts">
	import { onDestroy } from 'svelte';
	import { threadsPrompt, normalizeThreadsConfig, threadsStoryWindow } from '#shared/threads/model.ts';
	import { installmentOrRoundLabel } from '#shared/threads/prompt.ts';
	import { countTokens, tokenCalibration, withTokenizers } from '#lib/tokenizer/index.ts';
	import { panelActivity } from '#lib/components/ui/panelActivity.ts';
	import { toastStore } from '#lib/stores/toast.svelte.ts';

	let { count, input, model }: { count: number; input: Parameters<typeof threadsPrompt>[0] | null; model: string } = $props();
	let fullTokens = $state<number | null>(null);
	let calculating = $state(false);
	const panelActive = panelActivity();
	let recentTokens = $state<number | null>(null);
	let lastKey: string | null = null;
	let revision = 0;
	onDestroy(() => { revision++; });
	const format = (value: number) => value.toLocaleString('en-US');
	const storyWindow = $derived(input ? threadsStoryWindow(input.previous, normalizeThreadsConfig(input.config)) : null);
	const summariesPending = $derived(storyWindow?.older.some(round => !round.summary) ?? false);
	const shownTitles = $derived.by(() => {
		if (!input || !storyWindow) return [];
		const { older, full } = storyWindow;
		const start = input.previous.length - full.length;
		const fullTitles = full.map((round, i) => installmentOrRoundLabel(round.label, start + i + 1))
			.filter((title, i, titles) => i === 0 || title !== titles[i - 1]);
		return [...older.map((r, i) => `${installmentOrRoundLabel(r.label, i + 1)} (${r.summary ? 'summary' : 'summary pending'})`), ...fullTitles];
	});
	const hasCount = $derived(recentTokens !== null && fullTokens !== null);
	$effect(() => {
		if (!panelActive()) { revision++; calculating = false; return; }
		const snapshot = input, assignedModel = model, ratio = tokenCalibration.ratioFor(model);
		const key = JSON.stringify({ snapshot, assignedModel, ratio });
		if (lastKey !== key) {
			lastKey = key;
			revision++; calculating = false;
			recentTokens = null; fullTokens = null;
		}
	});

	async function measure() {
		const snapshot = input, assignedModel = model, ratio = tokenCalibration.ratioFor(model);
		if (!panelActive() || !snapshot || !assignedModel || calculating) return;
		const ticket = ++revision;
		calculating = true;
		try {
			const result = await withTokenizers(() => {
				if (ticket !== revision || !panelActive()) return null;
				const recent = countTokens(snapshot.messages.map(message => message.content).join('\n\n'), assignedModel);
				const full = Math.round(countTokens(threadsPrompt(snapshot), assignedModel) * ratio);
				return { recent, full };
			});
			if (result && ticket === revision) {
				recentTokens = result.recent; fullTokens = result.full;
			}
		} catch (error) { if (ticket === revision) toastStore.failed('count Threads tokens', error); }
		finally { if (ticket === revision) calculating = false; }
	}
</script>

<div class="context-row"><span class="context-label">Previous context</span><strong class="previous-titles">{shownTitles.length ? shownTitles.join(' • ') : 'None yet'}</strong></div>
<div class="context-row">
	<span class="context-label">Recent context</span>
	<span class="selection-tokens">
		<span>{count} {count === 1 ? 'msg' : 'msgs'} •</span>
		<button type="button" class="token-count" class:has-count={hasCount} onclick={measure}
			disabled={calculating || !input || !model}
			aria-label={hasCount ? `Selected messages: ${format(recentTokens!)} tokens. ${summariesPending ? 'Estimate before new summaries' : 'Estimated full prompt'}: ${format(fullTokens!)} tokens. Count again` : 'Count tokens in Threads context'}
			title={summariesPending ? 'Selected message tokens • Estimated prompt before generating pending summaries.' : 'Selected message tokens • Estimated full prompt, including instructions, continuity, notes, AO3 metadata and the output format.'}
			aria-live="polite">
			<span aria-hidden="true">#</span>
			{calculating ? 'Counting…' : hasCount ? `${format(recentTokens!)} tok • ~${format(fullTokens!)} tok${summariesPending ? ' before new summaries' : ''}` : 'Count tokens'}
		</button>
	</span>
</div>

<style>
	.context-row { display:flex; flex-direction:column; align-items:center; gap:.15rem; min-width:0; text-align:center; }
	.context-label { color:var(--color-text-muted); }
	.previous-titles { max-width:100%; color:var(--color-accent); font-size:.72rem; font-weight:500; overflow-wrap:anywhere; }
	.selection-tokens { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:center; gap:.25rem; max-width:100%; color:var(--color-accent); font-size:.72rem; font-weight:500; font-variant-numeric:tabular-nums; }
	.token-count { display:inline-flex; align-items:center; gap:.3rem; padding:.125rem .25rem; border-radius:var(--radius-sm); color:var(--color-text-muted); font-family:var(--font-ui); font-size:.6875rem; font-variant-numeric:tabular-nums; transition:color 140ms ease, background-color 140ms ease; }
	.token-count:hover:not(:disabled) { color:var(--color-text-primary); background:var(--color-bg-tertiary); }
	.token-count.has-count { color:var(--color-accent); }
</style>
