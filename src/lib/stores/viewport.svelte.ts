/**
 * Reactive viewport flags. Fine-pointer desktops use a single adjustable dock
 * from 64rem onward. The older layout described below remains for touch-first
 * devices; `canDockSettings` includes either desktop or legacy docking.
 * Legacy docking is true only when the window is
 * wide enough to host the Settings panel in the margin beside the centered chat
 * column without eating into the transcript. Below that, Settings falls back to
 * the centered overlay.
 *
 * 76rem is derived, not tuned: while there is room the screen splits in halves
 * (chat one half, the two docks the other); once a quarter would put a dock under
 * `--dock-hold` the docks stop shrinking and the chat absorbs the narrowing, so
 * the breakpoint is `--chat-col-min + 2 × --dock-hold`, the width at which that
 * squeezing reaches the chat's own floor. app.css spells the same equation on
 * `--chat-col-docked` (assigned to `--chat-col-max` inside that branch) and caps
 * the column at `100vw - 28rem`, which is what makes this plain media query
 * truthful at every chat-width setting instead of needing a geometry check here.
 * Change the two together. Deliberately rem, not px: the threshold
 * then tracks browser zoom and the user's browser font size the same way the
 * column itself does. And note it is measured against the browser's viewport,
 * which on a laptop is a good 50px narrower than the screen resolution.
 */
const DOCK_QUERY = '(min-width: 76rem)';
// The app's phone-width breakpoint. It is deliberately separate from the dock query:
// a 1400px laptop remains desktop even when no side dock is open.
const MOBILE_QUERY = '(max-width: 640px)';
// "Is there a physical keyboard behind this pointer?" This is deliberately NOT the
// width query: a narrowed desktop window still has one, a 1024px tablet doesn't.
// Everything keyboard-only keys off this (Enter-to-send in both composers, the
// shortcuts row in Settings), so it lives here rather than as a const per file.
const TOUCH_QUERY = '(pointer: coarse)';
// Phones and touch-first tablets keep their current top bar, including in landscape.
const DESKTOP_QUERY = '(min-width: 64rem) and (hover: hover) and (pointer: fine)';

class Viewport {
	private legacyDock = $state(false);
	get canDockSettings() { return this.desktopLayout || this.legacyDock; }
	isMobile = $state(false);
	isTouch = $state(false);
	desktopLayout = $state(false);

	constructor() {
		if (typeof window === 'undefined') return;
		const desktop = window.matchMedia(DESKTOP_QUERY);
		this.desktopLayout = desktop.matches;
		desktop.addEventListener('change', (e) => { this.desktopLayout = e.matches; });
		const dock = window.matchMedia(DOCK_QUERY);
		this.legacyDock = dock.matches;
		dock.addEventListener('change', (e) => {
			this.legacyDock = e.matches;
		});
		const mobile = window.matchMedia(MOBILE_QUERY);
		this.isMobile = mobile.matches;
		mobile.addEventListener('change', (e) => {
			this.isMobile = e.matches;
		});
		const touch = window.matchMedia(TOUCH_QUERY);
		this.isTouch = touch.matches;
		touch.addEventListener('change', (e) => {
			this.isTouch = e.matches;
		});
	}
}

export const viewport = new Viewport();
