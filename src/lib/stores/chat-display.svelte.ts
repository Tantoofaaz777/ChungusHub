import { displaySelfRefs } from '#lib/macros.ts';
import { storyRoleName } from '#lib/types/library.ts';
import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
import { chatStore } from '#lib/stores/chat.svelte.ts';
import { openChatSetup } from '#lib/stores/openChatSetup.svelte.ts';
import { regexRulesStore } from '#lib/stores/regex-rules.svelte.ts';

class ChatDisplay {
	private character = $derived.by(() => {
		const id = chatStore.activeChat?.characterId;
		const entry = characterLibraryStore.entries.find(entry => entry.id === id && entry.type === 'character');
		return entry ? storyRoleName(entry.identity) || 'Character' : 'Character';
	});
	private user = $derived(openChatSetup.persona ? storyRoleName(openChatSetup.persona.identity) || 'You' : 'You');
	private pronouns = $derived(openChatSetup.persona ? openChatSetup.persona.identity.pronouns ?? {} : undefined);

	expand(content: string): string {
		return displaySelfRefs(content, this.character, this.user, this.pronouns);
	}

	text(content: string, role: string, depth: number): string {
		return this.expand(regexRulesStore.forDisplay(content, role, depth, openChatSetup.preset));
	}
}

export const chatDisplay = new ChatDisplay();
