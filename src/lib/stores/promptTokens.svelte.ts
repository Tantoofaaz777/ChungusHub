import { tokenCalibration, countTokens } from '$lib/tokenizer';
import { tokenEstimate } from '$lib/tokenizer/reactive.svelte';
import { chatStore } from './chat.svelte';
import { characterLibraryStore } from './characterLibrary.svelte';
import { featurePromptsStore } from './featurePrompts.svelte';
import { presetControlsStore } from './presetControls.svelte';
import { regexRulesStore } from './regex-rules.svelte';
import { steeringStore } from './steering.svelte';
import { lorebookStore } from '$lib/lorebook/store.svelte';
import { lorebookSettingsStore } from '$lib/lorebook/settings.svelte';
import { memoryStore } from '$lib/memory/scene-store.svelte';
import { assemblePrompt } from '$lib/utils/prompt-assembly';
import {
	chatLorebookClaim, chatMutedLorebookClaim, chatPersonaEntry, chatPreset,
	resolvePromptTarget, toPromptCharacter
} from '$lib/utils/chat-setup';
import { steeringTargetForChat } from '$lib/types/steering';
import type { Message } from '$lib/types/chat';
import { chatAuthorsNote } from '$lib/types/chat';

/** The composer and inspector share one estimate, assembled by the real send pipeline. */
class PromptTokensStore {
	// Independent of draft persistence: the inspector also works with Save drafts off.
	draft = $state<{ chatId: string | null; text: string } | null>(null);
	private chat = $derived(chatStore.activeChat);
	private currentPreset = $derived(chatPreset(this.chat));
	private persona = $derived(chatPersonaEntry(this.chat));
	private character = $derived(characterLibraryStore.entries.find(
		entry => entry.id === this.chat?.characterId && entry.type === 'character'
	) ?? null);
	private characterData = $derived(this.character
		? characterLibraryStore.dataForVersion(this.character, this.chat?.characterVersionId ?? null)
		: null);
	private target = $derived(resolvePromptTarget(this.chat));
	private activePath = $derived(chatStore.currentChatState?.activePath ?? []);

	// Sending inserts a user turn first. Price the same history/trim with an empty
	// placeholder; the draft's own tokens remain the separate "your message" count.
	private pricedPath = $derived.by<Message[]>(() => {
		const last = this.activePath.at(-1);
		if (!last) return this.activePath;
		return [...this.activePath, {
			...last, id: '__composer_draft__', parentId: last.id, role: 'user',
			content: '', attachments: null, thinking: null
		}];
	});
	private steering = $derived.by(() => {
		if (!featurePromptsStore.steeringEnabled) return undefined;
		const notes = steeringStore.resolveForPrompt(steeringTargetForChat(this.chat));
		return notes.length ? { notes, wrapper: featurePromptsStore.promptFor('steeringWrapper') } : undefined;
	});
	private assembly = $derived(this.chat && this.currentPreset ? tokenEstimate(() => assemblePrompt({
		authorsNote: chatAuthorsNote(this.chat),
		preset: this.currentPreset,
		resolvedPersona: toPromptCharacter(this.persona),
		resolvedCharacters: this.character && this.characterData
			? [toPromptCharacter(this.character, this.characterData)!] : [],
		lorebooks: lorebookStore.booksForChat({
			cards: [...(this.characterData?.lorebookIds ?? []), ...(this.persona?.data.lorebookIds ?? [])],
			chat: chatLorebookClaim(this.chat), muted: chatMutedLorebookClaim(this.chat)
		}),
		lorebookSettings: lorebookSettingsStore.settings,
		controls: this.currentPreset!.controls ?? [],
		customFields: presetControlsStore.valuesFor(this.currentPreset!.id),
		chatMessages: this.pricedPath,
		recall: { text: memoryStore.recall || null, archivedIds: memoryStore.archivedMessageIds, scenes: memoryStore.scenes },
		model: this.target.model, postProcessing: this.target.postProcessing,
		contextBudget: this.target.contextBudget,
		regexRules: regexRulesStore.effectiveFor(this.currentPreset), steering: this.steering
	})) : null);
	private ratio = $derived(tokenCalibration.ratioFor(this.target.model));
	model = $derived(this.target.model);
	preset = $derived(Math.round((this.assembly?.breakdown.preset ?? 0) * this.ratio));
	context = $derived(Math.round((this.assembly?.breakdown.context ?? 0) * this.ratio));
	memory = $derived(Math.round((this.assembly?.breakdown.memory ?? 0) * this.ratio));
	chatTokens = $derived(Math.round((this.assembly?.breakdown.chat ?? 0) * this.ratio));
	total = $derived(Math.round((this.assembly?.breakdown.total ?? 0) * this.ratio));
	input = $derived(this.chat && this.draft?.chatId === this.chat.id ? tokenEstimate(() => countTokens(this.draft!.text)) : 0);
	loading = $derived(!!this.chat && !!this.currentPreset && !this.assembly);
	trimmedMessages = $derived(this.assembly?.trimmedMessages ?? 0);
	overBudget = $derived(this.assembly?.overBudget ?? false);
	warning = $derived(this.overBudget
		? 'Prompt exceeds the context size even with all history trimmed'
		: this.trimmedMessages > 0
			? `${this.trimmedMessages} older ${this.trimmedMessages === 1 ? 'message is' : 'messages are'} being dropped to fit the context size`
			: '');
}

export const promptTokensStore = new PromptTokensStore();
