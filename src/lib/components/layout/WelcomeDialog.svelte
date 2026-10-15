<script module lang="ts">
	type Step = 'hello' | 'persona';

	// Module-level open flag, the ShortcutsSheet pattern and for the same reason: this
	// is a dialog, not a workspace panel, so it stays outside uiStore's choreography and
	// a greeting never disturbs whatever is open behind it. Two triggers, both here:
	// AppShell raises it on a fresh install and whenever there is no persona, and the
	// Settings root's footer row reopens it on demand.
	let open = $state(false);
	// Up here with `open` because the step has to be set from outside the instance: every
	// opening starts at the top, or a re-read from Settings lands on whichever screen the
	// last one finished on.
	let step = $state<Step>('hello');

	export function openWelcomeDialog(): void {
		step = 'hello';
		open = true;
	}
</script>

<script lang="ts">
	/**
	 * The first-run greeting. Two steps: why the app exists, and who you are in the story.
	 * It deliberately sets up NO connection: an API key, a provider and a model are the
	 * Connections page's whole subject, and a second copy of that form here would be a
	 * second thing to keep in step with the provider list.
	 *
	 * The persona step is not decoration, and it is why there is no Skip: the app keeps at
	 * least one persona (architecture/library.md) and this is the only door that writes the
	 * first one, so there is nothing useful on the other side of a skip. See `dismissible`
	 * for the two states that open the gate again.
	 *
	 * The first step is the author's note and carries deliberately NO feature list. A
	 * capability nobody has used yet cannot be taught in a modal (memory means nothing
	 * before there is a chat to summarise from), and the app holds far more than any three
	 * items, so every shortlist reads as arbitrary. The import note below is the one place
	 * another product is named, because there it names something the reader can act on.
	 */
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { personaStore } from '$lib/stores/persona.svelte';
	import { generalSettingsStore } from '$lib/stores/general-settings.svelte';
	import { failureText } from '$lib/stores/toast.svelte';

	const TITLES: Record<Step, string> = {
		hello: 'Welcome to ChungusHub',
		persona: 'Who are you?'
	};

	let name = $state('');
	let description = $state('');
	let saving = $state(false);
	// In place, never a toast: a toast fired from inside a dialog is a message the
	// reader cannot reach (the notification contract).
	let error = $state('');

	/**
	 * The greeting is a gate while the app has no persona, not a thing to escape: the
	 * library's floor is one and nothing else creates it, so there is nothing useful on
	 * the other side of a Skip. Once one EXISTS the gate has no subject left, which is what
	 * keeps the Settings row from trapping a reader who only came back to re-read this.
	 * A failed write opens it too: with the server gone nothing in here can succeed, and
	 * holding someone inside a dialog that cannot finish helps nobody.
	 */
	let hasPersona = $derived(characterLibraryStore.personas.length > 0);
	let dismissible = $derived(hasPersona || error !== '');

	/** The second step exists to write the FIRST persona, so a re-read from Settings ends
	 *  here: with one already in the library that form has nothing to do but mint a
	 *  duplicate of whoever the reader last typed. */
	function leaveHello(): void {
		if (hasPersona) close();
		else step = 'persona';
	}

	function close(): void {
		open = false;
		generalSettingsStore.setWelcomeSeen(true);
	}

	async function createPersona(): Promise<void> {
		const trimmed = name.trim();
		if (!trimmed || saving) return;
		saving = true;
		error = '';
		try {
			const entry = await characterLibraryStore.createPersona();
			await characterLibraryStore.updateIdentity(entry.id, { name: trimmed });
			const about = description.trim();
			if (about) await characterLibraryStore.updateTraits(entry.id, { description: about });
			// Promote it out of the unsaved-new set, or the Library's nav guard would trap
			// the very next navigation on an entry the reader already finished writing.
			characterLibraryStore.confirmNewEntry(entry.id);
			personaStore.setActive(entry.id);
			close();
		} catch (e) {
			error = failureText('create that persona', e);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog {open} onClose={close} title={TITLES[step]} {dismissible} size="lg">
	{#if step === 'hello'}
		<div class="wd-hello">
			<img class="wd-mascot" src="/mark.svg" alt="" />

			<p class="wd-lede">
				Thank you for trying ChungusHub out. I started building it only for myself, and it
				grew big enough that sharing it seemed like the better idea: maybe a few people
				like me will enjoy it too.
			</p>
		</div>

		<div class="wd-foot">
			<Button variant="primary" onclick={leaveHello}>
				Get started
				<Icon name="arrowRight" class="w-4 h-4" />
			</Button>
		</div>
	{:else}
		<div class="wd-form">
			<p class="wd-lede">
				A persona is you in the story. Name one now and every chat starts with it;
				you can write more in the Library later.
			</p>

			<label class="wd-field">
				<span class="wd-label">Name</span>
				<!-- svelte-ignore a11y_autofocus -- the step exists to be typed into -->
				<input
					class="input-base wd-input"
					bind:value={name}
					autofocus
					maxlength="60"
					placeholder="What the story calls you"
					onkeydown={(e) => {
						if (e.key === 'Enter') createPersona();
					}}
				/>
			</label>

			<label class="wd-field">
				<span class="wd-label">About you <span class="wd-optional">optional</span></span>
				<textarea
					class="input-base wd-input wd-textarea"
					bind:value={description}
					rows="3"
					placeholder="Appearance, presence, how you carry yourself…"
				></textarea>
			</label>

			<Alert message={error} />
		</div>

		<div class="wd-foot">
			<Button variant="primary" disabled={!name.trim() || saving} onclick={createPersona}>
				{#if saving}
					<Spinner size="sm" />
				{/if}
				Create persona
			</Button>
		</div>
	{/if}
</Dialog>

<style>
	.wd-hello {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.wd-mascot {
		width: 5.5rem;
		height: 5.5rem;
		object-fit: contain;
		margin-bottom: 0.9rem;
		filter: drop-shadow(0 6px 16px color-mix(in srgb, var(--color-accent) 30%, transparent));
	}

	.wd-lede {
		margin: 0;
		max-width: 30rem;
		font-family: var(--font-ui);
		font-size: 0.9rem;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.wd-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.wd-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.wd-label {
		font-family: var(--font-ui);
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.wd-optional {
		margin-left: 0.35rem;
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--color-text-muted);
	}

	.wd-input {
		width: 100%;
		padding: 0.55rem 0.75rem;
		font-family: var(--font-ui);
		font-size: 0.85rem;
		color: var(--color-text-primary);
	}

	.wd-input::placeholder {
		color: var(--color-text-muted);
	}

	.wd-textarea {
		resize: vertical;
		min-height: 4.5rem;
		line-height: 1.5;
	}

	/* Right-aligned and no separator rule, the shape every other dialog's footer has:
	   with no way out to sit on the left, there is nothing left to space apart. */
	.wd-foot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
</style>
