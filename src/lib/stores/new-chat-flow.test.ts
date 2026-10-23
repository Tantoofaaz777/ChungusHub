/**
 * The New chat flow state machine (uiStore): arm → pick character → pick persona,
 * with its cancel edges (closing the Library, panel mutual exclusion, nav-blocker
 * vetoes). Run with `bun test`.
 *
 * Runes are compile-time macros and nothing compiles the store under bun test, so
 * `$state` is shimmed to identity BEFORE the store module loads (dynamic import
 * below). That turns the rune classes into plain classes, exactly right for
 * pinning state-machine transitions, useless for reactivity (not under test).
 * Only `$state` is shimmed on purpose: if ui.svelte.ts ever grows `$derived` or
 * `$effect`, this file fails loudly instead of testing stale values.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

(globalThis as unknown as { $state: <T>(v?: T) => T | undefined }).$state = (v) => v;

const { uiStore } = await import('./ui.svelte');

function resetUi() {
	uiStore.setSinglePanel(false);
	uiStore.activeOverlay = null;
	uiStore.welcomeOpen = false;
	uiStore.settingsOpen = false;
	uiStore.settingsLocked = false;
	uiStore.libraryOpen = false;
	uiStore.libraryLocked = false;
	uiStore.libraryTab = 'characters';
	uiStore.libraryEditorId = null;
	uiStore.pendingLibraryEntryId = null;
	uiStore.debugPanelOpen = false;
	uiStore.clearNewChat();
}

let registeredBlocker: (() => boolean) | null = null;

function blockNavigation() {
	registeredBlocker = () => true;
	uiStore.registerNavBlocker(registeredBlocker);
}

beforeEach(resetUi);

afterEach(() => {
	uiStore.setSinglePanel(false);
	if (registeredBlocker) {
		uiStore.clearNavBlocker(registeredBlocker);
		registeredBlocker = null;
	}
});

describe('startNewChat', () => {
	test('arms the flow and stages the Library on Characters', () => {
		uiStore.startNewChat();

		expect(uiStore.newChatStep).toBe('character');
		expect(uiStore.newChatCharacterId).toBeNull();
		expect(uiStore.libraryOpen).toBe(true);
		expect(uiStore.libraryTab).toBe('characters');
		expect(uiStore.libraryEditorId).toBeNull();
	});

	test('flips back from the Personas tab, flushing, and dismisses an open editor', () => {
		uiStore.libraryTab = 'personas';
		uiStore.libraryEditorId = 'entry-1';
		let flushes = 0;

		uiStore.startNewChat(() => flushes++);

		expect(uiStore.libraryTab).toBe('characters');
		expect(uiStore.libraryEditorId).toBeNull();
		expect(flushes).toBe(1);
	});

	test('restarting after a pick forgets the previous character', () => {
		uiStore.startNewChat();
		uiStore.advanceNewChat('char-1');

		uiStore.startNewChat();

		expect(uiStore.newChatStep).toBe('character');
		expect(uiStore.newChatCharacterId).toBeNull();
	});

	test('takes over from the Chats overlay (the global view hand-off)', () => {
		uiStore.activeOverlay = 'chats';
		let flushes = 0;

		uiStore.startNewChat(() => flushes++);

		expect(uiStore.activeOverlay).toBeNull();
		expect(uiStore.libraryOpen).toBe(true);
		expect(uiStore.newChatStep).toBe('character');
		expect(flushes).toBe(1);
	});

	test('a nav-blocker veto leaves everything untouched and pulses the guard', () => {
		blockNavigation();
		const pulseBefore = uiStore.guardPulse;

		uiStore.startNewChat();

		expect(uiStore.newChatStep).toBeNull();
		expect(uiStore.libraryOpen).toBe(false);
		expect(uiStore.guardPulse).toBe(pulseBefore + 1);
	});
});

describe('advanceNewChat', () => {
	test('locks the pick and moves to the persona step', () => {
		uiStore.startNewChat();
		uiStore.libraryEditorId = 'entry-1';

		uiStore.advanceNewChat('char-1');

		expect(uiStore.newChatStep).toBe('persona');
		expect(uiStore.newChatCharacterId).toBe('char-1');
		expect(uiStore.libraryTab).toBe('personas');
		expect(uiStore.libraryEditorId).toBeNull();
	});

	test('re-picking a character mid-flow replaces the pick', () => {
		uiStore.startNewChat();
		uiStore.advanceNewChat('char-1');
		uiStore.libraryTab = 'characters'; // user wanders back by hand

		uiStore.advanceNewChat('char-2');

		expect(uiStore.newChatStep).toBe('persona');
		expect(uiStore.newChatCharacterId).toBe('char-2');
		expect(uiStore.libraryTab).toBe('personas');
	});

	test('a nav-blocker veto keeps the flow on its current step', () => {
		uiStore.startNewChat();
		blockNavigation();

		uiStore.advanceNewChat('char-1');

		expect(uiStore.newChatStep).toBe('character');
		expect(uiStore.newChatCharacterId).toBeNull();
		expect(uiStore.libraryTab).toBe('characters');
	});
});

describe('cancel edges', () => {
	test('clearNewChat ends the flow without touching the panel', () => {
		uiStore.startNewChat();
		uiStore.advanceNewChat('char-1');

		uiStore.clearNewChat();

		expect(uiStore.newChatStep).toBeNull();
		expect(uiStore.newChatCharacterId).toBeNull();
		expect(uiStore.libraryOpen).toBe(true);
	});

	test('closing the Library abandons the wizard', () => {
		uiStore.startNewChat();
		uiStore.advanceNewChat('char-1');

		uiStore.closeLibrary();

		expect(uiStore.libraryOpen).toBe(false);
		expect(uiStore.newChatStep).toBeNull();
		expect(uiStore.newChatCharacterId).toBeNull();
	});

	test('another panel dropping the unlocked Library cancels the flow', () => {
		uiStore.startNewChat();

		uiStore.openSettings();

		expect(uiStore.settingsOpen).toBe(true);
		expect(uiStore.libraryOpen).toBe(false);
		expect(uiStore.newChatStep).toBeNull();
	});

	test('a locked Library carries the wizard through other panels opening', () => {
		uiStore.startNewChat();
		uiStore.libraryLocked = true;

		uiStore.openSettings();

		expect(uiStore.settingsOpen).toBe(true);
		expect(uiStore.libraryOpen).toBe(true);
		expect(uiStore.newChatStep).toBe('character');
	});

	test('the desktop rail replaces even a legacy pinned panel with the next panel', () => {
		uiStore.setSinglePanel(true);
		uiStore.libraryLocked = true; uiStore.settingsLocked = true;
		uiStore.startNewChat();
		uiStore.openSettings();
		expect(uiStore.libraryOpen).toBe(false);
		expect(uiStore.newChatStep).toBeNull();
		expect(uiStore.settingsOpen).toBe(true);
		uiStore.openOverlay('memory');
		expect(uiStore.settingsOpen).toBe(false);
		expect(uiStore.activeOverlay).toBe('memory');
		uiStore.openDebugPanel();
		expect(uiStore.activeOverlay).toBeNull();
		expect(uiStore.debugPanelOpen).toBe(true);
		uiStore.openLibrary();
		expect(uiStore.debugPanelOpen).toBe(false);
		expect(uiStore.libraryOpen).toBe(true);
	});

	test('switching to the desktop layout retains the Library and its unsaved editor', () => {
		uiStore.libraryLocked = true;
		uiStore.openLibrary(); uiStore.libraryEditorId = 'unsaved-card';
		uiStore.openSettings();
		uiStore.setSinglePanel(true);
		expect(uiStore.libraryOpen).toBe(true);
		expect(uiStore.libraryEditorId).toBe('unsaved-card');
		expect(uiStore.settingsOpen).toBe(false);
		blockNavigation();
		uiStore.openOverlay('threads');
		expect(uiStore.activeOverlay).toBeNull();
		expect(uiStore.libraryOpen).toBe(true);
	});
});
