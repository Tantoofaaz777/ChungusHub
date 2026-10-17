<script lang="ts">
	/**
	 * The chats browser, raised from the composer hamburger ("Chats") or the welcome
	 * landing. Two scopes, one list, and the switch in the header picks between them:
	 * scoped to the open chat's character it shows that character's chats and New chat
	 * makes another one directly; scoped to everything it shows EVERY chat with per-row
	 * faces and the button hands off to the New chat flow.
	 *
	 * Four things here are deliberate and easy to undo by accident:
	 *
	 *  - `scopedCharacterId` is the only thing that decides what the list holds. The
	 *    switch writes the scope, that one derived reads it, and the list, the row faces
	 *    and the New chat button all read the derived, so the panel cannot end up
	 *    showing one thing while its button does another.
	 *  - The counts are two numbers, labelled. `path` is the branch you would read;
	 *    `total - path` is everything hanging off it. One unlabelled count is what makes
	 *    a list and its preview disagree by four.
	 *  - The preview starts empty, fills with the row the pointer touches, and HOLDS it.
	 *    Nothing but the list changing under it empties it again: the trip from a row to
	 *    the pane crosses the list's padding, its scrollbar and the section labels, so a
	 *    pane that clears on any of those is blank by the time the pointer lands in it,
	 *    and its action bar (the only copy of the row actions a mouse can reach) is
	 *    unusable.
	 *  - Rows are not in the tab order. The list is arrow-driven with a roving selection
	 *    (aria-activedescendant), and every row action also lives in the preview's action
	 *    bar, which IS tabbable, so nothing is reachable by mouse alone.
	 */
	import ChatBrowserControls from './ChatBrowserControls.svelte';
	import { chatTwinCounts, chatActivityAt, filterAndSortChats, type SortKey, type SortDir, type FilterMode } from '$lib/utils/chat-browser';
	import Icon from '$lib/components/ui/Icon.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import { holdMsForBlast } from '$lib/components/ui/HoldToConfirmButton.svelte';
	import ChatAvatars from './ChatAvatars.svelte';
	import ChatListRow from './ChatListRow.svelte';
	import ChatPreviewPane from './ChatPreviewPane.svelte';
	import DuplicateChatDialog from './DuplicateChatDialog.svelte';
	import { duplicateAsksAboutMemory } from '$lib/types/chat';
	import type { Chat, ChatListStats, ChatMemoryFootprint } from '$lib/types/chat';
	import { db } from '$lib/services/database';
	import { displaySelfRefs } from '$lib/macros';
	import { storyRoleName } from '$lib/types/library';
	import { dayBucket } from '$lib/utils/date';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { messageStore } from '$lib/stores/messages.svelte';
	import { uiStore, type ChatsScope } from '$lib/stores/ui.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { chatCastStore, type ChatCastMember } from '$lib/stores/chatCast.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { lorebookStore } from '$lib/lorebook/store.svelte';

	const BUCKET_LABELS: Record<string, string> = {
		today: 'Today',
		yesterday: 'Yesterday',
		week: 'Previous 7 days',
		month: 'Previous 30 days',
		older: 'Older'
	};

	let chats = $derived(chatStore.sortedChats);
	let activeChatId = $derived(chatStore.activeChatId);

	let isMobile = $derived(viewport.isMobile);

	// Whether the preview pane fits, decided by the PANEL's own width, not the
	// viewport's. The panel renders two ways (a fixed-width desktop modal and a
	// full-width mobile overlay), so a viewport media query describes neither: on a
	// 700px window the modal is 700px wide and `viewport.isMobile` is still false. Hiding
	// the pane with CSS `display: none` leaves it mounted, invisible, fetching a whole
	// chat on every row hover and holding the only tabbable copy of the row actions.
	// The two columns need 17rem + 20rem to breathe.
	const TWO_PANE_MIN = 640;
	let bodyWidth = $state(0);
	let singleColumn = $derived(bodyWidth > 0 ? bodyWidth < TWO_PANE_MIN : isMobile);

	// ===== Scope =====
	//
	// Two scopes, one list, and the switch in the header is what picks between them.
	// `scopedCharacterId` is the SINGLE value everything downstream reads (the list, the
	// face each row wears, the New chat button), so nothing can end up disagreeing with
	// what the switch says.
	//
	// The switch is gated on the library entry RESOLVING, not on the id: a chat orphaned
	// by a character deletion keeps a dangling id, and scoping to that narrows the list
	// to a character with no name, no face and nothing on screen saying why. Those chats
	// browse globally.
	let scope = $derived(uiStore.chatsScope);
	let scopeCharacter = $derived.by<ChatCastMember | null>(() => {
		const id = chatStore.activeChat?.characterId ?? null;
		if (!id) return null;
		const entry = characterLibraryStore.entries.find((e) => e.id === id);
		if (!entry) return null;
		return {
			libraryEntryId: entry.id,
			name: storyRoleName(entry.identity),
			imageUrl: entry.identity.imageUrl ?? null,
			portraitFocus: entry.identity.portraitFocus
		};
	});
	let scopedCharacterId = $derived(
		scope === 'character' && scopeCharacter ? scopeCharacter.libraryEntryId : null
	);

	function setScope(next: ChatsScope) {
		uiStore.chatsScope = next;
		// Hand the keyboard back to the field the list is driven from: a press that parks
		// focus on this button leaves the arrows dead (listKeysActive). Never on a phone,
		// where focusing the field throws the on-screen keyboard over the list.
		if (!viewport.isMobile) requestAnimationFrame(() => searchInputEl?.focus());
	}

	let searchQuery = $state('');
	let searchInMessages = $state(false);
	let sortKey = $state<SortKey>('activity');
	let sortDir = $state<SortDir>('desc');
	let sortMenuOpen = $state(false);
	let filterMode = $state<FilterMode>('all');
	let searchInputEl: HTMLInputElement | null = $state(null);
	let listEl: HTMLDivElement | null = $state(null);
	let selectedIndex = $state(0);
	// The selected-row highlight only shows while the keyboard is driving (arrows).
	// The mouse uses a plain CSS :hover so nothing stays highlighted after the cursor
	// leaves. Any hover flips this back off.
	let keyboardActive = $state(false);

	let hoveredChatId = $state<string | null>(null);
	let renamingChatId = $state<string | null>(null);
	let menu = $state<{ chatId: string; left: number; top: number; anchorTop: number } | null>(null);
	let litTwinGroup = $state<string | null>(null);

	// ===== Server-side aggregates =====

	let stats = $state<Record<string, ChatListStats>>({});
	let twinGroups = $state<Record<string, string>>({});

	$effect(() => {
		// Track the chat set so this re-runs on add/remove (duplicate, delete),
		// not just on mount. Concurrent refreshes can resolve out of order, so the
		// cancelled guard lets only the latest fetch publish the counts.
		void chatStore.chats.length;
		let cancelled = false;
		Promise.all([db.getChatListStats(), db.getChatContentGroups()])
			.then(([nextStats, nextGroups]) => {
				if (cancelled) return;
				stats = nextStats;
				twinGroups = nextGroups;
			})
			.catch((e) => console.error('Failed to load chat list stats:', e));
		return () => {
			cancelled = true;
		};
	});

	/** chatId → how many chats share its content. Absent = unique. Counted over the
	 *  chats the store still holds, not over the fingerprint map: the map is a server
	 *  aggregate read on its own schedule, so it can briefly hold a chat the list has
	 *  already dropped, and a twin must stop claiming a partner the moment the row
	 *  disappears. */
	let twinCounts = $derived(chatTwinCounts(chats, twinGroups));

	// ===== Search =====

	let messageHits = $state<Record<string, { hits: number; snippet: string }>>({});
	let searchingMessages = $state(false);

	// Message search costs a server pass over every active branch, so it waits for a
	// pause in typing. Title matching stays instant and local either way.
	$effect(() => {
		const query = searchQuery.trim();
		const deep = searchInMessages;
		if (!deep || !query) {
			messageHits = {};
			searchingMessages = false;
			return;
		}
		let cancelled = false;
		searchingMessages = true;
		const timer = setTimeout(() => {
			db.searchChatMessages(query)
				.then((hits) => {
					if (cancelled) return;
					messageHits = hits;
				})
				.catch((e) => console.error('Chat message search failed:', e))
				.finally(() => {
					if (!cancelled) searchingMessages = false;
				});
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	// ===== Scope, filter, sort =====

	// The unfiltered scope (drives the count under the title): the scoped character's
	// chats, or every chat there is.
	let scopedChats = $derived(
		scopedCharacterId ? chats.filter((c) => c.characterId === scopedCharacterId) : chats
	);

	let twinsInScope = $derived(scopedChats.some((c) => (twinCounts[c.id] ?? 0) > 1));

	/** One activity value for sorting, grouping and the row's timestamp alike: the last
	 *  message on the branch, falling back to the row's own updated_at for a chat that
	 *  has none. Two different values here would order the sections against the rows. */
	function activityAt(chat: Chat): number { return chatActivityAt(chat, stats); }

	let visibleChats = $derived(filterAndSortChats(scopedChats, {
		query: searchQuery, filter: filterMode, sort: sortKey, direction: sortDir,
		stats, twins: twinCounts, messageHits
	}));

	// Keep filtering, bulk selection and keyboard indexes over the complete result set.
	const CHAT_BATCH_SIZE = 50;
	let renderLimit = $state(CHAT_BATCH_SIZE);
	const renderedChats = $derived(visibleChats.slice(0, renderLimit));
	const hasMoreChats = $derived(renderedChats.length < visibleChats.length);
	function loadMoreChats() {
		renderLimit = Math.min(visibleChats.length, renderLimit + CHAT_BATCH_SIZE);
	}
	function scrollChats(event: Event) {
		const list = event.currentTarget as HTMLDivElement;
		if (hasMoreChats && list.scrollHeight - list.scrollTop - list.clientHeight < 200) loadMoreChats();
	}

	/** The same flat order, cut into labelled sections. Boundaries only ever fall between
	 *  runs, because the flat list is already ordered favorites-first then by the sort
	 *  key, so the keyboard's index and what's on screen can't drift apart. */
	let sections = $derived.by(() => {
		const timeGrouped = sortKey === 'activity' || sortKey === 'created';
		const out: { key: string; label: string | null; chats: Chat[] }[] = [];
		for (const chat of renderedChats) {
			let key = 'all';
			let label: string | null = null;
			if (chat.isFavorite && filterMode !== 'favorites') {
				key = 'favorites';
				label = 'Favorites';
			} else if (timeGrouped) {
				key = dayBucket(sortKey === 'created' ? chat.createdAt : activityAt(chat));
				label = BUCKET_LABELS[key];
			}
			const last = out[out.length - 1];
			if (last && last.key === key) last.chats.push(chat);
			else out.push({ key, label, chats: [chat] });
		}
		return out;
	});

	/** chatId → its position in the flat order. The sections render nested, but the
	 *  keyboard indexes the flat list, and looking each row up by scan would be
	 *  quadratic on every keystroke. */
	let indexById = $derived(new Map(visibleChats.map((chat, index) => [chat.id, index])));

	let isEmpty = $derived(visibleChats.length === 0);
	let hoveredChat = $derived(hoveredChatId ? (chats.find((c) => c.id === hoveredChatId) ?? null) : null);
	let hoveredCharacter = $derived(hoveredChat ? (chatCastStore.charactersForChat(hoveredChat.id)[0] ?? null) : null);
	// Preview speakers mirror the main chat: every user line is the chat's persona,
	// every assistant line is the chat's bound character.
	let hoveredPersona = $derived(hoveredChat ? chatCastStore.personaForChat(hoveredChat.id) : null);

	/** The face a row wears. In the global scope that's the bound character; inside one
	 *  character's list every row would wear the same face, so it shows the persona the
	 *  story is being written with instead, the one thing that actually differs. */
	function faceFor(chat: Chat): ChatCastMember | null {
		return scopedCharacterId
			? chatCastStore.personaForChat(chat.id)
			: (chatCastStore.charactersForChat(chat.id)[0] ?? null);
	}

	/** Context for a row that matched on message text, and nothing otherwise: browsing
	 *  rows carry a time, not a preview line. Self-refs resolve here, not in the row:
	 *  this is the only side that knows the chat's character and persona names
	 *  (coupling #6 in architecture/chat-sessions.md). */
	function hitSnippetFor(chat: Chat): string {
		const raw = messageHits[chat.id]?.snippet;
		if (!raw) return '';
		const charName = chatCastStore.charactersForChat(chat.id)[0]?.name?.trim() || 'Story';
		// The CHAT's persona, falling back to a neutral "You": the same pair the preview
		// pane resolves with, so one chat can't read two different names in one panel.
		const persona = chatCastStore.personaForChat(chat.id);
		const userName = persona?.name?.trim() || 'You';
		return displaySelfRefs(
			raw.replace(/\s+/g, ' ').trim(),
			charName,
			userName,
			persona ? persona.pronouns ?? {} : undefined
		);
	}

	// ===== Selection =====

	$effect(() => {
		searchQuery;
		sortKey;
		sortDir;
		filterMode;
		// A scope flip replaces the whole list, so it empties the held preview like any
		// other filter. Reading the resolved id rather than the switch also covers the
		// character disappearing from the library under an open panel.
		scopedCharacterId;
		searchInMessages;
		renderLimit = CHAT_BATCH_SIZE;
		if (listEl) listEl.scrollTop = 0;
		selectedIndex = 0;
		// The rows these two point at may not exist in the new list at all: a held
		// preview would go on showing a chat the query just filtered out.
		litTwinGroup = null;
		hoveredChatId = null;
	});

	// Keep the selection in range. The preview follows the selection while the keyboard
	// is driving; with the mouse, hover sets it and it stays on that row. An emptied
	// list has no row to hold, so the pane goes back to idle.
	$effect(() => {
		if (visibleChats.length === 0) {
			hoveredChatId = null;
			return;
		}
		const normalized = Math.min(Math.max(selectedIndex, 0), visibleChats.length - 1);
		if (normalized !== selectedIndex) selectedIndex = normalized;
		if (!keyboardActive) return;
		const selected = visibleChats[normalized];
		if (selected && hoveredChatId !== selected.id) hoveredChatId = selected.id;
	});

	// Land focused on the search box so the user can type immediately, but never on a
	// phone, where focusing a field throws the on-screen keyboard over half the list
	// somebody opened the panel to browse.
	$effect(() => {
		if (viewport.isMobile) return;
		requestAnimationFrame(() => searchInputEl?.focus());
	});

	/** The twin highlight is lit by a chip's mouseenter and put out by its mouseleave,
	 *  which never fires if that row unmounts under the pointer (a delete, a sync),
	 *  leaving the survivors glowing. Leaving the body puts it out either way. The
	 *  preview is deliberately NOT dropped here: this is the edge the pointer crosses
	 *  on its way to the pane's own buttons. */
	function clearTwinHighlight() {
		litTwinGroup = null;
	}

	function close() {
		uiStore.closeOverlay(() => lorebookStore.flush());
	}

	function selectChat(chatId: string) {
		chatStore.selectChat(chatId);
		close();
	}

	// The button follows the scope switch, because a list that says "every character"
	// cannot have a New chat button that silently means one of them. Scoped to a
	// character it means "another chat with them", created directly, greeting and all;
	// createChat opens it, which dismisses the panel. Scoped to everything there is no
	// character to inherit, so it hands off to the New chat flow instead (opening the
	// Library drops this overlay on its own).
	// The direct branch is refused mid-generation, same guard and same reason as the
	// composer's own New chat row: createChat opens the chat it makes, and the stream
	// appends into whichever chat state is current. The New chat branch only raises the
	// Library, so it takes no guard: the pick that eventually creates a chat is several
	// steps and a whole panel away.
	async function handleNewChat() {
		if (scopedCharacterId) {
			if (messageStore.warnIfBusy()) return;
			await chatStore.createChat({ characterId: scopedCharacterId });
			close();
		} else {
			uiStore.startNewChat(() => lorebookStore.flush());
		}
	}

	// ===== Row actions =====

	/** The panel is a backdrop-filtered, overflow-hidden surface, which makes it the
	 *  containing block for `position: fixed` children AND clips them, so a menu placed
	 *  from viewport coordinates has to leave the panel entirely. Same reason and same
	 *  shape as the message editor's action menu. Body-portaled nodes also sit outside
	 *  the workspace element, so Workspace's click-away leaves them alone. */
	function portalToBody(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	function openRowMenu(chatId: string, anchor: DOMRect) {
		if (menu?.chatId === chatId) {
			menu = null;
			return;
		}
		// Placed below the button, then corrected against its REAL height once it has
		// rendered (see the effect below): a guessed height either flips a menu that had
		// room or leaves a flipped one hanging in the air above its own button.
		const width = 190;
		const left = Math.max(EDGE, Math.min(anchor.right - width, window.innerWidth - width - EDGE));
		menu = { chatId, left, top: anchor.bottom + 6, anchorTop: anchor.top };
	}

	const EDGE = 8;
	let menuEl: HTMLElement | null = $state(null);

	$effect(() => {
		const el = menuEl;
		const current = menu;
		if (!el || !current) return;
		const height = el.offsetHeight;
		const fits = current.top + height + EDGE <= window.innerHeight;
		const top = fits ? current.top : Math.max(EDGE, current.anchorTop - height - 6);
		// Only write when it actually moves: this effect reads `menu`, so an
		// unconditional write would loop.
		if (Math.abs(top - current.top) > 0.5) menu = { ...current, top };
	});

	// A menu whose chat vanished (a sync, or another device's delete) leaves nothing on
	// screen but still swallows the next Escape.
	$effect(() => {
		if (menu && !chats.some((c) => c.id === menu?.chatId)) menu = null;
	});

	function startRename(chatId: string) {
		menu = null;
		renamingChatId = chatId;
	}

	/** Closing the rename field would otherwise drop focus onto <body>, leaving the
	 *  keyboard with nothing to drive. */
	function endRename() {
		renamingChatId = null;
		requestAnimationFrame(() => searchInputEl?.focus());
	}

	async function commitRename(chatId: string, title: string) {
		endRename();
		await chatStore.updateChatTitle(chatId, title);
	}

	async function toggleFavorite(chatId: string) {
		menu = null;
		await chatStore.toggleChatFavorite(chatId);
	}

	// ===== Delete =====

	let deleteTarget = $state<Chat | null>(null);
	// The dialog states the real numbers of what goes, from the stats already loaded for
	// the rows; past the hold threshold the confirm becomes a press-and-hold (the
	// destructive-act ladder, architecture/ui-shell-settings.md). Deletion is immediate
	// and final once confirmed: there is no undo anywhere in the app.
	let deleteStats = $derived(deleteTarget ? (stats[deleteTarget.id] ?? null) : null);
	let deleteMessage = $derived.by(() => {
		if (!deleteTarget) return '';
		const name = `"${deleteTarget.title}"`;
		if (!deleteStats) return `Delete ${name} and every message in it? This cannot be undone.`;
		const n = deleteStats.total;
		const branches = n > deleteStats.path ? ', branches included' : '';
		return `Delete ${name} and its ${n} message${n === 1 ? '' : 's'}${branches}? This cannot be undone.`;
	});

	function deleteChat(chatId: string) {
		menu = null;
		deleteTarget = chats.find((c) => c.id === chatId) ?? null;
	}

	function confirmDeleteChat() {
		const target = deleteTarget;
		deleteTarget = null;
		if (target) void chatStore.deleteChat(target.id);
	}

	// ===== Selecting several =====
	//
	// The reason this exists is the shape of a cleanup, not a missing feature: clearing out
	// twenty old chats one row at a time is twenty menus and twenty confirms, and no amount
	// of lowering the delete ladder fixes the repetition around it. Picked as a set, the
	// whole batch is one confirm stating one real total.

	let selecting = $state(false);
	let selectedIds = $state<Set<string>>(new Set());
	let bulkDeleteOpen = $state(false);

	let selectedChats = $derived(chats.filter((c) => selectedIds.has(c.id)));
	let selectedCount = $derived(selectedChats.length);
	let allVisibleSelected = $derived(
		visibleChats.length > 0 && visibleChats.every((c) => selectedIds.has(c.id))
	);

	function toggleSelecting() {
		selecting = !selecting;
		if (!selecting) selectedIds = new Set();
	}

	function toggleSelect(chatId: string) {
		const next = new Set(selectedIds);
		if (!next.delete(chatId)) next.add(chatId);
		selectedIds = next;
	}

	function selectAllVisible() {
		// All means every filtered result (the count shown in the control), including
		// rows not mounted yet. Rendering a prefix must never narrow a bulk selection.
		selectedIds = new Set([...selectedIds, ...visibleChats.map((c) => c.id)]);
	}

	// The confirm carries both figures, because the one that hurts is the second: nobody
	// counts the messages inside twenty chats before agreeing to lose them.
	let bulkDeleteStats = $derived(
		selectedChats.reduce((n, c) => n + (stats[c.id]?.total ?? 0), 0)
	);
	let bulkDeleteMessage = $derived(
		`Delete ${selectedCount} chat${selectedCount === 1 ? '' : 's'} and ${bulkDeleteStats} message${bulkDeleteStats === 1 ? '' : 's'} in total? This cannot be undone.`
	);

	async function confirmBulkDelete() {
		const ids = [...selectedIds];
		bulkDeleteOpen = false;
		selectedIds = new Set();
		selecting = false;
		await chatStore.deleteChats(ids);
	}

	// ===== Duplicate =====

	let duplicateTarget = $state<{ chat: Chat; footprint: ChatMemoryFootprint } | null>(null);
	// True for the whole flow, memory lookup included, not just the copy itself. Two
	// fast clicks would otherwise run two copies concurrently, both naming themselves
	// against a list that holds neither yet: two rows called "X (copy)", which is exactly
	// what the counting in copyTitle exists to prevent.
	let duplicating = $state(false);

	function reportDuplicateFailure(chat: Chat, e: unknown) {
		console.error('Duplicate failed:', e);
		// The one failure worth explaining: the source's memory still points at messages
		// that have been deleted, a state the chat repairs itself the next time it is
		// opened (architecture/memory.md). Anything else gets the plain message.
		const stale = e instanceof Error && e.message.includes('mem-copy-stale');
		if (stale) {
			toastStore.error(
				`"${chat.title}" has memory pointing at deleted messages. Open the chat once to let it repair itself, or duplicate the story on its own.`
			);
		} else {
			toastStore.failed(`duplicate "${chat.title}"`, e);
		}
	}

	/** Only ever asks about memory when there is memory to ask about: a chat with none
	 *  is copied on the spot. */
	async function handleDuplicate(chatId: string) {
		menu = null;
		if (duplicating) return;
		const chat = chats.find((c) => c.id === chatId);
		if (!chat) return;
		duplicating = true;
		try {
			const footprint = await db.getChatMemoryFootprint(chatId);
			if (!duplicateAsksAboutMemory(footprint)) {
				await runDuplicate(chat, false);
				return;
			}
			duplicateTarget = { chat, footprint };
		} catch (e) {
			reportDuplicateFailure(chat, e);
		} finally {
			// Released here so the dialog's own buttons are live; the copy re-raises it.
			duplicating = false;
		}
	}

	async function runDuplicate(chat: Chat, includeMemory: boolean) {
		duplicating = true;
		try {
			await chatStore.duplicateChat(chat.id, { includeMemory });
			toastStore.success(includeMemory ? 'Chat duplicated with its memory' : 'Chat duplicated');
			// The selection is deliberately left where it was: the copy's position is not
			// knowable yet (it settles when the refreshed stats give it its real activity
			// time), and moving the cursor to a guessed index is worse than not moving it.
			duplicateTarget = null;
		} catch (e) {
			reportDuplicateFailure(chat, e);
		} finally {
			duplicating = false;
		}
	}

	// ===== Keyboard =====

	function scrollToSelected() {
		requestAnimationFrame(() => {
			listEl?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
		});
	}

	function moveSelection(next: number) {
		if (visibleChats.length === 0) return;
		// Mount the destination before the scheduled scroll and aria-activedescendant update.
		renderLimit = Math.max(renderLimit, Math.min(visibleChats.length, Math.ceil((next + 1) / CHAT_BATCH_SIZE) * CHAT_BATCH_SIZE));
		keyboardActive = true;
		selectedIndex = next;
		hoveredChatId = visibleChats[next]?.id ?? null;
		scrollToSelected();
	}

	/** Whether the list keys belong to the list right now. They are bound on the window,
	 *  so without this a press meant for whatever has focus is stolen: Enter on the
	 *  preview's Delete button would open the selected chat instead of pressing Delete,
	 *  and the panel's own "every action is reachable by keyboard" promise would be a
	 *  lie. Focus normally sits in the search field (the combobox half of this pair);
	 *  anything else interactive owns its own keys. Escape is deliberately NOT gated:
	 *  it closes layers, and every layer wants it. */
	function listKeysActive(): boolean {
		const el = document.activeElement;
		if (!el || el === document.body || el === searchInputEl) return true;
		return !el.closest('button, a, input, select, textarea, [contenteditable="true"], [role="menuitem"]');
	}

	/** Standard "open the context menu for the focused thing" keys, so the row menu is
	 *  reachable without a pointer: the row buttons stay out of the tab order, which
	 *  would otherwise mean tabbing through every chat to reach one. */
	function openMenuForSelection() {
		const chat = visibleChats[selectedIndex];
		if (!chat) return;
		const button = listEl?.querySelector<HTMLElement>(`#chat-option-${CSS.escape(chat.id)} .chat-row-action`);
		if (button) openRowMenu(chat.id, button.getBoundingClientRect());
	}

	function handleKeydown(e: KeyboardEvent) {
		if (uiStore.activeOverlay !== 'chats') return;
		// A modal Dialog owns the keyboard while its portal is mounted and closes itself
		// on Escape. Same guard Workspace and LorebookView use, or one press would shut
		// the dialog AND the panel behind it.
		if (document.querySelector('.dialog-portal:not([inert])')) return;
		// While a rename field is open it owns the keyboard; the row's own handler stops
		// those keys before they reach here, so this only guards the stragglers.
		const renaming = renamingChatId !== null;

		if (e.key === 'Escape') {
			e.preventDefault();
			if (menu) menu = null;
			else if (sortMenuOpen) sortMenuOpen = false;
			else if (renaming) endRename();
			// A typed query is a layer too: clear it before dropping the whole panel, so
			// one stray press doesn't cost both the search and the place you were in.
			else if (searchQuery) searchQuery = '';
			// Last before the panel itself, because a selection built across a scroll is the
			// most expensive thing on this screen to lose to a stray press.
			else if (selecting) toggleSelecting();
			else close();
			return;
		}
		if (renaming || !listKeysActive()) return;

		if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
			e.preventDefault();
			openMenuForSelection();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			moveSelection((selectedIndex + 1) % visibleChats.length);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			moveSelection(selectedIndex <= 0 ? visibleChats.length - 1 : selectedIndex - 1);
		} else if ((e.key === 'Home' || e.key === 'End') && !searchQuery) {
			// Only with an empty field: focus lives in the search box, and taking Home/End
			// away from someone editing a query to jump a list they can already wrap
			// around with the arrows is a bad trade.
			e.preventDefault();
			moveSelection(e.key === 'Home' ? 0 : visibleChats.length - 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const chat = visibleChats[selectedIndex];
			// Enter does whatever the row's own click does, or the keyboard and the mouse
			// would mean two different things about the same row.
			if (chat && selecting) toggleSelect(chat.id);
			else if (chat) selectChat(chat.id);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="chats-view">
	<header class="chats-header">
		<!-- The shared chat-area overlay header row. The subject names the PANEL and
		     never the character, because whose chats these are is what the scope
		     switch below says. A header that shape-shifted into the character's
		     name would say it a second time, and only for one of the two scopes. -->
		<div class="overlay-header chats-identity-row">
			<div class="overlay-crumb">
				<h2 class="overlay-subject">Chats</h2>
				<span class="overlay-facts">
					{#if visibleChats.length !== scopedChats.length}
						{visibleChats.length} of {scopedChats.length} chats
					{:else}
						{scopedChats.length} chat{scopedChats.length === 1 ? '' : 's'}
					{/if}
				</span>
			</div>

			<div class="overlay-actions">
				<button type="button" class="chats-new-button" onclick={handleNewChat}>
					<Icon name="plus" class="w-4 h-4" />
					New chat
				</button>
			</div>
		</div>

		<!-- The scope switch, on its own line because it decides WHAT the row below
		     filters rather than being another filter itself. Rendered only when there is
		     a character to name: with none, one half would be permanently dead and the
		     other permanently on, which is a label dressed up as a choice. -->
		{#if scopeCharacter}
			<div class="chats-scope" role="group" aria-label="Which chats to list">
				<button
					type="button"
					class="chats-scope-btn"
					class:is-active={scope === 'character'}
					aria-pressed={scope === 'character'}
					onclick={() => setScope('character')}
				>
					<!-- The face is decoration here: its own label would make the button
					     announce the name twice. The tooltip it keeps is the only way to read
					     a name the label has ellipsised. -->
					<span class="chats-scope-face" aria-hidden="true">
						<ChatAvatars members={[scopeCharacter]} size={22} max={1} />
					</span>
					<span class="chats-scope-label">{scopeCharacter.name.trim() || 'This character'}</span>
				</button>
				<button
					type="button"
					class="chats-scope-btn"
					class:is-active={scope === 'all'}
					aria-pressed={scope === 'all'}
					onclick={() => setScope('all')}
				>
					<Icon name="globe" class="w-4 h-4 shrink-0" />
					<span class="chats-scope-label">All chats</span>
				</button>
			</div>
		{/if}

		<ChatBrowserControls
			bind:searchQuery bind:searchInMessages bind:sortKey bind:sortDir bind:sortMenuOpen
			bind:filterMode bind:searchInputEl
			{twinsInScope} {selecting} {toggleSelecting} {selectedCount} {allVisibleSelected} {searchingMessages}
			visibleCount={visibleChats.length} {selectAllVisible}
			clearSelection={() => (selectedIds = new Set())}
			requestDelete={() => (bulkDeleteOpen = true)}
			listboxId="chats-listbox"
			activeDescendant={keyboardActive && visibleChats[selectedIndex] ? `chat-option-${visibleChats[selectedIndex].id}` : undefined}
		/>

	</header>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="chats-body"
		class:chats-body-single={singleColumn}
		bind:clientWidth={bodyWidth}
		onmouseleave={clearTwinHighlight}
	>
		<div class="chats-list-pane">
			<div
				bind:this={listEl}
				id="chats-listbox"
				class="chats-scroll chats-list panel-scroll"
				onscroll={scrollChats}
				role="listbox"
				tabindex="-1"
				aria-label="Chats"
			>
				{#if isEmpty}
					<div class="chats-empty">
						<Icon name="chat" class="w-8 h-8 mb-3 opacity-60" />
						<p class="chats-empty-text">
							{#if searchQuery && searchingMessages}
								Searching messages…
							{:else if searchQuery}
								No chats match "{searchQuery}"
							{:else if filterMode === 'favorites'}
								No favorites yet
							{:else if filterMode === 'duplicates'}
								No identical chats
							{:else}
								No chats yet
							{/if}
						</p>
						{#if searchQuery && !searchInMessages}
							<button type="button" class="chats-empty-action" onclick={() => (searchInMessages = true)}>
								Search inside messages too
							</button>
						{:else if filterMode !== 'all'}
							<button type="button" class="chats-empty-action" onclick={() => (filterMode = 'all')}>
								Show all chats
							</button>
						{/if}
					</div>
				{:else}
					{#each sections as section (section.key)}
						{#if section.label}
							<!-- Hidden from the tree: a heading is not a listbox child, and the
							     group below carries the same text as its accessible name. -->
							<div class="chats-section-label" aria-hidden="true">
								{#if section.key === 'favorites'}
									<Icon name="heart" class="w-3 h-3 fill-current" />
								{/if}
								{section.label}
							</div>
						{/if}
						<div class="chats-section-body" role="group" aria-label={section.label ?? 'Chats'}>
							{#each section.chats as chat (chat.id)}
								{@const index = indexById.get(chat.id) ?? 0}
								<ChatListRow
									{chat}
									position={index + 1}
									total={visibleChats.length}
									stats={stats[chat.id] ?? null}
									member={faceFor(chat)}
									isActive={chat.id === activeChatId}
									isSelected={keyboardActive && index === selectedIndex}
									twinCount={twinCounts[chat.id] ?? 0}
									twinHighlighted={!!litTwinGroup && twinGroups[chat.id] === litTwinGroup}
									snippet={hitSnippetFor(chat)}
									renaming={renamingChatId === chat.id}
									menuOpen={menu?.chatId === chat.id}
									{selecting}
									checked={selectedIds.has(chat.id)}
									onToggleSelect={() => toggleSelect(chat.id)}
									onOpen={() => selectChat(chat.id)}
									onHover={() => {
										keyboardActive = false;
										selectedIndex = index;
										hoveredChatId = chat.id;
									}}
									onMenu={(anchor) => openRowMenu(chat.id, anchor)}
									onRenameCommit={(title) => commitRename(chat.id, title)}
									onRenameCancel={endRename}
									onTwinHover={(on) => (litTwinGroup = on ? (twinGroups[chat.id] ?? null) : null)}
								/>
							{/each}
						</div>
					{/each}
				{/if}
			</div>
			{#if hasMoreChats}
				<div class="chats-more">
					<button type="button" class="chats-empty-action" onclick={loadMoreChats}>Load more chats</button>
					<span>{renderedChats.length.toLocaleString()} / {visibleChats.length.toLocaleString()}</span>
				</div>
			{/if}
		</div>

		{#if !singleColumn}
			<div class="chats-preview-pane">
				<ChatPreviewPane
					chat={hoveredChat}
					stats={hoveredChat ? (stats[hoveredChat.id] ?? null) : null}
					character={hoveredCharacter}
					persona={hoveredPersona}
					onOpen={() => hoveredChat && selectChat(hoveredChat.id)}
					onRename={() => hoveredChat && startRename(hoveredChat.id)}
					onDuplicate={() => hoveredChat && handleDuplicate(hoveredChat.id)}
					onToggleFavorite={() => hoveredChat && toggleFavorite(hoveredChat.id)}
					onDelete={() => hoveredChat && deleteChat(hoveredChat.id)}
				/>
			</div>
		{/if}
	</div>

	<!-- Keyboard hints are for keyboards: on a phone the row is dead weight that only
	     adds a horizontal scrollbar. -->
	{#if !isMobile}
		<footer class="chats-footer">
			<span><kbd>Up/Down</kbd> navigate</span>
			<span><kbd>Enter</kbd> open</span>
			<span><kbd>Home/End</kbd> jump</span>
			<span><kbd>Menu</kbd> actions</span>
			<span><kbd>Esc</kbd> close</span>
		</footer>
	{/if}
</div>

{#if menu}
	{@const menuChat = chats.find((c) => c.id === menu?.chatId)}
	{#if menuChat}
		<div
			use:portalToBody
			class="chats-scrim chats-scrim-portaled"
			onclick={() => (menu = null)}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					menu = null;
				}
			}}
			role="button"
			tabindex="-1"
			aria-label="Close menu"
		></div>
		<div
			bind:this={menuEl}
			use:portalToBody
			class="chats-row-menu surface-float"
			role="menu"
			style="left: {menu.left}px; top: {menu.top}px;"
		>
			<button type="button" role="menuitem" class="chats-menu-item" onclick={() => selectChat(menuChat.id)}>
				<Icon name="chat" class="w-4 h-4" />
				<span>Open</span>
			</button>
			<button type="button" role="menuitem" class="chats-menu-item" onclick={() => startRename(menuChat.id)}>
				<Icon name="pencil" class="w-4 h-4" />
				<span>Rename</span>
			</button>
			<button type="button" role="menuitem" class="chats-menu-item" onclick={() => handleDuplicate(menuChat.id)}>
				<Icon name="copy" class="w-4 h-4" />
				<span>Duplicate…</span>
			</button>
			<button type="button" role="menuitem" class="chats-menu-item" onclick={() => toggleFavorite(menuChat.id)}>
				<Icon name="heart" class="w-4 h-4 {menuChat.isFavorite ? 'fill-current' : ''}" />
				<span>{menuChat.isFavorite ? 'Remove from favorites' : 'Add to favorites'}</span>
			</button>
			<div class="chats-menu-sep"></div>
			<button
				type="button"
				role="menuitem"
				class="chats-menu-item is-danger"
				onclick={() => deleteChat(menuChat.id)}
			>
				<Icon name="trash" class="w-4 h-4" />
				<span>Delete</span>
			</button>
		</div>
	{/if}
{/if}

<ConfirmDialog
	open={deleteTarget !== null}
	title="Delete chat"
	message={deleteMessage}
	confirmLabel="Delete"
	variant="danger"
	destructive
	holdMs={holdMsForBlast(deleteStats?.total ?? 0)}
	onConfirm={confirmDeleteChat}
	onCancel={() => (deleteTarget = null)}
/>

<ConfirmDialog
	open={bulkDeleteOpen}
	title="Delete {selectedCount} chat{selectedCount === 1 ? '' : 's'}"
	message={bulkDeleteMessage}
	confirmLabel="Delete {selectedCount}"
	variant="danger"
	destructive
	holdMs={holdMsForBlast(bulkDeleteStats)}
	onConfirm={confirmBulkDelete}
	onCancel={() => (bulkDeleteOpen = false)}
/>

{#if duplicateTarget}
	<DuplicateChatDialog
		open={true}
		title={duplicateTarget.chat.title}
		footprint={duplicateTarget.footprint}
		busy={duplicating}
		onConfirm={(includeMemory) => duplicateTarget && runDuplicate(duplicateTarget.chat, includeMemory)}
		onCancel={() => {
			// Escape and the backdrop reach this too, so the busy check belongs here and
			// not only on the Cancel button: dismissing a copy that is already running
			// wouldn't stop it, it would just hide it.
			if (!duplicating) duplicateTarget = null;
		}}
	/>
{/if}

<style>
	.chats-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		/* Transparent so the frosted overlay surface with the workspace behind shows through. */
		background: transparent;
	}

	/* The controls row below the identity carries the bottom seam, so the shared
	   header keeps only its own padding here. */
	.chats-header {
		flex-shrink: 0;
		padding: 0.8rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.chats-identity-row {
		/* Deliberately compact: this header stacks two more rows below the identity
		   (scope switch, search), and the controls row carries the seam, so the
		   shared recipe's uniform height would only push them down. */
		min-height: 0;
		padding: 0 0 0.7rem;
		border-bottom: 0;
	}

	.chats-new-button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.9rem;
		flex-shrink: 0;
		border: 0;
		border-radius: var(--radius-lg);
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition: background-color 140ms ease;
	}

	.chats-new-button:hover {
		background: var(--color-accent-hover);
	}

	/* ===== Scope switch ===== */
	/* A segmented track on the app's canonical recipe (.seg / .seg-lift in app.css),
	   scoped rather than shared because those segments are fixed-width icon squares
	   and these are two labelled halves splitting the panel. */
	.chats-scope {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2px;
		margin-bottom: 0.6rem;
		padding: 3px;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-bg-tertiary) 80%, transparent);
	}

	.chats-scope-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		min-width: 0;
		padding: 0.35rem 0.6rem;
		border: 0;
		border-radius: calc(var(--radius-lg) - 3px);
		background: transparent;
		color: var(--color-text-muted);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 140ms ease, color 140ms ease;
	}

	.chats-scope-btn:hover {
		color: var(--color-text-primary);
	}

	/* The canonical lifted chip. */
	.chats-scope-btn.is-active {
		background: var(--color-bg-primary);
		color: var(--color-accent);
		box-shadow: var(--shadow-sm);
	}

	.chats-scope-face {
		display: inline-flex;
		flex-shrink: 0;
		line-height: 0;
	}

	/* A long character name gives way rather than pushing its half of the track wide. */
	.chats-scope-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ===== Body ===== */
	.chats-body {
		flex: 1;
		display: grid;
		grid-template-columns: minmax(17rem, 0.95fr) minmax(20rem, 1.2fr);
		min-height: 0;
	}

	/* Mobile: the preview pane isn't rendered at all, so the list takes the row. */
	.chats-body-single {
		grid-template-columns: 1fr;
	}

	.chats-body-single .chats-list-pane {
		border-right: 0;
	}

	.chats-list-pane {
		border-right: 1px solid var(--color-border-subtle);
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.chats-list {
		flex: 1;
		padding: 0.35rem 0.35rem 0.6rem;
		outline: none;
	}

	.chats-more { display:flex; align-items:center; justify-content:center; gap:.5rem; flex-shrink:0; padding:.4rem .5rem; color:var(--color-text-muted); font-size:.72rem; border-top:1px solid var(--color-border-subtle); }
	.chats-more .chats-empty-action { margin-top:0; }

	.chats-preview-pane {
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: color-mix(in srgb, var(--color-bg-secondary) 30%, transparent);
	}

	.chats-section-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin: 0.5rem 0 0.2rem;
		padding: 0 0.6rem;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}

	.chats-section-label:first-child {
		margin-top: 0.15rem;
	}

	.chats-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 1rem;
		text-align: center;
	}

	.chats-empty-text {
		max-width: 100%;
		font-family: var(--font-ui);
		font-size: 0.85rem;
		color: var(--color-text-muted);
		/* The query is echoed here, and a long unbroken one would push the panel wide. */
		overflow-wrap: anywhere;
	}

	.chats-empty-action {
		margin-top: 0.7rem;
		padding: 0.35rem 0.7rem;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-lg);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.76rem;
		font-weight: 600;
		cursor: pointer;
		transition: color 120ms ease, border-color 120ms ease;
	}

	.chats-empty-action:hover {
		color: var(--color-text-primary);
		border-color: var(--color-border);
	}

	/* ===== Menus ===== */
	/* Click-away layer shared by the sort menu and the per-row menu. */
	.chats-scrim {
		position: fixed;
		inset: 0;
		z-index: 10;
	}

	/* The portaled pair sits on <body>, above every panel. It shares the composer's token
	   popup ceiling for the same reason (architecture/chat-sessions.md). */
	.chats-scrim-portaled {
		z-index: 1000;
	}

	/* Fixed and portaled: the row it belongs to lives in a scroll container inside a
	   backdrop-filtered panel, which both clips fixed children and makes itself their
	   containing block (the message editor's Save menu has the same problem). */
	.chats-row-menu {
		position: fixed;
		z-index: 1001;
		width: 190px;
		padding: 0.3rem;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}

	.chats-menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.chats-menu-item span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chats-menu-item:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.chats-menu-item.is-danger:hover {
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
		color: var(--color-error);
	}

	.chats-menu-sep {
		height: 1px;
		margin: 0.25rem 0.3rem;
		background: var(--color-border-subtle);
	}

	/* ===== Footer ===== */
	.chats-footer {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.55rem 0.8rem;
		border-top: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-bg-secondary) 48%, transparent);
		overflow-x: auto;
		font-family: var(--font-ui);
		font-size: 0.7rem;
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.chats-footer kbd {
		font-family: inherit;
		padding: 0.1rem 0.35rem;
		margin-right: 0.25rem;
		background: var(--color-bg-tertiary);
		border-radius: var(--radius-sm);
		font-size: 10px;
	}

	.chats-scroll::-webkit-scrollbar {
		width: 6px;
	}

	.chats-scroll::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: 9999px;
	}

	.chats-scroll::-webkit-scrollbar-thumb:hover {
		background: var(--color-text-muted);
	}

	@media (pointer: coarse) {
		.chats-scope-btn {
			padding: 0.6rem;
		}
	}
</style>
