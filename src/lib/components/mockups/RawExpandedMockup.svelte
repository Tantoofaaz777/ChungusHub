<!--
  RawExpandedMockup: animated demo for the "Raw / Expanded" token-count toggle.

  The mock button at the top flips Raw <-> Expanded (mirroring the real one), so
  it's obvious which state is which:
    - Raw: counts the text as authored. The {{char}} macro is just a few literal
      characters, so the number is small.
    - Expanded: the macro resolves into the value it actually stands for, the item
      grows, and the token count jumps (with the +N the real button shows).

  Pure CSS animation; it exists only while the tip is open.
-->
<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
</script>

<div class="demo" aria-hidden="true">
	<div class="head">
		<span class="btn">
			<Icon name="sparkles" class="w-3.5 h-3.5" strokeWidth={1.5} />
			<span class="blabel">
				<span class="bl raw-bl">Raw</span>
				<span class="bl exp-bl">Expanded</span>
			</span>
		</span>
		<span class="cap">
			Token Count:
			<span class="val">
				<span class="v raw-v">6</span>
				<span class="v exp-v">22</span>
			</span>
		</span>
	</div>

	<div class="item">
		<div class="item-head">
			<span class="role-chip">System</span>
			<span class="name">Character brief</span>
		</div>
		<div class="item-body">
			<span class="line raw-line">You are <span class="macro">{'{{char}}'}</span>.</span>
			<span class="line exp-line"
				>You are <span class="resolved">Seraphina, a half-elf archivist guarding the drowned library</span>.</span
			>
		</div>
	</div>

	<!-- Fixed in both states: kills the "Raw means my macros won't resolve" misread.
	     The toggle only changes the count; resolution always happens at send time. -->
	<div class="note">
		<Icon name="check" class="w-3 h-3" strokeWidth={2.25} />
		<span>Always sent with macros resolved. This only changes the count.</span>
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

	/* ── Header: the real toggle button, animated ──────────────────────── */
	.head {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		animation: btn-flip var(--dur) ease-in-out infinite;
	}
	.blabel {
		position: relative;
		width: 4.1rem;
		height: 0.95rem;
	}
	.bl {
		position: absolute;
		left: 0;
		top: 0;
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.raw-bl {
		animation-name: raw-fade;
	}
	.exp-bl {
		animation-name: exp-fade;
	}

	.cap {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}
	.val {
		position: relative;
		display: inline-block;
		min-width: 3.6rem;
		height: 0.95rem;
	}
	.v {
		position: absolute;
		left: 0;
		top: 0;
		line-height: 0.95rem;
		font-family: var(--font-mono, monospace);
		font-size: 0.7rem;
		white-space: nowrap;
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.raw-v {
		color: var(--color-text-secondary);
		animation-name: raw-fade;
	}
	.exp-v {
		color: var(--color-accent);
		animation-name: exp-fade;
	}

	/* ── The prompt item whose size we're measuring ────────────────────── */
	.item {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);
		overflow: hidden;
	}
	.item-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.55rem 0.3rem;
	}
	.role-chip {
		font-family: var(--font-ui);
		font-weight: 700;
		font-size: 0.6rem;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-sm);
		color: var(--sys);
		background: color-mix(in srgb, var(--sys) 20%, transparent);
	}
	.name {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		color: var(--color-text-primary);
	}
	.item-body {
		position: relative;
		margin: 0 0.55rem 0.5rem;
		height: 1.25rem;
		overflow: hidden;
		animation: body-grow var(--dur) ease-in-out infinite;
	}
	.line {
		position: absolute;
		inset: 0;
		font-family: var(--font-mono, monospace);
		font-size: 0.72rem;
		line-height: 1.55;
		color: var(--color-text-secondary);
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}
	.raw-line {
		animation-name: raw-fade;
	}
	.exp-line {
		animation-name: exp-fade;
	}
	/* The macro placeholder and the value it stands for share the accent, so the
	   eye connects "this token" -> "became this text". */
	.macro {
		font-weight: 600;
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent) 32%, transparent);
		border-radius: var(--radius-sm);
		padding: 0 0.2rem;
	}
	.resolved {
		color: color-mix(in srgb, var(--color-accent) 70%, var(--color-text-primary) 30%);
	}

	/* Constant clarifier: the send is always expanded; the toggle is estimate-only. */
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

	/* ── Timeline: Raw held 0–18% & 80–100%, flip 18–31%, Expanded 31–67% ─
	   Long holds, snappy flips. Matches the merge-roles mockup. */
	@keyframes raw-fade {
		0%, 18% { opacity: 1; }
		28%, 70% { opacity: 0; }
		80%, 100% { opacity: 1; }
	}
	@keyframes exp-fade {
		0%, 22% { opacity: 0; }
		31%, 67% { opacity: 1; }
		77%, 100% { opacity: 0; }
	}

	@keyframes btn-flip {
		0%, 18% {
			background: var(--color-bg-secondary);
			color: var(--color-text-muted);
			border-color: var(--color-border-subtle);
		}
		31%, 67% {
			background: color-mix(in srgb, var(--color-accent) 20%, transparent);
			color: var(--color-accent);
			border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
		}
		80%, 100% {
			background: var(--color-bg-secondary);
			color: var(--color-text-muted);
			border-color: var(--color-border-subtle);
		}
	}

	@keyframes body-grow {
		0%, 18% { height: 1.25rem; }
		31%, 67% { height: 2.6rem; }
		80%, 100% { height: 1.25rem; }
	}

	/* No motion: settle on Expanded so the payoff (macros resolved) still reads. */
	@media (prefers-reduced-motion: reduce) {
		.btn,
		.bl,
		.v,
		.item-body,
		.line {
			animation: none;
		}
		.btn {
			background: color-mix(in srgb, var(--color-accent) 20%, transparent);
			color: var(--color-accent);
			border-color: color-mix(in srgb, var(--color-accent) 30%, transparent);
		}
		.raw-bl,
		.raw-v,
		.raw-line { opacity: 0; }
		.exp-bl,
		.exp-v,
		.exp-line { opacity: 1; }
		.item-body { height: 2.6rem; }
	}
</style>
