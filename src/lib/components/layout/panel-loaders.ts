import { lazyModule } from '#lib/utils/lazy-module.ts';

export const panels = {
	settings: lazyModule(() => import('#lib/components/settings/SettingsPanel.svelte')),
	settingsContent: lazyModule(() => import('#lib/components/settings/SettingsContentPanel.svelte')),
	library: lazyModule(() => import('#lib/components/library/LibraryView.svelte')),
	libraryEditor: lazyModule(() => import('#lib/components/library/LibraryEditorOverlay.svelte')),
	lorebook: lazyModule(() => import('#lib/components/lorebook/LorebookView.svelte')),
	chats: lazyModule(() => import('#lib/components/sidebar/ChatsView.svelte')),
	presetControls: lazyModule(() => import('#lib/components/presetControls/PresetControlsView.svelte')),
	memory: lazyModule(() => import('#lib/components/memory/MemoryPanel.svelte')),
	threads: lazyModule(() => import('#lib/components/threads/ThreadsPanel.svelte')),
	debug: lazyModule(() => import('#lib/components/debug/PromptInspector.svelte'))
};
