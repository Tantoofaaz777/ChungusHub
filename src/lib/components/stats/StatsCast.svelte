<script lang="ts">
	/**
	 * Who the reader has actually been writing with, ranked, with their faces.
	 *
	 * The faces are the point. Every other figure on this screen is a number about the
	 * reader; this row is the only part that shows what they made, which is why it carries
	 * portraits at a size worth looking at rather than a list of names with counts.
	 *
	 * A character the aggregate counted but the library no longer holds is **dropped, not
	 * drawn as a blank**: the count is real (those chats still exist) but with nothing to
	 * name or picture it, a row would be an unlabelled bar the reader cannot act on. The
	 * caller states the total separately, so nothing goes missing silently.
	 */
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { imageService } from '$lib/services/imageService';
	import { portraitFocusAim } from '$lib/utils/portrait-focus';
	import { count, plural, monthYearLabel } from '$lib/stats/format';
	import type { StatsCastMember } from '$lib/types/stats';
	import { storyRoleName } from '$lib/types/library';

	let { cast, limit = 6, anonymous = false }: { cast: StatsCastMember[]; limit?: number; anonymous?: boolean } =
		$props();

	let rows = $derived.by(() =>
		cast
			.map((member) => ({
				member,
				entry: characterLibraryStore.characters.find((c) => c.id === member.characterId) ?? null
			}))
			.filter((row) => row.entry !== null)
			.slice(0, limit)
	);

	let top = $derived(rows[0]?.member.messages ?? 1);

	function nameFor(index: number, real: string): string {
		return anonymous ? `Character ${index + 1}` : real;
	}
</script>

<ol class="cast">
	{#each rows as row, index (row.member.characterId)}
		{@const entry = row.entry!}
		{@const name = nameFor(index, storyRoleName(entry.identity))}
		{@const portrait = imageService.imageUrl(entry.identity.imageUrl)}
		<li class="member">
			<span class="rank" aria-hidden="true">{index + 1}</span>
			<div class="face" aria-hidden="true">
				{#if portrait && !anonymous}
					<img src={portrait} alt="" style={portraitFocusAim(entry.identity.portraitFocus)} />
				{:else}
					<span class="initial">{name.trim()[0]?.toUpperCase() ?? '?'}</span>
				{/if}
			</div>

			<div class="detail">
				<div class="line">
					<span class="name">{name}</span>
					<span class="figure">{plural(row.member.messages, 'turn')}</span>
				</div>
				<div class="track" aria-hidden="true">
					<div class="fill" style="width: {Math.max(3, (row.member.messages / top) * 100)}%"></div>
				</div>
				<span class="meta">
					{plural(row.member.chats, 'chat')} · {count(row.member.words)} words · since {monthYearLabel(
						row.member.firstAt
					)}
				</span>
			</div>
		</li>
	{/each}
</ol>

<style>
	.cast {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.member {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}

	/* The rank says the order out loud: the list is sorted, but "sorted by what" is not
	   something a reader should have to infer from bar widths. */
	.rank {
		flex-shrink: 0;
		width: 1rem;
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		text-align: center;
		color: var(--color-text-muted);
	}

	.face {
		flex-shrink: 0;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: var(--radius-md);
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-bg-tertiary);
		border: 1px solid var(--theme-border-raised, var(--color-border-subtle));
	}

	.face img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.initial {
		font-family: var(--font-ui);
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.detail {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
	}

	.name {
		font-family: var(--font-ui);
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.figure {
		flex-shrink: 0;
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-secondary);
	}

	.track {
		height: 0.3rem;
		border-radius: 999px;
		background: var(--color-bg-tertiary);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		border-radius: 999px;
		background: var(--color-accent);
	}

	.meta {
		font-family: var(--font-ui);
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}
</style>
