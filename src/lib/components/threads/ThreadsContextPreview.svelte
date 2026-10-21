<script lang="ts">
	import { onDestroy } from 'svelte';
	import { threadsPrompt, assembleThreadsPrompt, normalizeThreadsConfig } from '$shared/threads/model';
	import { installmentOrRoundLabel } from '$shared/threads/prompt';
	import { countTokens, tokenCalibration, withTokenizers } from '$lib/tokenizer';
	import { panelActivity } from '$lib/components/ui/panelActivity';
	import { toastStore } from '$lib/stores/toast.svelte';

	let { count, input, model }: { count: number; input: Parameters<typeof threadsPrompt>[0] | null; model: string } = $props();
	let fullTokens = $state<number | null>(null);
	let calculating = $state(false);
	let previousTitles = $state<string[] | null>(null);
	const panelActive = panelActivity();
	let recentTokens = $state<number | null>(null);
	let lastKey: string | null = null;
	let revision = 0;
	onDestroy(() => { revision++; });
	const format = (value: number) => value.toLocaleString('en-US');
	// Round limits need no tokenizer. Token-budget titles come from the explicit count,
	// so opening or editing this panel never starts tokenization just for the preview.
	const titlesByRounds = $derived.by(() => {
		if (!input) return null;
		const config = normalizeThreadsConfig(input.config);
		if (!input.previous.length || (config.previousMode === 'tokens' && !config.previousTokens)) return [];
		if (config.previousMode === 'tokens') return null;
		const start = Math.max(0, input.previous.length - config.previousRounds);
		return input.previous.slice(start).map((round, i) => installmentOrRoundLabel(round.label, start + i + 1))
			.filter((title, i, titles) => i === 0 || title !== titles[i - 1]);
	});
	const shownTitles = $derived(previousTitles ?? titlesByRounds);
	const hasCount = $derived(recentTokens !== null && fullTokens !== null);
	$effect(() => {
		if (!panelActive()) { revision++; calculating = false; return; }
		const snapshot = input, assignedModel = model, ratio = tokenCalibration.ratioFor(model);
		const key = JSON.stringify({ snapshot, assignedModel, ratio });
		if (lastKey !== key) {
			lastKey = key;
			revision++; calculating = false;
			recentTokens = null; fullTokens = null; previousTitles = null;
		}
	});

	async function measure() {
		const snapshot = input, assignedModel = model, ratio = tokenCalibration.ratioFor(model);
		if (!panelActive() || !snapshot || !assignedModel || calculating) return;
		const ticket = ++revision;
		calculating = true;
		try {
			const result = await withTokenizers(async () => {
				if (ticket !== revision || !panelActive()) return null;
				const recent = countTokens(snapshot.messages.map(message => message.content).join('\n\n'), assignedModel);
				const result = await assembleThreadsPrompt({ ...snapshot, countTokens: text => countTokens(text, assignedModel) });
				return { recent, full: Math.round(countTokens(result.prompt, assignedModel) * ratio), titles: result.previousTitles };
			});
			if (result && ticket === revision) {
				recentTokens = result.recent; fullTokens = result.full; previousTitles = result.titles;
			}
		} catch (error) { if (ticket === revision) toastStore.failed('count Threads tokens', error); }
		finally { if (ticket === revision) calculating = false; }
	}
</script>

<div class="context-row"><span class="context-label">Previous context</span><strong class="previous-titles">{shownTitles === null ? calculating ? '…' : 'Count tokens to preview' : shownTitles.length ? shownTitles.join(' • ') : 'None yet'}</strong></div>
<div class="context-row">
	<span class="context-label">Recent context</span>
	<span class="selection-tokens">
		<span>{count} {count === 1 ? 'msg' : 'msgs'} •</span>
		<button type="button" class="token-count" class:has-count={hasCount} onclick={measure}
			disabled={calculating || !input || !model}
			aria-label={hasCount ? `Selected messages: ${format(recentTokens!)} tokens. Estimated full prompt: ${format(fullTokens!)} tokens. Count again` : 'Count tokens in Threads context'}
			title="Selected message tokens • Estimated full prompt, including instructions, continuity, notes, AO3 metadata and the output format."
			aria-live="polite">
			<span aria-hidden="true">#</span>
			{calculating ? 'Counting…' : hasCount ? `${format(recentTokens!)} tok • ~${format(fullTokens!)} tok` : 'Count tokens'}
		</button>
	</span>
</div>

<style>
	.context-row { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:.35rem .6rem; min-width:0; }
	.context-label { color:var(--color-text-muted); }
	.previous-titles { flex:1; min-width:8rem; color:var(--color-accent); font-size:.72rem; font-weight:500; text-align:right; overflow-wrap:anywhere; }
	.selection-tokens { display:inline-flex; flex-wrap:wrap; align-items:baseline; justify-content:flex-end; gap:.25rem; color:var(--color-accent); font-size:.72rem; font-weight:500; font-variant-numeric:tabular-nums; }
	.token-count { display:inline-flex; align-items:center; gap:.3rem; padding:.125rem .25rem; border-radius:var(--radius-sm); color:var(--color-text-muted); font-family:var(--font-ui); font-size:.6875rem; font-variant-numeric:tabular-nums; transition:color 140ms ease, background-color 140ms ease; }
	.token-count:hover:not(:disabled) { color:var(--color-text-primary); background:var(--color-bg-tertiary); }
	.token-count.has-count { color:var(--color-accent); }
</style>
