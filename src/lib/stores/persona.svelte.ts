/**
 * Global active persona.
 *
 * In the ST-style model there is one "you" across the whole app: a single active
 * persona, chosen from the library, used as the protagonist in every chat's
 * generation. Persisted to the settings table so it survives restarts and syncs.
 */
import { db } from '$lib/services/database';
import { characterLibraryStore } from './characterLibrary.svelte';
import { storyRoleName, type LibraryEntry } from '$lib/types/library';
import type { PromptCharacter } from '$lib/macros';

const ACTIVE_PERSONA_KEY = 'activePersonaId';

/**
 * Why the last persona's delete refuses, in the reader's own words. Both Library surfaces
 * keep that delete on screen and inert rather than dropping it (a control that vanishes
 * takes the rule with it, and the reader is left hunting for a button they remember), so
 * this sentence is the whole explanation, carried as the item's tooltip and said again as a
 * refusal on the tap that cannot hover. One export because two surfaces state it.
 */
export const LAST_PERSONA_REASON = 'Your only persona: create another one before deleting this';

class PersonaStore {
	activeId = $state<string | null>(null);

	async initialize(): Promise<void> {
		const stored = await db.getSetting(ACTIVE_PERSONA_KEY);
		this.activeId = stored || null;
	}

	/** Reload after a cross-device settings change. */
	async syncReload(): Promise<void> {
		const stored = await db.getSetting(ACTIVE_PERSONA_KEY);
		this.activeId = stored || null;
	}

	/** Only ever a real persona: the library keeps at least one and a delete hands the role
	 *  to a survivor server-side (architecture/library.md), so nothing clears this. */
	setActive(id: string): void {
		this.activeId = id;
		void db.setSetting(ACTIVE_PERSONA_KEY, id);
	}

	/** The active persona's library entry. Null only where the app has no persona at all,
	 *  which is the first-run greeting's subject and nothing else's: every other surface can
	 *  treat this as present, and the `|| 'User'` fallbacks downstream are what the outage
	 *  case (a greeting whose write failed) lands on rather than a state to design for. */
	get activeEntry(): LibraryEntry | null {
		if (!this.activeId) return null;
		return (
			characterLibraryStore.entries.find(
				(entry) => entry.id === this.activeId && entry.type === 'persona'
			) ?? null
		);
	}

	/** Resolved persona for prompt assembly. */
	get activeResolved(): PromptCharacter | null {
		const entry = this.activeEntry;
		if (!entry) return null;
		return {
			name: storyRoleName(entry.identity),
			traits: entry.data.traits,
			pronouns: entry.identity.pronouns,
			storyNotes: ''
		};
	}
}

export const personaStore = new PersonaStore();
