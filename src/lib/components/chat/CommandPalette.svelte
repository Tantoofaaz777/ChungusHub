<script lang="ts">
	/**
	 * The list "/" turns the composer into: what can be run, what each one does, and which
	 * one Enter would reach.
	 *
	 * A presentation surface and nothing else. It holds no mode state and resolves no gate:
	 * the composer owns both, because both are about the box being typed into. What lands
	 * here is what a list has to get right on its own, which is the keyboard highlight
	 * staying in view as it moves.
	 *
	 * See architecture/chat-sessions.md for the mode itself.
	 */
	import Icon from '#lib/components/ui/Icon.svelte';
	import type { CommandDef } from '#lib/commands/registry.ts';

	interface Props {
		/** Rows in display order, already ranked and grouped by the composer. A group with a
		 *  blank label draws no heading, which is the ranked (typed-into) case. */
		groups: { id: string; label: string; commands: CommandDef[] }[];
		/** The row Enter would reach. */
		active: CommandDef | null;
		/** Why a command cannot run right now, or null. Asked per row, so a gate that changes
		 *  while the palette is open is reflected without the list being rebuilt. */
		refusalFor: (command: CommandDef) => string | null;
		onPick: (command: CommandDef) => void;
	}

	let { groups, active, refusalFor, onPick }: Props = $props();

	let listElement = $state<HTMLDivElement | null>(null);

	// The highlight can move to a row below the fold (arrowing down a long list, or a rank
	// that puts the best match under several worse ones), and a selection nobody can see is
	// the same as no selection at all.
	$effect(() => {
		void active;
		listElement?.querySelector('[data-command-active]')?.scrollIntoView({ block: 'nearest' });
	});
</script>

<div class="command-palette surface-float" bind:this={listElement}>
	{#each groups as group (group.id)}
		{#if group.label}
			<div class="command-group">{group.label}</div>
		{/if}
		{#each group.commands as command (command.name)}
			{@const refused = refusalFor(command)}
			{@const isActive = command === active}
			<button
				type="button"
				class="command-row"
				class:command-row--active={isActive}
				data-command-active={isActive ? '' : undefined}
				disabled={refused !== null}
				onmousedown={(e) => {
					// Keep the caret in the box: a blur here closes the palette before the click
					// would ever land.
					e.preventDefault();
					onPick(command);
				}}
			>
				<Icon name={command.icon} class="w-4 h-4" />
				<span class="command-name">
					/{command.name}{#if command.arg}<span class="command-arg">&nbsp;{command.arg.label}</span
						>{/if}
				</span>
				<span class="command-describe" class:command-describe--warn={refused !== null}>
					{refused ?? command.describe}
				</span>
			</button>
		{/each}
	{/each}
</div>

<style>
	/* Anchored to the top of the composer shell, which is the positioned ancestor. It grows
	   upward into the transcript rather than pushing the box down, so the line being typed
	   never moves under the caret. */
	.command-palette {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 0;
		right: 0;
		z-index: 20;
		max-height: 17rem;
		overflow-y: auto;
		padding: 0.25rem 0;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	.command-group {
		padding: 0.35rem 0.75rem 0.2rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}

	/* The composer menu's row recipe, spelled here because a scoped style cannot reach into
	   another component's. Kept in step with `.composer-menu-item` in InputArea.svelte: these
	   two lists sit one above the other over the same box. */
	.command-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 0;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.command-row:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.command-row:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* The keyboard highlight is the same background hover draws, so arrowing down the list
	   and running the pointer down it look like one gesture rather than two states. */
	.command-row--active:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.command-name {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--color-text-primary);
	}

	.command-row:disabled .command-name {
		color: inherit;
	}

	.command-arg {
		color: var(--color-accent);
	}

	/* One line, clipped: a description that wrapped would give the rows different heights and
	   the list would stop being scannable by shape. */
	.command-describe {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: right;
		font-size: 0.73rem;
		color: var(--color-text-muted);
	}

	.command-describe--warn {
		color: var(--color-warning);
	}
</style>
