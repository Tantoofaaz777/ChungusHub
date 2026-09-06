<script lang="ts">
	/**
	 * Settings → Appearance → Interface: everything the app draws that is not the story.
	 * The palette every surface is derived from, the accent over it, the frame's own type
	 * and surface treatment, and the picture behind the lot.
	 *
	 * Cards on one page rather than pages of two, and that is the rule: a page exists to
	 * hold a subject, not to hold a card. The story's own face and measure are the one
	 * thing NOT here, because a knob sits with the thing it dresses and the story is
	 * Chat's subject. The same rule settles the two workspace scrims: the reading column's
	 * shade sits with the column, over there, while the background image's dim sits here
	 * with the image (architecture/ui-shell-settings.md, "the two workspace scrims"), and
	 * neither offers a color to pick.
	 *
	 * Restore defaults is the one way back to the shipped look for this half of it, at the
	 * foot of the page and only there while something has actually moved.
	 */
	import InfoTip from '$lib/components/ui/InfoTip.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import ColorPicker from '$lib/components/ui/ColorPicker.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import PaletteEditor from '$lib/components/settings/PaletteEditor.svelte';
	import BackgroundPickerModal from '$lib/components/settings/BackgroundPickerModal.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { backgroundStore } from '$lib/stores/background.svelte';
	import { chatSceneStore } from '$lib/stores/chatScene.svelte';
	import { DEFAULT_BACKGROUND } from '$lib/types/background';
	import { DEFAULT_APPEARANCE } from '$lib/themes/presets';
	import { rangeReset } from '$lib/actions/rangeReset';
	import { toggleRow } from '$lib/actions/toggleRow';
	import type { ContrastLevel, GlassLevel, PaletteMode } from '$lib/types/theme';

	const CONTRAST_OPTIONS: { value: ContrastLevel; label: string }[] = [
		{ value: 'soft', label: 'Soft' },
		{ value: 'standard', label: 'Standard' },
		{ value: 'high', label: 'High' }
	];

	const GLASS_OPTIONS: { value: GlassLevel; label: string }[] = [
		{ value: 'off', label: 'Off' },
		{ value: 'subtle', label: 'Subtle' },
		{ value: 'full', label: 'Full' }
	];

	let appearance = $derived(themeStore.appearance);

	const pct = (v: number) => `${Math.round(v * 100)}%`;

	/* --- Palette --- */

	/** Which of the reader's palettes is open in the editor below, if any. */
	let editingId = $state<string | null>(null);
	/** The palette the open one was forked from, while it is still a fork nobody has left
	 *  the editor on. Cleared the moment the editor closes or moves to another palette,
	 *  which is what turns the editor's Cancel back into Delete. */
	let forkedFrom = $state<string | null>(null);

	// A palette deleted from anywhere else (another device, live sync) must not leave the
	// editor standing over nothing.
	$effect(() => {
		if (editingId && !themeStore.customPalettes.some((p) => p.id === editingId)) {
			closeEditor();
		}
	});

	function openEditor(id: string): void {
		editingId = id;
		forkedFrom = null;
	}

	function closeEditor(): void {
		editingId = null;
		forkedFrom = null;
	}

	const isCustom = (id: string) => themeStore.customPalettes.some((p) => p.id === id);

	/** The active accent as it would render on a given palette's mode. */
	function previewAccent(mode: PaletteMode): string {
		if (appearance.accent === 'custom') return appearance.customAccent;
		const accent =
			themeStore.accents.find((a) => a.id === appearance.accent) ?? themeStore.accents[0];
		return accent[mode];
	}

	function forkActivePalette() {
		const from = appearance.palette;
		editingId = themeStore.createPalette(from);
		forkedFrom = from;
	}

	/* --- Accent --- */

	// Custom accent popover: anchored to the "+" swatch, closes on outside click or Escape.
	let customOpen = $state(false);
	let customPopover = $state<HTMLDivElement | undefined>(undefined);
	let customAnchor = $state<HTMLButtonElement | undefined>(undefined);

	function toggleCustom() {
		customOpen = !customOpen;
		if (customOpen && appearance.accent !== 'custom') {
			themeStore.update({ accent: 'custom' });
		}
	}

	function handleWindowPointerDown(event: PointerEvent) {
		if (!customOpen) return;
		const target = event.target as Node;
		if (customPopover?.contains(target) || customAnchor?.contains(target)) return;
		customOpen = false;
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && customOpen) {
			// Consume the press so the workspace's global Esc doesn't also close
			// the hosting Settings panel.
			event.preventDefault();
			event.stopPropagation();
			customOpen = false;
		}
	}

	/* --- Background scope --- */

	// The background controls edit whichever scope is in force, so nothing here reads or
	// writes a second copy: flipping the switch is the whole control.
	let ownScene = $derived(chatSceneStore.active !== null);
	let canScope = $derived(chatSceneStore.canScope);
	let otherScenes = $derived(chatSceneStore.otherChatsWithScene);

	let scopeNote = $derived.by(() => {
		// The disabled pill says why here rather than only in a title: a phone never
		// hovers, so a tooltip is the one explanation it would never see.
		if (!canScope) return 'Open a chat to give it a background of its own.';
		if (ownScene) return 'This background belongs to this chat alone.';
		if (otherScenes === 0) return 'Every chat uses this background.';
		const others =
			otherScenes === 1
				? 'one with a background of its own'
				: `${otherScenes} with backgrounds of their own`;
		return `Every chat uses this background, except ${others}.`;
	});

	/* --- Background --- */

	let background = $derived(backgroundStore.config);
	let backgroundUrl = $derived(backgroundStore.url);
	let backgroundPickerOpen = $state(false);

	/* --- Restore defaults --- */

	let confirmRestore = $state(false);

	function restoreDefaults(): void {
		themeStore.restoreDefaults('interface');
		confirmRestore = false;
	}

	// Display name from the stored path's filename, same derivation the server
	// uses for the picker list ("misty-forest.jpg" → "Misty Forest").
	let backgroundName = $derived.by(() => {
		const path = background.path;
		if (!path) return '';
		return path
			.slice(path.lastIndexOf('/') + 1)
			.replace(/\.[^.]+$/, '')
			.replace(/[-_]+/g, ' ')
			.trim()
			.replace(/\b\w/g, (c) => c.toUpperCase());
	});
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeydown} />

