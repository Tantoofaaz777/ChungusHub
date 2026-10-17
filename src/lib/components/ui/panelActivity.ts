import { getContext, setContext } from 'svelte';

const PANEL_ACTIVITY = Symbol('panel-activity');
/** Read inside effects/handlers: hidden retained panels must not poll or own global keys. */
export function panelActivity(): () => boolean {
	return getContext<() => boolean>(PANEL_ACTIVITY) ?? (() => true);
}
export function providePanelActivity(active: () => boolean): void {
	setContext(PANEL_ACTIVITY, active);
}
