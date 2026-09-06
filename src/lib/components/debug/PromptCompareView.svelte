<script lang="ts">
	import { DIFF_LINE_CAP, lineDiff } from '$lib/debug/diff';
	import { formatTime, sourceColor } from '$lib/debug/format';
	import type { PromptLogEntry, PromptLogMessage } from '$lib/debug/types';

	interface Props {
		a: PromptLogEntry;
		b: PromptLogEntry;
	}

	let { a, b }: Props = $props();

	interface Block {
		/** Stable list key. */
		key: string;
		label: string;
		identical: boolean;
		onlyIn: 'a' | 'b' | null;
		ops: ReturnType<typeof lineDiff>;
		sameLines: number;
		/** The LCS was skipped for size, so every line reads as changed. Said out loud. */
		coarse: boolean;
	}

	function roleOf(am?: PromptLogMessage, bm?: PromptLogMessage): string {
		if (am && bm && am.role !== bm.role) return `${am.role} → ${bm.role}`;
		return (am ?? bm)?.role ?? '';
	}

	/**
	 * What actually goes into the diff for one message: its role and image attachments on
	 * top of its text. Diffing content alone would report two requests as identical while
	 * one of them carried an image. That is the exact silence this panel exists to end.
	 */
	function diffText(m?: PromptLogMessage): string {
		if (!m) return '';
		const wire: string[] = [`[role] ${m.role}`];
		for (const path of m.images ?? []) wire.push(`[image] ${path}`);
		return wire.length ? `${wire.join('\n')}\n${m.content ?? ''}` : (m.content ?? '');
	}

	function block(key: string, label: string, left: string, right: string, onlyIn: 'a' | 'b' | null): Block {
		const identical = onlyIn === null && left === right;
		const leftLines = left.split('\n');
		const rightLines = right.split('\n');
		let ops: ReturnType<typeof lineDiff>;
		if (identical) ops = [];
		else if (onlyIn === 'a') ops = leftLines.map((text) => ({ type: 'remove' as const, text }));
		else if (onlyIn === 'b') ops = rightLines.map((text) => ({ type: 'add' as const, text }));
		else ops = lineDiff(left, right);
		const coarse =
			!identical && onlyIn === null && (leftLines.length > DIFF_LINE_CAP || rightLines.length > DIFF_LINE_CAP);
		return { key, label, identical, onlyIn, ops, sameLines: identical ? leftLines.length : 0, coarse };
	}

	let blocks = $derived.by<Block[]>(() => {
		const out: Block[] = [];
		const max = Math.max(a.messages.length, b.messages.length);
		for (let i = 0; i < max; i++) {
			const am = a.messages[i];
			const bm = b.messages[i];
			const onlyIn = !am ? 'b' : !bm ? 'a' : null;
			out.push(block(`m${i}`, `#${i + 1} · ${roleOf(am, bm)}`, diffText(am), diffText(bm), onlyIn));
		}
		return out;
	});

	let changedCount = $derived(blocks.filter((bl) => !bl.identical).length);
</script>

<div class="compare">
	<header class="compare-head">
		<div class="side">
			<span class="dot" style={`background:${sourceColor(a.source)}`}></span>
			<div class="side-meta">
				<span class="side-source">A · {a.source}</span>
				<span class="side-sub">{a.model} · {formatTime(a.startedAt)}</span>
			</div>
		</div>
		<div class="vs">vs</div>
		<div class="side side-right">
			<span class="dot" style={`background:${sourceColor(b.source)}`}></span>
			<div class="side-meta">
				<span class="side-source">B · {b.source}</span>
				<span class="side-sub">{b.model} · {formatTime(b.startedAt)}</span>
			</div>
		</div>
	</header>

	<p class="summary">
		{changedCount === 0
			? 'No differences: same messages and attachments.'
			: `${changedCount} of ${blocks.length} block${blocks.length === 1 ? '' : 's'} differ`}
		<span class="legend"><span class="swatch rm"></span>only in A<span class="swatch ad"></span>only in B</span>
	</p>

	<div class="blocks">
		{#each blocks as block (block.key)}
			<div class="block" class:block-changed={!block.identical}>
				<div class="block-head">
					<span class="block-role">{block.label}</span>
					{#if block.onlyIn === 'a'}
						<span class="badge rm">only in A</span>
					{:else if block.onlyIn === 'b'}
						<span class="badge ad">only in B</span>
					{:else if block.identical}
						<span class="badge same">identical · {block.sameLines} lines</span>
					{:else if block.coarse}
						<span
							class="badge changed"
							title={`Over ${DIFF_LINE_CAP.toLocaleString()} lines on one side, so the line-by-line match was skipped. This shows both versions whole, not the exact edits.`}
						>changed · coarse</span>
					{:else}
						<span class="badge changed">changed</span>
					{/if}
				</div>
				{#if !block.identical}
					<pre class="diff">{#each block.ops as op}<span class="line {op.type}">{op.type === 'add' ? '+ ' : op.type === 'remove' ? '- ' : '  '}{op.text}</span>{/each}</pre>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.compare {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.compare-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.6rem 0.8rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.side {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
	}

	.side-right {
		justify-content: flex-end;
	}

	.dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.side-meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.side-source {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.78rem;
		color: var(--color-text-primary);
	}

	.side-sub {
		font-family: var(--font-mono, monospace);
		font-size: 0.68rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.vs {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.summary {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
		padding: 0.5rem 0.8rem;
		font-family: var(--font-ui);
		font-size: 0.76rem;
		color: var(--color-text-secondary);
	}

	.legend {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin-left: auto;
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.swatch {
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 2px;
		margin-left: 0.4rem;
	}

	.swatch.rm {
		background: color-mix(in srgb, var(--color-error) 50%, transparent);
	}

	.swatch.ad {
		background: color-mix(in srgb, var(--color-success) 50%, transparent);
	}

	.blocks {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.block {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.block-changed {
		border-color: color-mix(in srgb, var(--color-warning) 45%, var(--color-border-subtle));
	}

	.block-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.35rem 0.55rem;
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.block-role {
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		color: var(--color-text-secondary);
	}

	.badge {
		font-family: var(--font-ui);
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.08rem 0.4rem;
		border-radius: var(--radius-sm);
	}

	.badge.same {
		color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-bg-tertiary) 50%, transparent);
	}

	.badge.changed {
		color: var(--color-warning);
		background: color-mix(in srgb, var(--color-warning) 16%, transparent);
	}

	.badge.rm {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 16%, transparent);
	}

	.badge.ad {
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 16%, transparent);
	}

	.diff {
		margin: 0;
		padding: 0.5rem;
		max-height: 22rem;
		overflow: auto;
		font-family: var(--font-mono, monospace);
		font-size: 0.74rem;
		line-height: 1.45;
	}

	.line {
		display: block;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.line.add {
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
		color: var(--color-text-primary);
	}

	.line.remove {
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
		color: var(--color-text-primary);
	}

	.line.same {
		color: var(--color-text-muted);
	}
</style>
