<!--
  IpAllowlistMockup: animated story for the Device Access (IP allowlist) card.

  One loop, three beats:
    1. A phone that isn't approved opens the app, lands on the denied page
       (its address on screen), and that same address pops into the panel's
       "Waiting" list. No typing anywhere.
    2. Allow gets pressed.
    3. The phone flips to Connected and the address settles under "Allowed",
       next to the ever-present "This computer" row.

  Pure CSS animation; it exists only while the tip is open.
-->
<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
</script>

<div class="demo" aria-hidden="true">
	<div class="stage">
		<!-- The knocking phone -->
		<div class="phone">
			<span class="notch"></span>
			<div class="scr denied">
				<span class="scr-dot"></span>
				<span class="scr-title">Not allowed</span>
				<span class="scr-ip">192.168.1.23</span>
				<span class="scr-hint">asking to join…</span>
			</div>
			<div class="scr ok">
				<span class="scr-check"><Icon name="check" class="w-3.5 h-3.5" strokeWidth={2.5} /></span>
				<span class="scr-title">Connected</span>
			</div>
		</div>

		<!-- The knock travelling to this computer -->
		<div class="signal">
			<span class="dot d1"></span>
			<span class="dot d2"></span>
			<span class="dot d3"></span>
		</div>

		<!-- The Device Access card on this computer -->
		<div class="panel">
			<div class="panel-title">
				<Icon name="shield" class="w-3 h-3" strokeWidth={2} />
				<span>Device Access</span>
			</div>

			<span class="zone-label">Waiting</span>
			<div class="zone wait-zone">
				<span class="none-line">no one waiting</span>
				<div class="wait-row">
					<span class="pulse"></span>
					<span class="row-ip">192.168.1.23</span>
					<span class="allow">Allow</span>
				</div>
			</div>

			<span class="zone-label">Allowed</span>
			<div class="row host-row">
				<span class="host-dot"></span>
				<span class="row-txt">This computer</span>
				<span class="row-tag">always</span>
			</div>
			<div class="zone ok-zone">
				<div class="ok-row">
					<span class="ok-check"><Icon name="check" class="w-3 h-3" strokeWidth={2.5} /></span>
					<span class="row-ip">192.168.1.23</span>
				</div>
			</div>
		</div>
	</div>

	<div class="note">
		<Icon name="check" class="w-3 h-3" strokeWidth={2.25} />
		<span>This computer is always allowed, so you can never lock yourself out.</span>
	</div>
</div>

