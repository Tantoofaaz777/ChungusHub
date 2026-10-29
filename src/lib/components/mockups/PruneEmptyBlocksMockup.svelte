<!--
  PruneEmptyBlocksMockup: animated demo for the "Prune empty blocks" preset toggle.

  The mock toggle at the top flips Off <-> On so it's unmistakable which state
  is which:
    - Off: the template ships as written. The <memory> block goes out as an
      empty shell because its only macro resolves to nothing.
    - On: that whole macro-only block (tags included) drops out of the
      send. The static-only <style> block below never moves.

  Pure CSS animation; it exists only while the tip is open.
-->
<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
</script>

<div class="demo" aria-hidden="true">
	<div class="head">
		<span class="switch"><span class="knob"></span></span>
		<span class="state">
			<span class="lbl off">Off</span>
			<span class="lbl on">On</span>
		</span>
		<span class="count">
			<span class="c c-sent">empty shell sent</span>
			<span class="c c-drop">shell dropped</span>
		</span>
	</div>

	<div class="doc">
		<div class="block prunable">
			<span class="ln"><span class="tag">&lt;memory&gt;</span></span>
			<span class="ln"><span class="macro">{'{{memory}}'}</span><span class="mark">empty</span></span>
			<span class="ln"><span class="tag">&lt;/memory&gt;</span></span>
		</div>
		<div class="block">
			<span class="ln"><span class="tag">&lt;style&gt;</span><span class="mark">static</span></span>
			<span class="ln">Keep the pace steady.</span>
			<span class="ln"><span class="tag">&lt;/style&gt;</span></span>
		</div>
	</div>

	<!-- Fixed in both states: kills the "it rewrites my preset" misread. Pruning
	     happens at send time; the template text is never modified. -->
	<div class="note">
		<Icon name="check" class="w-3 h-3" strokeWidth={2.25} />
		<span>Prunes only what's sent. Your template text is never edited.</span>
	</div>
</div>

<style>
	.demo {
		--dur: 6.6s;
		--sys: #60a5fa;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.65rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 55%, transparent);
		border: 1px solid var(--color-border-subtle);
	}

	/* ── Header: the toggle that names the state ───────────────────────── */
	.head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.switch {
		position: relative;
		flex-shrink: 0;
		width: 34px;
		height: 18px;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border);
		background: var(--color-bg-tertiary);
		animation: switch-track var(--dur) ease-in-out infinite;
	}
	.knob {
		position: absolute;
		top: 1px;
		left: 1px;
		width: 14px;
		height: 14px;
		border-radius: var(--radius-full);
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 35%);
		animation: knob-slide var(--dur) cubic-bezier(0.22, 1, 0.36, 1) infinite;
	}

	.state {
		position: relative;
		width: 1.8rem;
		height: 0.95rem;
	}
	.lbl {
		position: absolute;
		left: 0;
		top: 0;
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.72rem;
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.lbl.off {
		color: var(--color-text-muted);
		animation-name: lbl-off;
	}
	.lbl.on {
		color: var(--color-accent);
		animation-name: lbl-on;
	}

	.count {
		position: relative;
		margin-left: auto;
		height: 1.05rem;
		min-width: 7.2rem;
	}
	.c {
		position: absolute;
		right: 0;
		top: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.64rem;
		letter-spacing: 0.02em;
		white-space: nowrap;
		border-radius: var(--radius-full);
		padding: 0.05rem 0.5rem;
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.c.c-sent {
		color: var(--color-text-muted);
		background: color-mix(in srgb, var(--color-bg-tertiary) 60%, transparent);
		border: 1px solid var(--color-border-subtle);
		animation-name: sent-out;
	}
	.c.c-drop {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
		animation-name: drop-in;
	}

	/* ── The template as it ships ──────────────────────────────────────── */
	.doc {
		display: flex;
		flex-direction: column;
		padding: 0.5rem 0.55rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.ln {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.7rem;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.tag {
		color: var(--sys);
	}

	/* Same accent treatment as the token-count mockup's macro chip. */
	.macro {
		font-weight: 600;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 32%, transparent);
		border-radius: var(--radius-sm);
		padding: 0 0.2rem;
	}

	.mark {
		font-family: var(--font-ui);
		font-size: 0.5rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-full);
		padding: 0.02rem 0.32rem;
	}

	/* The block whose only macro is empty: the whole thing sweeps out when On. */
	.prunable {
		overflow: hidden;
		margin-bottom: 0.5rem;
		animation: prune-collapse var(--dur) ease-in-out infinite;
	}

	/* Constant clarifier: pruning shapes the send, never the authored template. */
	.note {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border-subtle);
		font-family: var(--font-ui);
		font-size: 0.64rem;
		line-height: 1.35;
		color: var(--color-text-muted);
	}
	.note :global(svg) {
		flex-shrink: 0;
		color: var(--color-success);
	}

	/* ── Timeline: Off held 0–18% & 80–100%, flip 18–31%, On held 31–67%,
	     flip back 67–80%. Matches the merge-roles mockup. ───────────────── */
	@keyframes switch-track {
		0%, 18% { background: var(--color-bg-tertiary); border-color: var(--color-border); }
		31%, 67% { background: var(--color-accent); border-color: transparent; }
		80%, 100% { background: var(--color-bg-tertiary); border-color: var(--color-border); }
	}
	@keyframes knob-slide {
		0%, 18% { transform: translateX(0); }
		31%, 67% { transform: translateX(16px); }
		80%, 100% { transform: translateX(0); }
	}

	@keyframes lbl-off {
		0%, 18% { opacity: 1; }
		28%, 70% { opacity: 0; }
		80%, 100% { opacity: 1; }
	}
	@keyframes lbl-on {
		0%, 22% { opacity: 0; }
		31%, 67% { opacity: 1; }
		77%, 100% { opacity: 0; }
	}

	@keyframes sent-out {
		0%, 20% { opacity: 1; }
		31%, 68% { opacity: 0; }
		79%, 100% { opacity: 1; }
	}
	@keyframes drop-in {
		0%, 22% { opacity: 0; }
		33%, 67% { opacity: 1; }
		78%, 100% { opacity: 0; }
	}

	@keyframes prune-collapse {
		0%, 18% { max-height: 5.6rem; opacity: 1; margin-bottom: 0.5rem; }
		31%, 67% { max-height: 0; opacity: 0; margin-bottom: 0; }
		80%, 100% { max-height: 5.6rem; opacity: 1; margin-bottom: 0.5rem; }
	}

	/* No motion: settle on the On (pruned) end-state so the payoff still reads. */
	@media (prefers-reduced-motion: reduce) {
		.switch,
		.knob,
		.lbl,
		.c,
		.prunable {
			animation: none;
		}
		.switch { background: var(--color-accent); border-color: transparent; }
		.knob { transform: translateX(16px); }
		.lbl.off { opacity: 0; }
		.lbl.on { opacity: 1; }
		.c.c-sent { opacity: 0; }
		.c.c-drop { opacity: 1; }
		.prunable { max-height: 0; opacity: 0; margin-bottom: 0; }
	}
</style>