<div class="iface">
	<section class="card" data-setting="palette">
		<div class="card-head">
			<span class="card-title">Palette</span>
			<InfoTip
				text="Every color in the app is worked out from the one in force. Build your own from any of them."
			/>
		</div>

		<div class="card-body">
			<div class="palette-grid" role="radiogroup" aria-label="Base palette">
				{#each themeStore.palettes as palette (palette.id)}
					<div class="palette-slot">
						<button
							type="button"
							role="radio"
							aria-checked={appearance.palette === palette.id}
							class="palette-card"
							class:active={appearance.palette === palette.id}
							onclick={() => themeStore.update({ palette: palette.id })}
						>
							<span
								class="palette-preview"
								style="background: {palette.colors.bgPrimary}; border-color: {palette.colors.border}"
							>
								<span class="pp-bubble" style="background: {palette.colors.userBubble}"></span>
								<span class="pp-line" style="background: {palette.colors.textSecondary}"></span>
								<span class="pp-line short" style="background: {palette.colors.textMuted}"></span>
								<span class="pp-dot" style="background: {previewAccent(palette.mode)}"></span>
							</span>
							<span class="palette-name">{palette.name}</span>
						</button>
						{#if isCustom(palette.id)}
							<button
								type="button"
								class="palette-edit"
								title="Edit {palette.name}"
								aria-label="Edit {palette.name}"
								onclick={() =>
									editingId === palette.id ? closeEditor() : openEditor(palette.id)}
							>
								<Icon name="pencil" class="w-3 h-3" />
							</button>
						{/if}
					</div>
				{/each}

				<button type="button" class="palette-new" onclick={forkActivePalette}>
					<span class="palette-new-plus">+</span>
					<span class="palette-new-label">New palette</span>
					<span class="palette-new-hint">A copy of the one you are wearing, yours to edit.</span>
				</button>
			</div>

			<div class="sub-block">
				<span class="section-label">Contrast</span>
				<div class="seg-pills" role="radiogroup" aria-label="Text contrast">
					{#each CONTRAST_OPTIONS as opt (opt.value)}
						<button
							type="button"
							role="radio"
							aria-checked={appearance.contrast === opt.value}
							class="seg-pill"
							class:active={appearance.contrast === opt.value}
							class:seg-lift={appearance.contrast === opt.value}
							onclick={() => themeStore.update({ contrast: opt.value })}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>
		</div>
	</section>

	{#if editingId}
		<!-- Keyed on the palette: pointing the editor at another one is a new session, and
		     the copy it takes to discard back to has to be taken again with it. -->
		{#key editingId}
			<PaletteEditor paletteId={editingId} {forkedFrom} onclose={closeEditor} />
		{/key}
	{/if}

	<section class="card" data-setting="accent">
		<div class="card-head">
			<span class="card-title">Accent</span>
			<InfoTip text="One hue over the palette, tuned for dark and light on its own." />
		</div>

		<div class="card-body">
			<div class="accent-row" role="radiogroup" aria-label="Accent color">
				{#each themeStore.accents as accent (accent.id)}
					<button
						type="button"
						role="radio"
						aria-checked={appearance.accent === accent.id}
						class="accent-swatch"
						class:active={appearance.accent === accent.id}
						style="background: {themeStore.accentSwatch(accent)}"
						title={accent.name}
						aria-label={accent.name}
						onclick={() => themeStore.update({ accent: accent.id })}
					></button>
				{/each}
				<span class="accent-custom-wrap">
					<button
						type="button"
						bind:this={customAnchor}
						class="accent-swatch accent-custom"
						class:active={appearance.accent === 'custom'}
						style="background: {appearance.accent === 'custom'
							? appearance.customAccent
							: 'transparent'}"
						title="Custom color"
						aria-label="Custom accent color"
						aria-expanded={customOpen}
						onclick={toggleCustom}
					>
						{#if appearance.accent !== 'custom'}<span class="accent-plus">+</span>{/if}
					</button>
					{#if customOpen}
						<div class="accent-popover surface-float slide-up" bind:this={customPopover}>
							<ColorPicker
								value={appearance.customAccent}
								oninput={(hex) => themeStore.update({ accent: 'custom', customAccent: hex })}
							/>
						</div>
					{/if}
				</span>
			</div>
		</div>
	</section>

	<section class="card" data-setting="interface-type">
		<div class="card-head">
			<span class="card-title">Interface Type</span>
			<InfoTip text="Fonts other than the default download the first time you pick them." />
		</div>

		<div class="card-body">
			<div class="slider-block">
				<label for="interface-font" class="slider-label">Interface font</label>
				<Select
					id="interface-font"
					variant="compact"
					class="w-full"
					value={appearance.uiFont}
					onchange={(e) => themeStore.update({ uiFont: (e.target as HTMLSelectElement).value })}
				>
					{#each themeStore.uiFonts as font (font.id)}
						<option value={font.id}>{font.label}</option>
					{/each}
				</Select>
			</div>
		</div>
	</section>

	<section class="card" data-setting="surfaces">
		<div class="card-head">
			<span class="card-title">Surfaces</span>
			<InfoTip
				text="How every surface in the app is cut and how heavy it feels. Turn the last two down on a weaker device."
			/>
		</div>

		<div class="card-body">
			<div class="slider-block">
				<div class="slider-top">
					<div class="slider-label-wrap">
						<label for="corners" class="slider-label">Corners</label>
						<InfoTip
							text="Rounds every surface there is, the message card included. The card carries a second rounding of its own on top, under Chat."
						/>
					</div>
					<span class="slider-value">{pct(appearance.radius)}</span>
				</div>
				<input
					id="corners"
					type="range"
					class="slider"
					min="0"
					max="1.35"
					step="0.05"
					value={appearance.radius}
					oninput={(e) => themeStore.update({ radius: parseFloat(e.currentTarget.value) })}
					use:rangeReset={{
						defaultValue: DEFAULT_APPEARANCE.radius,
						apply: (v) => themeStore.update({ radius: v })
					}}
				/>
			</div>

			<div class="sub-block">
				<span class="section-label">Glass blur</span>
				<div class="seg-pills" role="radiogroup" aria-label="Glass blur">
					{#each GLASS_OPTIONS as opt (opt.value)}
						<button
							type="button"
							role="radio"
							aria-checked={appearance.glass === opt.value}
							class="seg-pill"
							class:active={appearance.glass === opt.value}
							class:seg-lift={appearance.glass === opt.value}
							onclick={() => themeStore.update({ glass: opt.value })}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="toggle-row" use:toggleRow>
				<span class="slider-label">Reduce animations</span>
				<Toggle
					checked={appearance.motion === 'reduced'}
					label="Reduce animations"
					onchange={(on) => themeStore.update({ motion: on ? 'reduced' : 'full' })}
				/>
			</div>
		</div>
	</section>

	<section class="card" data-setting="background">
		<div class="card-head">
			<span class="card-title">Background</span>
			<InfoTip text="A picture behind the whole workspace, with every panel layered on top of it." />
			{#if ownScene}<span class="scope-chip font-ui">This chat</span>{/if}
		</div>

		<div class="card-body">
			<div class="seg-pills" role="radiogroup" aria-label="Background scope">
				<button
					type="button"
					role="radio"
					aria-checked={!ownScene}
					class="seg-pill"
					class:active={!ownScene}
					class:seg-lift={!ownScene}
					onclick={() => chatSceneStore.release()}
				>
					Everywhere
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={ownScene}
					class="seg-pill"
					class:active={ownScene}
					class:seg-lift={ownScene}
					disabled={!canScope}
					title={canScope ? undefined : 'Open a chat to give it a background of its own.'}
					onclick={() => chatSceneStore.adopt(backgroundStore.config)}
				>
					This chat
				</button>
			</div>
			<p class="scope-note font-ui">{scopeNote}</p>

			<div class="bg-hero" class:bg-hero-unset={!backgroundUrl}>
				{#if backgroundUrl}
					<img class="bg-hero-img" src={backgroundUrl} alt="Current workspace background" />
					<div class="bg-hero-scrim">
						<span class="bg-hero-name">{backgroundName}</span>
						<div class="bg-hero-actions">
							<button type="button" class="bg-hero-btn" onclick={() => (backgroundPickerOpen = true)}>
								Change
							</button>
							<button
								type="button"
								class="bg-hero-btn"
								onclick={() => backgroundStore.setBackground(null)}
							>
								Remove
							</button>
						</div>
					</div>
				{:else}
					<button type="button" class="bg-hero-empty" onclick={() => (backgroundPickerOpen = true)}>
						<span class="bg-hero-empty-title font-ui">Choose a background</span>
						<span class="bg-hero-empty-hint font-ui">
							Pick one of the bundled scenes, or bring your own image.
						</span>
					</button>
				{/if}
			</div>

			{#if backgroundUrl}
				<div class="slider-block">
					<div class="slider-top">
						<div class="slider-label-wrap">
							<label for="bg-dim" class="slider-label">Dim</label>
							<InfoTip
								text="Darkens the picture itself, always plain black. The reading column's own shade is a separate control, under Chat."
							/>
						</div>
						<span class="slider-value">{pct(background.dim)}</span>
					</div>
					<input
						id="bg-dim"
						type="range"
						class="slider"
						min="0"
						max="0.9"
						step="0.01"
						value={background.dim}
						oninput={(e) => backgroundStore.setDim(parseFloat(e.currentTarget.value))}
						use:rangeReset={{
							defaultValue: DEFAULT_BACKGROUND.dim,
							apply: (v) => backgroundStore.setDim(v)
						}}
					/>
				</div>
				<div class="slider-block">
					<div class="slider-top">
						<label for="bg-blur" class="slider-label">Blur</label>
						<span class="slider-value">{Math.round(background.blur)}px</span>
					</div>
					<input
						id="bg-blur"
						type="range"
						class="slider"
						min="0"
						max="24"
						step="1"
						value={background.blur}
						oninput={(e) => backgroundStore.setBlur(parseFloat(e.currentTarget.value))}
						use:rangeReset={{
							defaultValue: DEFAULT_BACKGROUND.blur,
							apply: (v) => backgroundStore.setBlur(v)
						}}
					/>
				</div>
			{/if}
		</div>
	</section>

	{#if themeStore.isModified('interface')}
		<div class="page-reset" data-setting="interface-defaults">
			<button type="button" class="link-btn" onclick={() => (confirmRestore = true)}>
				Restore defaults
			</button>
		</div>
	{/if}
</div>

<BackgroundPickerModal open={backgroundPickerOpen} onClose={() => (backgroundPickerOpen = false)} />

<ConfirmDialog
	open={confirmRestore}
	title="Restore interface defaults"
	message="Palette, accent, interface font, corners and glass all go back to the shipped default. The background and every Chat setting are left alone. This cannot be undone."
	confirmLabel="Restore defaults"
	variant="danger"
	destructive
	onConfirm={restoreDefaults}
	onCancel={() => (confirmRestore = false)}
/>

<style>
	.iface {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	/* At the foot of the page, past everything it undoes, and out of the cards: it acts on
	   all of them at once and belongs to none. */
	.page-reset {
		display: flex;
		justify-content: flex-end;
		font-size: 0.72rem;
	}

	/* --- Palette picker --- */
	.palette-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
		gap: 0.5rem;
	}

	/* The edit button cannot nest inside the card (a button in a button), so the two are
	   siblings and the slot is what holds them together. */
	.palette-slot {
		position: relative;
		display: flex;
	}

	.palette-card {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: stretch;
		gap: 0.4rem;
		padding: 0.55rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-tertiary) 40%, transparent);
		cursor: pointer;
		text-align: left;
		transition:
			border-color 120ms ease,
			background-color 120ms ease,
			transform 120ms ease;
	}

	.palette-card:hover {
		border-color: var(--color-border);
		transform: translateY(-1px);
	}

	.palette-card.active {
		border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 40%, transparent);
	}

	/* On the name row, never on the preview: the preview's top-right corner already
	   carries the accent dot, and a button there would sit on top of the one thing that
	   tells the reader what the accent looks like on that palette. */
	.palette-edit {
		position: absolute;
		bottom: 0.45rem;
		right: 0.45rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.2rem;
		height: 1.2rem;
		border-radius: var(--radius-full);
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg-elevated);
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background-color 120ms ease,
			border-color 120ms ease,
			color 120ms ease;
	}

	.palette-edit:hover {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.palette-preview {
		position: relative;
		display: block;
		height: 3.4rem;
		border-radius: calc(var(--radius-md) - 2px);
		border: 1px solid;
		overflow: hidden;
	}

	.pp-bubble {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		width: 55%;
		height: 0.9rem;
		border-radius: 0.45rem;
	}

	.pp-line {
		position: absolute;
		top: 1.85rem;
		left: 0.5rem;
		width: 70%;
		height: 0.18rem;
		border-radius: 999px;
		opacity: 0.85;
	}

	.pp-line.short {
		top: 2.45rem;
		width: 45%;
	}

	.pp-dot {
		position: absolute;
		right: 0.5rem;
		top: 0.5rem;
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 999px;
	}

	.palette-name {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 650;
		color: var(--color-text-primary);
	}

	.palette-card.active .palette-name {
		color: var(--color-accent);
	}

	/* Only the cards that carry an edit button pay for it, so a shipped palette's name
	   still runs the full width of its card. */
	.palette-slot:has(.palette-edit) .palette-name {
		padding-right: 1.5rem;
	}

	/* Same footprint as a palette card, dashed so it reads as an invite rather than a
	   sixth palette. */
	.palette-new {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		padding: 0.55rem;
		border-radius: var(--radius-md);
		border: 1px dashed var(--color-border);
		background: transparent;
		cursor: pointer;
		text-align: center;
		transition:
			border-color 120ms ease,
			background-color 120ms ease;
	}

	.palette-new:hover {
		border-color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
	}

	.palette-new-plus {
		font-family: var(--font-ui);
		font-size: 1.15rem;
		line-height: 1;
		color: var(--color-text-muted);
	}

	.palette-new:hover .palette-new-plus,
	.palette-new:hover .palette-new-label {
		color: var(--color-accent);
	}

	.palette-new-label {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 650;
		color: var(--color-text-primary);
		transition: color 120ms ease;
	}

	.palette-new-hint {
		font-family: var(--font-ui);
		font-size: 0.64rem;
		line-height: 1.35;
		color: var(--color-text-muted);
	}

	/* --- Labeled sub-groups inside a card (Contrast, Glass blur) --- */
	.sub-block {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	/* --- Accent --- */
	.accent-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.accent-swatch {
		position: relative;
		width: 1.65rem;
		height: 1.65rem;
		border-radius: var(--radius-full);
		border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
		cursor: pointer;
		padding: 0;
		transition:
			transform 120ms ease,
			box-shadow 120ms ease;
	}

	.accent-swatch:hover {
		transform: scale(1.1);
	}

	.accent-swatch.active {
		box-shadow:
			0 0 0 2px var(--color-bg-secondary),
			0 0 0 4px var(--color-accent);
	}

	.accent-custom-wrap {
		position: relative;
		display: inline-flex;
	}

	.accent-custom {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-style: dashed;
	}

	.accent-plus {
		font-family: var(--font-ui);
		font-size: 0.9rem;
		line-height: 1;
		color: var(--color-text-muted);
		pointer-events: none;
	}

	/* Floating popover over panel content, carrying .surface-float in markup. */
	.accent-popover {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		z-index: 30;
		padding: 0.75rem;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}

	/* --- Segmented pills (canonical .seg-lift active state) --- */
	.seg-pills {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-md);
	}

	.seg-pill {
		padding: 0.28rem 0.7rem;
		border-radius: calc(var(--radius-md) - 4px);
		font-family: var(--font-ui);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background-color 130ms ease,
			color 130ms ease;
	}

	/* Guarded so this unlayered hover can't outrank the layered .seg-lift on the
	   active pill. */
	.seg-pill:hover:not(.active) {
		color: var(--color-text-primary);
	}

	.seg-pill:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	/* --- Scene scope --- */

	.scope-note {
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--color-text-muted);
	}

	/* Rides beside the card's title, since what it qualifies is the title: these two
	   cards are the only ones on the page that a chat can take for itself, and with
	   the Scene card scrolled off there is otherwise nothing saying so. */
	.scope-chip {
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-accent) 13%, transparent);
		font-size: 0.64rem;
		font-weight: 600;
		color: var(--color-accent);
		white-space: nowrap;
	}

	/* --- Background --- */
	/* One full-width visual card: the picture itself is the control surface, with
	   the name and actions living on a bottom scrim. Unset -> dashed invite. */
	.bg-hero {
		position: relative;
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-subtle);
		overflow: hidden;
	}

	.bg-hero-unset {
		border-style: dashed;
	}

	.bg-hero-img {
		display: block;
		width: 100%;
		aspect-ratio: 3 / 1;
		object-fit: cover;
	}

	.bg-hero-scrim {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.55rem 0.65rem;
		background: linear-gradient(to top, rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.1) 45%, transparent 65%);
	}

	.bg-hero-name {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 650;
		color: white;
		text-shadow: 0 1px 6px rgb(0 0 0 / 0.55);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.bg-hero-actions {
		display: flex;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.bg-hero-btn {
		padding: 0.28rem 0.7rem;
		border-radius: var(--radius-full);
		border: 1px solid rgb(255 255 255 / 0.25);
		background: rgb(0 0 0 / 0.38);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		font-family: var(--font-ui);
		font-size: 0.7rem;
		font-weight: 600;
		color: white;
		cursor: pointer;
		transition:
			background-color 120ms ease,
			border-color 120ms ease;
	}

	.bg-hero-btn:hover {
		background: rgb(0 0 0 / 0.6);
		border-color: rgb(255 255 255 / 0.45);
	}

	.bg-hero-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		width: 100%;
		padding: 1.4rem 1rem;
		background: color-mix(in srgb, var(--color-bg-tertiary) 40%, transparent);
		cursor: pointer;
		text-align: center;
		transition: background-color 120ms ease;
	}

	.bg-hero-empty:hover {
		background: color-mix(in srgb, var(--color-bg-tertiary) 70%, transparent);
	}

	.bg-hero-empty:hover .bg-hero-empty-title {
		color: var(--color-accent);
	}

	.bg-hero-empty-title {
		font-size: 0.8rem;
		font-weight: 650;
		color: var(--color-text-primary);
		transition: color 120ms ease;
	}

	.bg-hero-empty-hint {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		line-height: 1.35;
	}

</style>
