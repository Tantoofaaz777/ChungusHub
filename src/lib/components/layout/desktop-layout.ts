export type SidebarSide = 'left' | 'right';
export const DEFAULT_PANEL_WIDTH = 420;
export const MIN_PANEL_WIDTH = 300;
export const MIN_CHAT_WIDTH = 400;
export const MAX_PANEL_WIDTH = 960;

export function panelBounds(workspaceWidth: number) {
	const max = Math.max(0, Math.min(MAX_PANEL_WIDTH, workspaceWidth - MIN_CHAT_WIDTH));
	return { min: Math.min(MIN_PANEL_WIDTH, max), max };
}

export function clampPanelWidth(width: number, workspaceWidth: number): number {
	const { min, max } = panelBounds(workspaceWidth);
	return Math.round(Math.min(max, Math.max(min, Number.isFinite(width) ? width : DEFAULT_PANEL_WIDTH)));
}

export function normalizeDesktopLayout(raw: unknown): { side: SidebarSide; panelWidth: number } {
	const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
	return {
		side: value.side === 'right' ? 'right' : 'left',
		panelWidth: typeof value.panelWidth === 'number' && Number.isFinite(value.panelWidth)
			? Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, value.panelWidth)))
			: DEFAULT_PANEL_WIDTH
	};
}
