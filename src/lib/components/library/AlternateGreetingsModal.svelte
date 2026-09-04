<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import ExpandableTextarea from '$lib/components/ui/ExpandableTextarea.svelte';
	import { deleteGuard } from '$lib/stores/delete-guard.svelte';

	interface Props {
		open: boolean;
		/** The alternate greetings (excludes the primary First Message). */
		greetings: string[];
		/** The primary First Message, shown for reference and as the swap target. */
		firstMessage: string;
		onChange: (greetings: string[]) => void;
		/** Swap greeting at index with the primary First Message. */
		onMakeFirst: (index: number) => void;
		onClose: () => void;
	}

	let { open, greetings, firstMessage, onChange, onMakeFirst, onClose }: Props = $props();

	function updateGreeting(index: number, value: string) {
		const next = [...greetings];
		next[index] = value;
		onChange(next);
	}

	// The armed-press rung of the destructive-act ladder (architecture/ui-shell-settings.md):
	// a greeting is real authored work saved through the editor's autosave, so its X asks by
	// arming red on the first press and deleting on the second, the same gesture as the
	// character version menu. Arming a different row moves the arm; closing resets it.
	let armedIndex = $state<number | null>(null);
	$effect(() => {
		if (!open) armedIndex = null;
	});

	function removeGreeting(index: number) {
		// The arm is this surface's whole asking, so a rung with no asking left skips it.
		if (deleteGuard.asks && armedIndex !== index) {
			armedIndex = index;
			return;
		}
		armedIndex = null;
		onChange(greetings.filter((_, i) => i !== index));
	}

	function addGreeting() {
		onChange([...greetings, '']);
	}

	function preview(text: string): string {
		const t = text.trim().replace(/\s+/g, ' ');
		return t ? (t.length > 90 ? `${t.slice(0, 90)}…` : t) : 'Empty';
	}
</script>

<Dialog {open} {onClose} title="Alternate greetings" size="xl">
	<div class="space-y-4">
		<!-- Primary First Message, for reference -->
		<div class="rounded-[var(--radius-lg)] border border-border-subtle bg-bg-secondary/40 px-3 py-2.5">
			<div class="flex items-center gap-1.5 mb-1">
				<Icon name="user" class="w-3.5 h-3.5 text-accent" />
				<span class="text-xs font-ui font-semibold uppercase tracking-wide text-accent">First Message</span>
				<span class="text-[10px] font-ui px-1.5 py-0.5 rounded-full bg-accent/15 text-accent">Primary</span>
			</div>
			<p class="text-sm font-ui text-text-secondary truncate">{preview(firstMessage)}</p>
		</div>

		<!-- Alternates -->
		<div class="space-y-3">
			{#each greetings as greeting, i (i)}
				<div class="rounded-[var(--radius-lg)] border border-border-subtle bg-bg-secondary/40">
					<div class="flex items-center gap-2 px-3 pt-2.5 pb-1">
						<span class="flex-1 text-sm font-ui font-medium text-text-primary">Greeting {i + 1}</span>
						<button
							type="button"
							class="inline-flex items-center gap-1 px-2 py-1 text-xs font-ui rounded-[var(--radius-md)] text-text-muted hover:text-accent hover:bg-accent/10 transition-colors"
							onclick={() => onMakeFirst(i)}
							title="Swap this greeting with the primary First Message"
						>
							<Icon name="arrowLeft" class="w-3.5 h-3.5" />
							Make first message
						</button>
						<button
							type="button"
							class="icon-btn !w-7 !h-7 !rounded-[var(--radius-sm)] hover:text-error hover:bg-error/10 {armedIndex === i ? '!text-error !bg-error/10' : ''}"
							onclick={() => removeGreeting(i)}
							aria-label={armedIndex === i ? 'Press again to delete' : 'Delete greeting'}
							title={armedIndex === i ? 'Press again to delete' : 'Delete greeting'}
						>
							<Icon name="close" class="w-4 h-4" />
						</button>
					</div>
					<div class="px-3 pb-3 pt-1">
						<ExpandableTextarea
							value={greeting}
							onValueChange={(value) => updateGreeting(i, value)}
							dialogTitle={`Greeting ${i + 1}`}
							expandLabel={`Expand greeting ${i + 1}`}
							placeholder="An alternate opening message…"
							maxHeight={260}
							class="input-base w-full px-3 py-2 text-text-primary font-ui text-sm placeholder:text-text-muted resize-none min-h-[4rem]"
							expandedClass="font-ui text-sm text-text-primary placeholder:text-text-muted"
						/>
					</div>
				</div>
			{/each}

			{#if greetings.length === 0}
				<div class="text-center py-8 border border-dashed border-border rounded-[var(--radius-lg)]">
					<Icon name="chat" class="w-8 h-8 mx-auto mb-2 text-text-muted" />
					<p class="text-sm font-ui text-text-secondary">No alternate greetings yet</p>
					<p class="text-xs font-ui text-text-muted mt-1 opacity-70">
						Add a few opening variants to swipe between in chat.
					</p>
				</div>
			{/if}
		</div>

		<div class="flex items-center justify-between pt-1">
			<Button variant="ghost" size="sm" class="!border !border-dashed !border-border" onclick={addGreeting}>
				<Icon name="plus" class="w-4 h-4" />
				Add greeting
			</Button>
			<Button variant="primary" size="sm" onclick={onClose}>Done</Button>
		</div>
	</div>
</Dialog>
