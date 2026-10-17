<script lang="ts">
	import { threadsPrompt, assembleThreadsPrompt } from '$shared/threads/model';
	import { countTokens, tokenCalibration } from '$lib/tokenizer';
	import { panelActivity } from '$lib/components/ui/panelActivity';

	let { count, input, model }: { count: number; input: Parameters<typeof threadsPrompt>[0] | null; model: string } = $props();
	let fullTokens = $state<number | null>(null);
	let calculating = $state(false);
	let previousTitles = $state<string[] | null>(null);
	const panelActive = panelActivity();
	let recentTokens = $state<number | null>(null);
	let cached: { key: string; recent: number; full: number; titles: string[] } | null = null;
	const format = (value: number) => value.toLocaleString('en-US');
	$effect(() => {
		if (!panelActive()) { calculating = false; return; }
		const snapshot = input, assignedModel = model, ratio = tokenCalibration.ratioFor(model);
		const key = JSON.stringify({ snapshot, assignedModel, ratio });
		if (cached?.key === key) {
			recentTokens = cached.recent; fullTokens = cached.full; previousTitles = cached.titles; calculating = false;
			return;
		}
		const recent = snapshot ? countTokens(snapshot.messages.map(message => message.content).join('\n\n'), assignedModel || undefined) : null;
		recentTokens = recent;
		let current = true;
		fullTokens = null; previousTitles = null; calculating = false;
		if (!snapshot || !assignedModel) return;
		calculating = true;
		// Selection can change quickly; count only the most recent snapshot after the burst.
		const timer = setTimeout(() => {
			void assembleThreadsPrompt({ ...snapshot, countTokens: text => countTokens(text, assignedModel) }).then(result => {
				if (current) {
					fullTokens = Math.round(countTokens(result.prompt, assignedModel) * ratio); previousTitles = result.previousTitles;
					cached = { key, recent: recent ?? 0, full: fullTokens, titles: result.previousTitles };
				}
			}).catch(() => { if (current) { fullTokens = null; previousTitles = null; } }).finally(() => { if (current) calculating = false; });
		}, 150);
		return () => { current = false; clearTimeout(timer); };
	});
</script>

<div class="context-row"><span class="context-label">Previous context</span><strong class="previous-titles">{calculating ? '…' : previousTitles === null ? '-' : previousTitles.length ? previousTitles.join(' • ') : 'None yet'}</strong></div>
<div class="context-row"><span class="context-label">Recent context</span><span class="selection-tokens" title="Selected message tokens. FP: estimated full prompt, including instructions, continuity, notes, AO3 metadata and the output format.">{count} {count === 1 ? 'msg' : 'msgs'} • {recentTokens === null ? '-' : format(recentTokens)} tok • FP {calculating ? '…' : fullTokens === null ? '-' : `~${format(fullTokens)} tok`}</span></div>

<style>
	.context-row { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:.35rem .6rem; min-width:0; }
	.context-label { color:var(--color-text-muted); }
	.previous-titles { flex:1; min-width:8rem; color:var(--color-accent); font-size:.72rem; font-weight:500; text-align:right; overflow-wrap:anywhere; }
	.selection-tokens { color:var(--color-accent); font-size:.72rem; font-weight:500; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
</style>
