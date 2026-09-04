<script lang="ts">
	/**
	 * Make the share pictures, page through them, then take the one you want.
	 *
	 * The preview IS the picture: the same canvas that gets encoded, shown scaled down. That
	 * is what makes the name switch safe to default to ON. A hidden toggle deciding whether
	 * real names leave the machine would be a trap; a switch sitting under a picture that
	 * visibly changes when you flip it is a decision the reader actually makes. The switch
	 * appears on the one card that draws names, because a control that does nothing where it
	 * sits is worse than one that comes and goes.
	 *
	 * The pager is a row of named chips rather than dots: the deck holds up to four cards
	 * and which is which should be readable before it is clicked, not after.
	 *
	 * One canvas, redrawn per card, rather than four kept in memory: a card is cheap to draw
	 * and what gets saved is always the card being looked at.
	 */
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { imageService } from '$lib/services/imageService';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { triggerDownload, sanitizeFilename } from '$lib/services/libraryExport';
	import { drawPoster, posterCards, POSTER_WIDTH, POSTER_HEIGHT, type PosterCardId } from '$lib/stats/poster';
	import type { StatsSnapshot } from '$lib/stores/stats.svelte';
	import { storyRoleName } from '$lib/types/library';

	let { open = $bindable(), snapshot }: { open: boolean; snapshot: StatsSnapshot | null } = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let anonymous = $state(false);
	let drawing = $state(false);
	let error = $state<string | null>(null);
	let index = $state(0);

	// The dialog stays mounted and answers to one derived open state, never to an `{#if}`
	// in its caller: a body-portaled overlay whose node moves on its own lifetime detaches
	// once and never comes back (architecture/ui-shell-settings.md).
	let showing = $derived(open && snapshot !== null);

	/** The cast the pictures can draw, with the names they will print: the first five the
	 *  library can still put a name to, walked in ranking order so a deleted character
	 *  ahead of a kept one costs a slot to nobody. */
	let castNames = $derived.by(() => {
		const names: Record<string, string> = {};
		let found = 0;
		for (const member of snapshot?.stats.cast ?? []) {
			if (found >= 5) break;
			const entry = characterLibraryStore.characters.find((c) => c.id === member.characterId);
			if (!entry) continue;
			names[member.characterId] = storyRoleName(entry.identity);
			found += 1;
		}
		return names;
	});

	let cards = $derived(snapshot ? posterCards(snapshot, castNames) : []);
	let current = $derived(cards[index] ?? cards[0] ?? null);
	/** The name switch is only offered where names are actually drawn. */
	let showsNames = $derived(current?.id === 'cast');

	// A fresh count can leave the deck shorter than the page being read.
	$effect(() => {
		if (index >= cards.length) index = 0;
	});

	/** Portraits are same-origin, so drawing them leaves the canvas exportable. One that
	 *  fails to load is simply absent: the card falls back to an initial rather than
	 *  refusing to draw. */
	async function loadPortraits(): Promise<Record<string, HTMLImageElement>> {
		const out: Record<string, HTMLImageElement> = {};
		const wanted = (snapshot?.stats.cast ?? []).filter((m) => castNames[m.characterId]).slice(0, 5);
		await Promise.all(
			wanted.map(async (member) => {
				const entry = characterLibraryStore.characters.find((c) => c.id === member.characterId);
				const path = entry?.identity.imageUrl;
				if (!path) return;
				const url = await imageService.getImageUrl(path);
				if (!url) return;
				await new Promise<void>((resolve) => {
					const img = new Image();
					img.onload = () => {
						out[member.characterId] = img;
						resolve();
					};
					img.onerror = () => resolve();
					img.src = url;
				});
			})
		);
		return out;
	}

	async function render(taken: StatsSnapshot, card: PosterCardId, hideNames: boolean): Promise<void> {
		if (!canvas) return;
		drawing = true;
		error = null;
		try {
			const portraits = await loadPortraits();
			await drawPoster(canvas, taken, { anonymous: hideNames, portraits, names: castNames }, card);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			drawing = false;
		}
	}

	// Redraw whenever the dialog opens, the page turns or the name switch moves: the preview
	// must never be a picture of the settings as they were.
	$effect(() => {
		const taken = snapshot;
		const card = current?.id;
		const hideNames = anonymous;
		if (!showing || !canvas || !taken || !card) return;
		void render(taken, card, hideNames);
	});

	function toBlob(): Promise<Blob> {
		return new Promise((resolve, reject) => {
			canvas?.toBlob((blob) => {
				if (blob) resolve(blob);
				else reject(new Error('Could not encode the picture'));
			}, 'image/png');
		});
	}

	async function save(): Promise<void> {
		try {
			const stamp = new Date(snapshot?.takenAt ?? Date.now()).toISOString().slice(0, 10);
			const name = sanitizeFilename(`ChungusHub ${current?.label ?? 'stats'} ${stamp}`);
			triggerDownload(`${name}.png`, await toBlob());
		} catch (e) {
			toastStore.failed('save the picture', e);
		}
	}

	async function copy(): Promise<void> {
		try {
			const blob = await toBlob();
			// Clipboard images need a secure context and a browser that takes them. Failing
			// loud here is right: silently doing nothing would read as a broken button.
			if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
				throw new Error('This browser cannot copy images. Save it instead.');
			}
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			toastStore.success('Picture copied');
		} catch (e) {
			toastStore.failed('copy the picture', e);
		}
	}
