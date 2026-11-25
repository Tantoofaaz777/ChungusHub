<script lang="ts">
	import Button from '#lib/components/ui/Button.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import type { IconName } from '#lib/components/ui/Icon.svelte';
	import type { NewChatChoices, NewChatStep } from '#lib/utils/new-chat-setup.ts';

	interface Props {
		steps: NewChatStep[];
		initialChoices: NewChatChoices;
		busy: boolean;
		onClose: () => void;
		onStart: (choices: NewChatChoices) => void;
	}

	let { steps, initialChoices, busy, onClose, onStart }: Props = $props();
	let selected = $state<NewChatChoices>({});
	let index = $state(0);
	let step = $derived(steps[index]);
	let lastStep = $derived(index === steps.length - 1);
	const icons: Record<NewChatStep['key'], IconName> = {
		presetId: 'sliders',
		characterVersionId: 'document',
		personaVersionId: 'user'
	};

	function advance() {
		if (busy || !selected[step.key]) return;
		if (lastStep) onStart({ ...initialChoices, ...selected });
		else index++;
	}
</script>

<Dialog
	open
	onClose={() => { if (!busy) onClose(); }}
	title={step.title}
	titleIcon={icons[step.key]}
	titleAlign="left"
	size="sm"
	placement="center"
>
	<fieldset class="m-0 flex max-h-[min(40dvh,18rem)] flex-col gap-2 overflow-y-auto border-0 p-1" disabled={busy}>
		<legend class="sr-only">{step.title}</legend>
		{#each step.options as option (option.id)}
			<label class="flex cursor-pointer items-center gap-3 rounded-md border border-border-subtle px-3 py-2.5 text-sm text-text-primary hover:bg-bg-tertiary has-checked:border-accent">
				<input
					type="radio"
					name={step.key}
					value={option.id}
					checked={selected[step.key] === option.id}
					onchange={() => (selected[step.key] = option.id)}
					class="accent-accent"
				/>
				<span class="min-w-0 break-words">{option.name}</span>
			</label>
		{/each}
	</fieldset>
	<div class="mt-4 flex justify-end gap-2">
		{#if index > 0}
			<Button variant="ghost" disabled={busy} onclick={() => index--}>Back</Button>
		{/if}
		<Button disabled={busy || !selected[step.key]} onclick={advance}>{lastStep ? 'Start' : 'Next'}</Button>
	</div>
</Dialog>
