import { DEFAULT_REASONING_RETENTION, normalizeReasoningRetention } from '#shared/reasoning-retention.ts';
import { readSetting, writeSetting, registerSettingsReload, reloadSettings } from '#lib/services/syncedSetting.ts';

export type InputHistoryScope = 'global' | 'chat';

/** How the turns behind the transcript window arrive: on their own as the reader scrolls
 *  back, or one press at a time from the button at the top of the window. */
export type TranscriptLoadMode = 'scroll' | 'button';

interface GeneralSettings {
	saveDrafts: boolean;
	inputHistory: boolean;
	/** What ↑/↓ recalls: everything ever sent, or only the current chat's inputs. */
	inputHistoryScope: InputHistoryScope;
	/** How many sent messages the history log keeps (oldest trimmed first). */
	inputHistoryLimit: number;
	/** Render a long chat from its newest end instead of all at once. Every turn on screen
	 *  costs a markdown parse, a card of DOM and a row the scroller re-measures on every
	 *  streaming token, so a long story is slow to open and drags every reply after it. */
	transcriptPaging: boolean;
	/** Turns rendered per load: the window a chat opens on, and every step back from there. */
	transcriptPageSize: number;
	/** What reaches back for earlier turns: the scroll itself, or a press. */
	transcriptLoadMode: TranscriptLoadMode;
	/** Open the per-message reasoning box by default (streaming and saved turns). */
	autoExpandReasoning: boolean;
	autoClearReasoning: boolean;
	reasoningDepth: number;
	/** Open the normal message editor by double-clicking the rendered story text. */
	doubleClickToEdit: boolean;
	/** Read by nothing. Who a story plays as is claimed in the chat itself (the composer's
	 *  setup chip), so there is no app-wide switch to show or hide. The key is still parsed
	 *  and written back so an install that recorded a value keeps it byte for byte. */
	personaSwitcher: boolean;
	/** Split Settings on wide screens: the dock keeps the section list and pages
	 *  open in a wide centered panel. Off = phone-style drill-down everywhere.
	 *  Inert below dock widths (the panel is a single centered overlay there). */
	settingsSplitView: boolean;
	/** Whether the welcome dialog has run once. Not a preference the reader sets from a
	 *  row, but it rides the spine like one deliberately: the settings blob is server-side,
	 *  so opening the app on a phone after setting it up on a desktop does NOT greet you a
	 *  second time. localStorage would, and would also greet a second browser on the same
	 *  machine. Settings → the root's footer row reopens the dialog without clearing it. */
	welcomeSeen: boolean;
}

const SETTINGS_KEY = 'generalSettings';

const HISTORY_LIMIT_MIN = 10;
const HISTORY_LIMIT_MAX = 1000;

const DEFAULT_SETTINGS: GeneralSettings = {
	saveDrafts: true,
	inputHistory: true,
	inputHistoryScope: 'global',
	inputHistoryLimit: 100,
	transcriptPaging: true,
	transcriptPageSize: 100,
	transcriptLoadMode: 'scroll',
	autoExpandReasoning: false,
	...DEFAULT_REASONING_RETENTION,
	doubleClickToEdit: false,
	personaSwitcher: false,
	settingsSplitView: false,
	welcomeSeen: false
};

function clampLimit(value: number): number {
	return Math.min(HISTORY_LIMIT_MAX, Math.max(HISTORY_LIMIT_MIN, Math.round(value)));
}

const PAGE_SIZE_MIN = 10;
const PAGE_SIZE_MAX = 1000;

function clampPageSize(value: number): number {
	return Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Math.round(value)));
}

