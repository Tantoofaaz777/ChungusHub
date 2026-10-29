import { sceneHistory } from '../../../shared/memory-scenes';
import { memoryStore } from '#lib/memory/scene-store.svelte.ts';
/**
 * Live MacroContext from the current stores: how the substitute-level surfaces
 * (the opening scene, Continue, the composer transforms) resolve the global engine
 * macros exactly like a preset does. The generation path keeps its db-sourced
 * construction in prompt-builder.ts; this is the store-sourced equivalent,
 * mirroring the same character/persona/lorebook resolution the token meters use.
 *
 * Deliberately NOT imported by the memory store (it builds its context from its
 * own manual-summary context). This module imports chatStore, which imports memoryStore,
 * and that would close an import cycle.
 */

import type { Message } from '#lib/types/chat.ts';
import { chatAuthorsNote } from '#lib/types/chat.ts';
import { expandMacros, cardLoreContext, cardLorePositions, referencedLorebookOutlets, withLorebookFields, type MacroContext } from '#lib/macros.ts';
import { resolveLorebooks } from '#lib/lorebook/engine.ts';
import { lorebookHistory, lorebookScanFields, type LorebookTrigger } from '#lib/lorebook/types.ts';
import { chatStore } from '#lib/stores/chat.svelte.ts';
import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
import { lorebookStore } from '#lib/lorebook/store.svelte.ts';
import { lorebookSettingsStore } from '#lib/lorebook/settings.svelte.ts';
import { presetControlsStore } from '#lib/stores/presetControls.svelte.ts';
import {
	chatLorebookClaim,
	chatMutedLorebookClaim,
	chatPersonaEntry,
	chatPreset,
	resolvePromptTarget,
	toPromptCharacter
} from './chat-setup';
import { countTokens } from '#lib/tokenizer/count.ts';

export interface LiveMacroContextOptions {
	/** The message path macros read chat state from; defaults to the active path. */
	chatMessages?: Message[];
	/** The {{memory}} recall text, supplied by the caller so this module never imports the memory store. */
	memory?: string;
	/** Which generation this context serves, for entries that fire on only some kinds.
	 *  Absent = a plain send. */
	lorebookTrigger?: LorebookTrigger;
	/** Impersonation uses history and live identities only, independently of the RP preset. */
	historyOnly?: boolean;
	/** Explicit templates for a request that does not assemble the roleplay preset. */
	templates?: string[];
}

export function buildLiveMacroContext(opts: LiveMacroContextOptions = {}): MacroContext {
	const characterEntry = chatStore.activeChat?.characterId
		? characterLibraryStore.entries.find(
				(e) => e.id === chatStore.activeChat?.characterId && e.type === 'character'
			)
		: null;
	// A pinned chat plays against its pinned variant's data, same rule as the meters
	// and the generation path (prompt-builder swaps in the pinned version's data too).
	const characterData = characterEntry
		? characterLibraryStore.dataForVersion(characterEntry, chatStore.activeChat?.characterVersionId ?? null)
		: null;
	const character = toPromptCharacter(characterEntry, characterData);
	const chatMessages = sceneHistory(opts.chatMessages ?? chatStore.currentChatState?.activePath ?? [], memoryStore.scenes);
	const persona = chatPersonaEntry(chatStore.activeChat);
	const historyContext: MacroContext = {
		resolvedPersona: toPromptCharacter(persona),
		resolvedCharacters: character ? [character] : [],
		chatMessages
	};
	// No preset, control values, author notes, lorebook scan or primary-connection budget
	// is consulted for this path. The engine sends its own template after these turns.
	if (opts.historyOnly) return historyContext;
	const preset = chatPreset(chatStore.activeChat);
	// Same budget derivation as buildMacroContext (share of the prompt budget, counted with
	// the active model's encoding), so these surfaces inject the same block the prompt does.
	const lorebookSettings = lorebookSettingsStore.settings;
	const promptTarget = resolvePromptTarget(chatStore.activeChat);
	const lorebookBudget =
		lorebookSettings.budgetPercent > 0
			? {
					maxTokens: Math.floor((promptTarget.contextBudget * lorebookSettings.budgetPercent) / 100),
					count: (text: string) => countTokens(text, promptTarget.model)
				}
			: undefined;
	const base: MacroContext = {
		...historyContext,
		authorsNote: chatAuthorsNote(chatStore.activeChat),
		cardLorePositions: cardLorePositions(preset?.items ?? []),
		controls: preset?.controls ?? [],
		customFields: presetControlsStore.valuesFor(preset?.id ?? null),
		memory: opts.memory ?? ''
	};
	// One scan, resolved against a context that carries no lore yet: same shape as
	// buildMacroContext, through the same resolver, so these surfaces cannot select
	// differently from the prompt they sit beside.
	const lore = resolveLorebooks({
		outletNames: referencedLorebookOutlets(opts.templates ?? (preset?.items ?? []).filter((item) => item.enabled).map((item) => item.content)),
		cardContext: cardLoreContext(base),
		books: lorebookStore.booksForChat({
			cards: [...(characterData?.lorebookIds ?? []), ...(persona?.data.lorebookIds ?? [])],
			chat: chatLorebookClaim(chatStore.activeChat),
			muted: chatMutedLorebookClaim(chatStore.activeChat)
		}),
		messages: chatMessages.map((m) => m.content),
		fields: lorebookScanFields(base.resolvedCharacters ?? [], base.resolvedPersona),
		trigger: opts.lorebookTrigger,
		history: lorebookHistory(chatMessages),
		settings: lorebookSettings,
		expand: (text) => expandMacros(text, base),
		budget: lorebookBudget
	});
	return withLorebookFields({ ...base, lorebook: lore.text, lorebookOutlets: lore.outlets, lorebookTrace: lore.trace }, lore.fields);
}
