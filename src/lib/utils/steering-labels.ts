/**
 * Human labels for steering scopes: the shared half between the composer popover and
 * the manager panel (architecture/engines.md). Both need to say the same thing about the same
 * note; a second copy of these lookups is how one surface starts calling a note
 * "Character" while the other names the character.
 *
 * Two vocabularies, kept apart on purpose: `scopeChoices` names the RUNGS of the ladder
 * (a picker, a set of group headings), `bindingLabel` names what ONE note is bound to.
 *
 * Store-sourced on purpose (the live-macro-context precedent): scope ids resolve against
 * whatever the library and chat list currently hold, and a MISSING row is labeled, never
 * hidden: a note bound to a deleted character is inert but must still be findable.
 */
import { chatStore } from '#lib/stores/chat.svelte.ts';
import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
import type { SteeringNote, SteeringScope, SteeringTarget } from '#lib/types/steering.ts';

/** One option in a note's scope picker. `available` false = there is nothing here to
 *  bind to (no character, no version pin, no chat); the option is shown disabled rather
 *  than hidden, because "why can't I put this on the character" deserves an answer. */
export interface ScopeChoice {
	scope: SteeringScope;
	label: string;
	hint: string;
	available: boolean;
}

/** The scopes a note can take against the currently open chat, in ladder order.
 *
 *  The labels name the RUNG, never what the rung currently resolves to. Naming the
 *  bound thing here reads as a helpful touch and isn't: a picker reading "Global /
 *  Sephiroth / Sephiroth · v2 / This chat" hides which option is the character and
 *  which is the version, and the manager panel's group headings inherit the same
 *  fog. What a note is actually bound to is `bindingLabel`'s job, on the surfaces
 *  that show one note at a time. */
export function scopeChoices(target: SteeringTarget): ScopeChoice[] {
	return [
		{ scope: 'global', label: 'Global', hint: 'Every chat, every character', available: true },
		{
			scope: 'character',
			label: 'Character',
			hint: 'Any chat with this character',
			available: target.characterId !== null
		},
		{
			scope: 'version',
			label: 'Version',
			hint: 'Only while the chat stays pinned to this version',
			available: target.characterVersionId !== null
		},
		{
			scope: 'chat',
			label: 'This chat',
			hint: 'This story only',
			available: target.chatId !== null
		}
	];
}

/** Every version of the target's character, in creation order: what the scope picker's
 *  Version list offers. `version` is the one rung whose id is a CHOICE rather than a
 *  reading of the open chat: the chat's pin is only the default worth marking, not the
 *  only thing a note may bind to. Empty when there is no character, or it has none. */
export function versionChoices(target: SteeringTarget): { id: string; label: string }[] {
	if (!target.characterId) return [];
	return characterLibraryStore
		.versionsFor(target.characterId)
		.map((v) => ({ id: v.id, label: v.name.trim() || 'Unnamed version' }));
}

/** A version's own name, no owner prefix: for the picker, where the character is
 *  already the context. `bindingLabel` is the one that names the owner too. */
export function versionLabel(id: string): string {
	const version = characterLibraryStore.getVersion(id);
	if (!version) return 'Deleted version';
	return version.name.trim() || 'Unnamed version';
}

/** The id a scope binds to for a given target: null for global, and null for a bound
 *  scope the target can't satisfy (which callers must refuse rather than store). Note
 *  that for `version` this is the chat's PIN: the editor's picker overrides it, every
 *  other caller (the manager's per-rung add, its group filter) wants exactly this. */
export function scopeIdFor(scope: SteeringScope, target: SteeringTarget): string | null {
	if (scope === 'character') return target.characterId;
	if (scope === 'version') return target.characterVersionId;
	if (scope === 'chat') return target.chatId;
	return null;
}

/** What a note is bound to RIGHT NOW, named from its own scopeId rather than from the
 *  open chat, so a note belonging to another character never borrows this one's name. */
export function bindingLabel(note: SteeringNote): string {
	switch (note.scope) {
		case 'global':
			return 'Global';
		case 'character':
			return note.scopeId ? characterName(note.scopeId) : 'Unbound character';
		case 'version':
			return note.scopeId ? versionName(note.scopeId) : 'Unbound version';
		case 'chat':
			return note.scopeId ? chatTitle(note.scopeId) : 'Unbound chat';
	}
}

/** True when the note's binding is something other than what this target would bind to,
 *  i.e. re-picking its scope here would MOVE it. Drives the editor's warning line. */
export function bindingIsForeign(note: SteeringNote, target: SteeringTarget): boolean {
	if (note.scope === 'global') return false;
	return note.scopeId !== scopeIdFor(note.scope, target);
}

function characterName(id: string): string {
	const entry = characterLibraryStore.entries.find((e) => e.id === id && e.type === 'character');
	return entry?.identity.name?.trim() || (entry ? 'Unnamed character' : 'Deleted character');
}

function versionName(id: string): string {
	const version = characterLibraryStore.getVersion(id);
	if (!version) return 'Deleted version';
	const owner = characterLibraryStore.entries.find((e) => e.id === version.entryId);
	const ownerName = owner?.identity.name?.trim();
	return ownerName ? `${ownerName} · ${versionLabel(id)}` : versionLabel(id);
}

function chatTitle(id: string): string {
	const chat = chatStore.chats.find((c) => c.id === id);
	return chat?.title?.trim() || (chat ? 'Untitled chat' : 'Deleted chat');
}
