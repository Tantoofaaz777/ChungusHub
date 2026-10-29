import { lazyModule } from '#lib/utils/lazy-module.ts';
import type { SettingsPage } from '#lib/config/settings-pages.ts';

export const settingsPages = {
	connections: lazyModule(() => import('./ConnectionsPage.svelte')),
	interface: lazyModule(() => import('./InterfacePage.svelte')),
	chat: lazyModule(() => import('./ChatPage.svelte')),
	general: lazyModule(() => import('./GeneralPage.svelte')),
	engines: lazyModule(() => import('./EnginesPage.svelte')),
	tts: lazyModule(() => import('./TtsPage.svelte')),
	security: lazyModule(() => import('./SecurityPage.svelte')),
	backups: lazyModule(() => import('./BackupsPage.svelte')),
	'prompt-builder': lazyModule(() => import('#lib/components/promptBuilder/PromptBuilderView.svelte')),
	regex: lazyModule(() => import('./RegexPage.svelte')),
	advanced: lazyModule(() => import('./AdvancedPage.svelte')),
	about: lazyModule(() => import('./AboutPage.svelte')),
	developer: lazyModule(() => import('./DeveloperPage.svelte'))
} satisfies Record<SettingsPage, () => Promise<unknown>>;