/** Coerce a raw settings blob into a valid config, dropping anything unexpected. */
function normalize(raw: Partial<GeneralSettings> | null): GeneralSettings {
	return {
		...normalizeReasoningRetention(raw),
		saveDrafts: typeof raw?.saveDrafts === 'boolean' ? raw.saveDrafts : DEFAULT_SETTINGS.saveDrafts,
		inputHistory:
			typeof raw?.inputHistory === 'boolean' ? raw.inputHistory : DEFAULT_SETTINGS.inputHistory,
		inputHistoryScope:
			raw?.inputHistoryScope === 'chat' || raw?.inputHistoryScope === 'global'
				? raw.inputHistoryScope
				: DEFAULT_SETTINGS.inputHistoryScope,
		inputHistoryLimit:
			typeof raw?.inputHistoryLimit === 'number' && Number.isFinite(raw.inputHistoryLimit)
				? clampLimit(raw.inputHistoryLimit)
				: DEFAULT_SETTINGS.inputHistoryLimit,
		transcriptPaging:
			typeof raw?.transcriptPaging === 'boolean'
				? raw.transcriptPaging
				: DEFAULT_SETTINGS.transcriptPaging,
		transcriptPageSize:
			typeof raw?.transcriptPageSize === 'number' && Number.isFinite(raw.transcriptPageSize)
				? clampPageSize(raw.transcriptPageSize)
				: DEFAULT_SETTINGS.transcriptPageSize,
		transcriptLoadMode:
			raw?.transcriptLoadMode === 'button' || raw?.transcriptLoadMode === 'scroll'
				? raw.transcriptLoadMode
				: DEFAULT_SETTINGS.transcriptLoadMode,
		autoExpandReasoning:
			typeof raw?.autoExpandReasoning === 'boolean'
				? raw.autoExpandReasoning
				: DEFAULT_SETTINGS.autoExpandReasoning,
		doubleClickToEdit:
			typeof raw?.doubleClickToEdit === 'boolean'
				? raw.doubleClickToEdit
				: DEFAULT_SETTINGS.doubleClickToEdit,
		personaSwitcher:
			typeof raw?.personaSwitcher === 'boolean'
				? raw.personaSwitcher
				: DEFAULT_SETTINGS.personaSwitcher,
		settingsSplitView:
			typeof raw?.settingsSplitView === 'boolean'
				? raw.settingsSplitView
				: DEFAULT_SETTINGS.settingsSplitView,
		welcomeSeen:
			typeof raw?.welcomeSeen === 'boolean' ? raw.welcomeSeen : DEFAULT_SETTINGS.welcomeSeen
	};
}

class GeneralSettingsStore {
	settings = $state<GeneralSettings>({ ...DEFAULT_SETTINGS });

	saveDrafts = $derived(this.settings.saveDrafts);
	inputHistory = $derived(this.settings.inputHistory);
	inputHistoryScope = $derived(this.settings.inputHistoryScope);
	inputHistoryLimit = $derived(this.settings.inputHistoryLimit);
	transcriptPaging = $derived(this.settings.transcriptPaging);
	transcriptPageSize = $derived(this.settings.transcriptPageSize);
	transcriptLoadMode = $derived(this.settings.transcriptLoadMode);
	autoExpandReasoning = $derived(this.settings.autoExpandReasoning);
	autoClearReasoning = $derived(this.settings.autoClearReasoning);
	reasoningDepth = $derived(this.settings.reasoningDepth);
	doubleClickToEdit = $derived(this.settings.doubleClickToEdit);
	settingsSplitView = $derived(this.settings.settingsSplitView);
	welcomeSeen = $derived(this.settings.welcomeSeen);

	async initialize(): Promise<void> {
		await this.syncReload();
		registerSettingsReload(() => this.syncReload());
	}

	async syncReload(): Promise<void> {
		await reloadSettings([SETTINGS_KEY], () => readSetting<Partial<GeneralSettings> | null>(SETTINGS_KEY, null), raw => { this.settings = normalize(raw); });
	}

	setSaveDrafts(enabled: boolean): void {
		this.settings.saveDrafts = enabled;
		this.persist();
	}

	setInputHistory(enabled: boolean): void {
		this.settings.inputHistory = enabled;
		this.persist();
	}

	setInputHistoryScope(scope: InputHistoryScope): void {
		this.settings.inputHistoryScope = scope;
		this.persist();
	}

	setInputHistoryLimit(limit: number): void {
		this.settings.inputHistoryLimit = clampLimit(limit);
		this.persist();
	}

	setTranscriptPaging(enabled: boolean): void {
		this.settings.transcriptPaging = enabled;
		this.persist();
	}

	setTranscriptPageSize(size: number): void {
		this.settings.transcriptPageSize = clampPageSize(size);
		this.persist();
	}

	setTranscriptLoadMode(mode: TranscriptLoadMode): void {
		this.settings.transcriptLoadMode = mode;
		this.persist();
	}

	setAutoExpandReasoning(enabled: boolean): void {
		this.settings.autoExpandReasoning = enabled;
		this.persist();
	}

	setAutoClearReasoning(enabled: boolean): void {
		this.settings.autoClearReasoning = enabled;
		this.persist();
	}

	setReasoningDepth(depth: number): void {
		this.settings.reasoningDepth = normalizeReasoningRetention({ reasoningDepth: depth }).reasoningDepth;
		this.persist();
	}

	setDoubleClickToEdit(enabled: boolean): void {
		this.settings.doubleClickToEdit = enabled;
		this.persist();
	}

	setSettingsSplitView(enabled: boolean): void {
		this.settings.settingsSplitView = enabled;
		this.persist();
	}

	setWelcomeSeen(seen: boolean): void {
		this.settings.welcomeSeen = seen;
		this.persist();
	}

	private persist(): void {
		writeSetting(SETTINGS_KEY, this.settings);
	}
}

export const generalSettingsStore = new GeneralSettingsStore();
