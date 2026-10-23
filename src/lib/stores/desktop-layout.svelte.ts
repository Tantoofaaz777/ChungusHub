import { DEFAULT_PANEL_WIDTH, normalizeDesktopLayout, type SidebarSide } from '$lib/components/layout/desktop-layout';

const STORAGE_KEY = 'chungushub-desktop-layout';

class DesktopLayoutStore {
	side = $state<SidebarSide>('left');
	panelWidth = $state(DEFAULT_PANEL_WIDTH);

	constructor() {
		if (typeof window === 'undefined') return;
		try {
			const saved = normalizeDesktopLayout(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
			this.side = saved.side;
			this.panelWidth = saved.panelWidth;
		} catch { /* Private browsing or invalid storage falls back to the default layout. */ }
	}

	setSide(side: SidebarSide) {
		this.side = side;
		this.persist();
	}

	setPanelWidth(width: number) {
		this.panelWidth = normalizeDesktopLayout({ panelWidth: width }).panelWidth;
		this.persist();
	}

	private persist() {
		try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ side: this.side, panelWidth: this.panelWidth })); }
		catch { /* Resizing still works when browser storage is unavailable. */ }
	}
}

export const desktopLayoutStore = new DesktopLayoutStore();
