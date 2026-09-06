<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { openWelcomeDialog } from '$lib/components/layout/WelcomeDialog.svelte';
</script>

<!-- Reached only while `advancedSettingsStore.developerMode` is on, which the About page's
     version turns on and off. Everything here is a workbench control: nothing a reader needs
     for ordinary use belongs on this page. -->
<div class="dev">
	<!-- The greeting has no trigger left once a persona exists, so this workbench control
	     opens it on the spot. -->
	<section class="card">
		<div class="card-head">
			<span class="card-title">Notices</span>
		</div>
		<div class="card-body">
			<div class="notice">
				<span class="notice-label">First-run greeting</span>
				<p class="hint">The greeting a new reader meets, as they meet it.</p>
				<button type="button" class="open-btn" onclick={openWelcomeDialog}>
					<Icon name="sparkles" class="w-3.5 h-3.5" strokeWidth={1.75} />
					Open the greeting
				</button>
			</div>
		</div>
	</section>
</div>

<style>
	.dev {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.notice-label {
		display: block;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.hint {
		margin: 0.2rem 0 0.7rem;
		font-family: var(--font-ui);
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--color-text-muted);
	}

	.open-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 0.8rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-weight: 600;
		font-size: 0.8rem;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.open-btn:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
	}
</style>
