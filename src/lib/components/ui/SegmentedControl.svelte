<script lang="ts" generics="Choice extends string">
	interface Props {
		options: readonly { value: Choice; label: string }[];
		current: Choice;
		label: string;
		compact?: boolean;
	}

	let { options, current = $bindable(), label, compact = false }: Props = $props();
	const name = $props.id();
</script>

<fieldset class="segments" class:compact aria-label={label}>
	{#each options as option (option.value)}
		<label>
			<input class="sr-only" type="radio" {name} value={option.value} bind:group={current} />
			<span>{option.label}</span>
		</label>
	{/each}
</fieldset>

<style>
	.segments {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		gap: 2px;
		min-inline-size: 0;
		max-inline-size: 100%;
		padding: 2px;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: var(--color-bg-tertiary);
	}
	.segments span {
		display: grid;
		place-items: center;
		min-height: 1.75rem;
		padding-inline: 0.6rem;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font: 600 0.74rem/1.1 var(--font-ui);
		white-space: nowrap;
		cursor: pointer;
	}
	.compact span { padding-inline: 0; font-size: 0.66rem; }
	.segments label:hover span { color: var(--color-text-primary); }
	.segments input:checked + span {
		background: color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-tertiary));
		border-color: color-mix(in srgb, var(--color-accent) 32%, transparent);
		color: var(--color-accent);
	}
	.segments input:focus-visible + span {
		outline: 2px solid var(--color-accent);
		outline-offset: -2px;
	}
</style>
