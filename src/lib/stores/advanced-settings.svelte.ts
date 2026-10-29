import { readSetting, writeSetting, registerSettingsReload, reloadSettings } from '#lib/services/syncedSetting.ts';

/**
 * The destructive-act ladder's three rungs, in one setting rather than two switches
 * (architecture/ui-shell-settings.md). They are one continuum and not two questions: with
 * asking switched off there is no dialog left for a hold to live on, so a pair of booleans
 * would spell one of its four states as nothing at all.
 */
export type DeleteConfirmRung = 'hold' | 'ask' | 'off';

const DELETE_CONFIRM_RUNGS: readonly DeleteConfirmRung[] = ['hold', 'ask', 'off'];

interface AdvancedSettings {
	promptDebugPanel: boolean;
	/** The rung that survives a reload and reaches every device. A temporary drop rides
	 *  `stores/delete-guard.svelte.ts` instead and is deliberately never stored here. */
	deleteConfirm: DeleteConfirmRung;
	/** The Developer group under Settings → About. No control writes it: the version row's
	 *  tap streak is its only switch, so it stays a setting nobody meets by accident. */
	developerMode: boolean;
}

const SETTINGS_KEY = 'advancedSettings';

const DEFAULT_SETTINGS: AdvancedSettings = {
	promptDebugPanel: false,
	deleteConfirm: 'hold',
	developerMode: false
};

/** Coerce a raw settings blob into a valid config, dropping anything unexpected. */
function normalize(raw: Partial<AdvancedSettings> | null): AdvancedSettings {
	return {
		promptDebugPanel:
			typeof raw?.promptDebugPanel === 'boolean'
				? raw.promptDebugPanel
				: DEFAULT_SETTINGS.promptDebugPanel,
		deleteConfirm: DELETE_CONFIRM_RUNGS.includes(raw?.deleteConfirm as DeleteConfirmRung)
			? (raw!.deleteConfirm as DeleteConfirmRung)
			: DEFAULT_SETTINGS.deleteConfirm,
		developerMode:
			typeof raw?.developerMode === 'boolean' ? raw.developerMode : DEFAULT_SETTINGS.developerMode
	};
}

class AdvancedSettingsStore {
	settings = $state<AdvancedSettings>({ ...DEFAULT_SETTINGS });

	promptDebugPanel = $derived(this.settings.promptDebugPanel);
	deleteConfirm = $derived(this.settings.deleteConfirm);
	developerMode = $derived(this.settings.developerMode);

	async initialize(): Promise<void> {
		await this.syncReload();
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		await reloadSettings([SETTINGS_KEY], () => readSetting<Partial<AdvancedSettings> | null>(SETTINGS_KEY, null), raw => { this.settings = normalize(raw); });
	}

	setPromptDebugPanel(enabled: boolean): void {
		this.settings.promptDebugPanel = enabled;
		this.persist();
	}

	setDeveloperMode(enabled: boolean): void {
		this.settings.developerMode = enabled;
		this.persist();
	}

	setDeleteConfirm(rung: DeleteConfirmRung): void {
		this.settings.deleteConfirm = rung;
		this.persist();
	}

	private persist(): void {
		writeSetting(SETTINGS_KEY, this.settings);
	}
}

export const advancedSettingsStore = new AdvancedSettingsStore();
