/**
 * The settings information architecture, in ONE place: the root groups and rows
 * (a phone-style drill-down, with no icon tab rail) and the per-row live
 * previews shown on the root.
 *
 * Hand-kept couplings:
 *  - Previews read singleton stores/services; the root re-renders on every
 *    page return (keyed), so they refresh without being reactive.
 *  - A page added here needs its arm in `SettingsPageView.svelte`, or its row
 *    opens an empty panel.
 */
import { llmService } from '$lib/services/llm/provider';
import { connectionStore } from '$lib/stores/connections.svelte';
import { ENGINES } from '$lib/engines/registry';
import { backupStore } from '$lib/stores/backups.svelte';
import { advancedSettingsStore } from '$lib/stores/advanced-settings.svelte';
import { APP_VERSION } from '$lib/version';

export type SettingsPage =
	// Connection
	| 'connections'
	// Appearance
	| 'interface'
	| 'chat'
	// App
	| 'general'
	| 'engines'
	| 'security'
	| 'import'
	| 'backups'
	// Advanced
	| 'prompt-builder'
	| 'regex'
	| 'advanced'
	// About
	| 'about'
	| 'developer';

/** Literal subset of ui/Icon's IconName (not exported there), all verified members. */
export type SettingsRowIcon =
	| 'radar'
	| 'sun'
	| 'columns'
	| 'image'
	| 'settings'
	| 'bolt'
	| 'shield'
	| 'wrench'
	| 'filter'
	| 'flask'
	| 'download'
	| 'archive'
	| 'info'
	| 'sliders';

export interface SettingsRow {
	page: SettingsPage;
	label: string;
	icon: SettingsRowIcon;
	/** Live value shown on the root row; omit for rows with no one-line summary. */
	preview?: () => string;
	/** A row that is not always there. Omit for the permanent ones. Read on every render of
	 *  the root list, so a row can come and go while the list is on screen (split view). */
	shown?: () => boolean;
}

export interface SettingsGroup {
	label: string;
	rows: SettingsRow[];
}

function connectionsSummary(): string {
	const id = llmService.getPrimaryModel();
	const model = id ? (id.split('/').pop() ?? id) : 'No model';
	const count = connectionStore.list().length;
	return count > 1 ? `${model} · ${count} connections` : model;
}

function enginesSummary(): string {
	const on = ENGINES.filter((e) => e.enabled.get()).length;
	return `${on} of ${ENGINES.length} on`;
}

/**
 * Reads the settings half only. The listing is server state the page fetches when it opens,
 * and the root row must not be the thing that goes and gets it, since every return to the root
 * re-renders these previews, which would make walking around Settings poll the backup store.
 */
function backupsSummary(): string {
	const { automatic, intervalHours } = backupStore.settings;
	if (!automatic) return 'Automatic backups off';
	if (intervalHours === 6) return 'Every 6 hours';
	return intervalHours === 24 ? 'Once a day' : 'Once a week';
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
	{
		label: 'Connection',
		rows: [{ page: 'connections', label: 'Connections', icon: 'radar', preview: connectionsSummary }]
	},
	{
		label: 'App',
		rows: [
			{ page: 'general', label: 'General', icon: 'settings' },
			{ page: 'engines', label: 'Engines', icon: 'bolt', preview: enginesSummary },
			{ page: 'security', label: 'Security', icon: 'shield' },
			{ page: 'backups', label: 'Backups', icon: 'archive', preview: backupsSummary },
			{ page: 'import', label: 'Import', icon: 'download' }
		]
	},
	{
		label: 'Appearance',
		rows: [
			{ page: 'interface', label: 'Interface', icon: 'sun' },
			{ page: 'chat', label: 'Chat', icon: 'columns' }
		]
	},
	{
		label: 'Advanced',
		rows: [
			{ page: 'prompt-builder', label: 'Prompt Builder', icon: 'wrench' },
			{ page: 'regex', label: 'Regex', icon: 'filter' },
			{ page: 'advanced', label: 'Advanced', icon: 'flask' }
		]
	},
	{
		label: 'About',
		rows: [
			{ page: 'about', label: 'About', icon: 'info', preview: () => APP_VERSION },
			{
				page: 'developer',
				label: 'Developer',
				icon: 'sliders',
				shown: () => advancedSettingsStore.developerMode
			}
		]
	}
];