</script>

<Dialog open={showing} onClose={() => (open = false)} title="Make a picture" size="md">
	<div class="poster-body">
		{#if error}
			<Alert message="Could not draw the picture. {error}" />
		{/if}

		{#if cards.length > 1}
			<div class="chips" role="tablist" aria-label="Pick a picture">
				{#each cards as card, i (card.id)}
					<button
						type="button"
						class="chip"
						class:is-current={i === index}
						role="tab"
						aria-selected={i === index}
						onclick={() => (index = i)}
					>
						{card.label}
					</button>
				{/each}
			</div>
		{/if}

		<div class="frame" class:is-drawing={drawing}>
			<canvas
				bind:this={canvas}
				width={POSTER_WIDTH}
				height={POSTER_HEIGHT}
				aria-label="{current?.label ?? 'Your stats'} as a picture"
			></canvas>
		</div>

		{#if showsNames}
			<label class="switch">
				<Toggle checked={!anonymous} onchange={(next) => (anonymous = !next)} label="Show character names" />
				<span class="switch-text">
					<span class="switch-title">Show character names</span>
					<span class="switch-note">
						Off replaces every name with a placeholder. Portraits go with them.
					</span>
				</span>
			</label>
		{/if}

		<div class="actions">
			<Button variant="secondary" onclick={copy} disabled={drawing}>Copy</Button>
			<Button variant="primary" onclick={save} disabled={drawing}>Save as PNG</Button>
		</div>
	</div>
</Dialog>

<style>
	.poster-body {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	.chips {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		padding: 0.32rem 0.75rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-full);
		background: transparent;
		font-family: var(--font-ui);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
	}

	.chip:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border);
	}

	.chip.is-current {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: var(--color-on-accent);
	}

	/* The canvas is 1080 by 1920 and the dialog is neither, so it is scaled by CSS alone and
	   sized by its HEIGHT: a portrait picture fitted to the width would run off the screen.
	   What gets encoded is always the full-size drawing, never what is on screen. */
	.frame {
		align-self: center;
		border-radius: var(--radius-lg);
		overflow: hidden;
		border: 1px solid var(--theme-border-raised, var(--color-border-subtle));
		box-shadow: var(--shadow-md);
		transition: opacity 140ms ease;
	}

	.frame.is-drawing {
		opacity: 0.55;
	}

	.frame canvas {
		display: block;
		height: min(52vh, 560px);
		width: auto;
		max-width: 100%;
	}

	.switch {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		cursor: pointer;
	}

	.switch-text {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.switch-title {
		font-family: var(--font-ui);
		font-size: 0.85rem;
		color: var(--color-text-primary);
	}

	.switch-note {
		font-family: var(--font-ui);
		font-size: 0.72rem;
		line-height: 1.45;
		color: var(--color-text-muted);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