<style>
	.demo {
		--dur: 9s;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.65rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-bg-secondary) 55%, transparent);
		border: 1px solid var(--color-border-subtle);
	}

	.stage {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	/* ── The phone ──────────────────────────────────────────────────────── */
	.phone {
		position: relative;
		flex-shrink: 0;
		width: 5.4rem;
		height: 7.6rem;
		border-radius: 0.85rem;
		border: 1px solid var(--color-border);
		background: var(--color-bg-primary);
		overflow: hidden;
	}

	.notch {
		position: absolute;
		top: 0.32rem;
		left: 50%;
		transform: translateX(-50%);
		width: 1.5rem;
		height: 0.22rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-text-muted) 35%, transparent);
	}

	.scr {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.4rem;
		text-align: center;
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}

	.scr.denied {
		animation-name: denied-fade;
	}

	.scr.ok {
		animation-name: ok-fade;
	}

	.scr-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 999px;
		background: var(--color-error);
	}

	.scr-check {
		display: grid;
		place-items: center;
		width: 1.15rem;
		height: 1.15rem;
		border-radius: 999px;
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 16%, transparent);
	}

	.scr-title {
		font-family: var(--font-ui);
		font-size: 0.6rem;
		font-weight: 650;
		color: var(--color-text-primary);
	}

	.scr-ip {
		font-family: var(--font-mono, monospace);
		font-size: 0.56rem;
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-sm);
		padding: 0.08rem 0.28rem;
	}

	.scr-hint {
		font-family: var(--font-ui);
		font-size: 0.52rem;
		color: var(--color-text-muted);
	}

	/* ── The knock signal ───────────────────────────────────────────────── */
	.signal {
		flex-shrink: 0;
		display: flex;
		gap: 0.22rem;
		animation: signal-window var(--dur) ease-in-out infinite;
	}

	.dot {
		width: 0.28rem;
		height: 0.28rem;
		border-radius: 999px;
		background: var(--color-accent);
		opacity: 0.25;
		animation: knock-travel 1.4s ease-in-out infinite;
	}

	.d2 {
		animation-delay: 0.2s;
	}

	.d3 {
		animation-delay: 0.4s;
	}

	/* ── The settings card ──────────────────────────────────────────────── */
	.panel {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.28rem;
		padding: 0.5rem 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 80%, transparent);
	}

	.panel-title {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-ui);
		font-size: 0.62rem;
		font-weight: 650;
		color: var(--color-text-primary);
	}

	.panel-title :global(svg) {
		color: var(--color-accent);
	}

	.zone-label {
		font-family: var(--font-ui);
		font-size: 0.5rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	/* Fixed-height slots so the card never jumps while rows fade in and out. */
	.zone {
		position: relative;
		height: 1.35rem;
	}

	.none-line,
	.wait-row,
	.ok-row {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		animation-duration: var(--dur);
		animation-timing-function: ease-in-out;
		animation-iteration-count: infinite;
	}

	.none-line {
		font-family: var(--font-ui);
		font-size: 0.56rem;
		color: var(--color-text-muted);
		animation-name: none-fade;
	}

	.wait-row {
		gap: 0.32rem;
		padding: 0 0.35rem;
		border-radius: var(--radius-sm);
		border: 1px solid color-mix(in srgb, var(--color-accent) 26%, transparent);
		background: color-mix(in srgb, var(--color-accent) 9%, transparent);
		animation-name: wait-fade;
	}

	.pulse {
		position: relative;
		flex-shrink: 0;
		width: 0.32rem;
		height: 0.32rem;
		border-radius: 999px;
		background: var(--color-accent);
	}

	.pulse::after {
		content: '';
		position: absolute;
		inset: -3px;
		border-radius: 999px;
		border: 1px solid var(--color-accent);
		animation: pulse-ring 1.6s ease-out infinite;
	}

	.row-ip {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono, monospace);
		font-size: 0.56rem;
		color: var(--color-text-primary);
	}

	.allow {
		flex-shrink: 0;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-family: var(--font-ui);
		font-size: 0.54rem;
		font-weight: 700;
		animation: allow-press var(--dur) ease-in-out infinite;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.32rem;
	}

	.host-dot {
		flex-shrink: 0;
		width: 0.32rem;
		height: 0.32rem;
		border-radius: 999px;
		background: var(--color-success);
	}

	.row-txt {
		flex: 1;
		min-width: 0;
		font-family: var(--font-ui);
		font-size: 0.56rem;
		color: var(--color-text-secondary);
	}

	.row-tag {
		font-family: var(--font-ui);
		font-size: 0.5rem;
		color: var(--color-text-muted);
	}

	.ok-zone {
		height: 1.1rem;
	}

	.ok-row {
		gap: 0.32rem;
		animation-name: ok-row-fade;
	}

	.ok-check {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		color: var(--color-success);
	}

	/* ── Constant clarifier ─────────────────────────────────────────────── */
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

	/* ── Timeline: knock lands ~8%, Allow pressed ~46%, connected 58–88%,
	     reset by 100%. Long holds, snappy transitions. ──────────────────── */
	@keyframes denied-fade {
		0%, 52% { opacity: 1; }
		58%, 90% { opacity: 0; }
		97%, 100% { opacity: 1; }
	}

	@keyframes ok-fade {
		0%, 54% { opacity: 0; }
		60%, 88% { opacity: 1; }
		96%, 100% { opacity: 0; }
	}

	@keyframes wait-fade {
		0%, 5% { opacity: 0; transform: translateY(4px); }
		10%, 50% { opacity: 1; transform: translateY(0); }
		56%, 100% { opacity: 0; transform: translateY(-3px); }
	}

	@keyframes none-fade {
		0%, 4% { opacity: 1; }
		8%, 56% { opacity: 0; }
		62%, 100% { opacity: 1; }
	}

	@keyframes ok-row-fade {
		0%, 56% { opacity: 0; transform: translateY(4px); }
		62%, 88% { opacity: 1; transform: translateY(0); }
		94%, 100% { opacity: 0; transform: translateY(0); }
	}

	@keyframes allow-press {
		0%, 44% { transform: scale(1); }
		46%, 48% { transform: scale(0.9); }
		50%, 100% { transform: scale(1); }
	}

	@keyframes signal-window {
		0%, 50% { opacity: 1; }
		54%, 96% { opacity: 0; }
		100% { opacity: 1; }
	}

	@keyframes knock-travel {
		0% { opacity: 0.15; transform: translateX(-2px); }
		45% { opacity: 0.9; }
		100% { opacity: 0.15; transform: translateX(2px); }
	}

	@keyframes pulse-ring {
		0% { transform: scale(0.55); opacity: 0.8; }
		70%, 100% { transform: scale(1.5); opacity: 0; }
	}

	/* No motion: settle on the payoff (phone connected, address allowed). */
	@media (prefers-reduced-motion: reduce) {
		.scr,
		.signal,
		.dot,
		.none-line,
		.wait-row,
		.ok-row,
		.allow,
		.pulse::after {
			animation: none;
		}

		.scr.denied,
		.signal,
		.wait-row { opacity: 0; }

		.scr.ok,
		.none-line,
		.ok-row { opacity: 1; transform: none; }
	}
</style>
