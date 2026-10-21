<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { promptTokensStore } from '$lib/stores/promptTokens.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import ChatSetupChip from './ChatSetupChip.svelte';
	import ChatPersonaDialog from './ChatPersonaDialog.svelte';
	import AuthorsNotesDialog from './AuthorsNotesDialog.svelte';
	import { chatAuthorsNote } from '$lib/types/chat';
	import TransformPanel from './TransformPanel.svelte';
	import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
	import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
	import { chatStore } from '$lib/stores/chat.svelte';
	import { chatSearch } from '$lib/stores/chatSearch.svelte';
	import { chatCursor } from '$lib/stores/chatCursor.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { messageStore } from '$lib/stores/messages.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { inputDraftStore } from '$lib/stores/inputDraft.svelte';
	import { inputHistoryStore } from '$lib/stores/inputHistory.svelte';
	import { generalSettingsStore } from '$lib/stores/general-settings.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { chatPersonaEntry } from '$lib/utils/chat-setup';
	import { relativeClock } from '$lib/utils/time-format.svelte';
	import { llmService } from '$lib/services/llm/provider';
	import { imageService, imageRejectionReason, isImageFile } from '$lib/services/imageService';
	import { duplicateAsksAboutMemory } from '$lib/types/chat';
	import type { Chat, ChatMemoryFootprint, MessageAttachment } from '$lib/types/chat';
	import SteeringPopover from '$lib/components/chat/SteeringPopover.svelte';
	import CommandPalette from './CommandPalette.svelte';
	import DuplicateChatDialog from '$lib/components/sidebar/DuplicateChatDialog.svelte';
	import { db } from '$lib/services/database';
	import { steeringStore } from '$lib/stores/steering.svelte';
	import { noteLabel, steeringTargetForChat } from '$lib/types/steering';
	import {
		COMMAND_GROUPS,
		argSatisfied,
		commandByName,
		matchCommands,
		parseCommandInput,
		runCommand,
		type CommandContext,
		type CommandDef,
		type CommandHost
	} from '$lib/commands/registry';

	interface Props {
		/** `onCommit` fires once the send is certain to proceed, which is what empties the box. */
		onSend: (content: string, attachments?: MessageAttachment[], onCommit?: () => void) => void;
		onCancel?: () => void;
		onInsertDummy?: (role: 'user' | 'assistant') => void;
		onContinue?: () => void;
		onRegenerateLast?: () => void;
		/** Retry's non-destructive half, reached only by `/swipe`. */
		onSwipeLast?: () => void;
		/** A generation is in flight anywhere in the app, which is the composer's whole busy
		 *  state: Send becomes Stop, and every row that would start or rewrite a turn goes
		 *  dead. */
		isStreaming?: boolean;
		/** When a reply this page never started began, or null. The composer is busy either
		 *  way; this is the case where nothing else on screen says why, since there is no
		 *  stream here to paint. */
		generatingSince?: number | null;
	}

	let {
		onSend,
		onCancel,
		onInsertDummy,
		onContinue,
		onRegenerateLast,
		onSwipeLast,
		isStreaming = false,
		generatingSince = null
	}: Props = $props();

	// Typing is harmless while a reply is being written, and a reader who came back to one they
	// cannot even see has the most reason to want the box: they are deciding whether to wait it
	// out or stop it, and a dead box makes that decision in the corner. Only the rows that would
	// START a turn stay disabled, and Send is already Stop. (A reply this page is writing keeps
	// the older rule, where the tokens arriving are the thing to look at.)
	let draftLocked = $derived(isStreaming && generatingSince === null);

	// How long it has run is the whole point of the line: it is what tells a model that is
	// merely slow apart from an endpoint that has stopped answering, and that judgement is
	// the reader's to make. Floored, and never finer than a minute: a second-by-second count
	// invites watching rather than deciding.
	let generatingLine = $derived.by(() => {
		if (generatingSince === null) return '';
		const minutes = Math.floor(Math.max(0, relativeClock.now - generatingSince) / 60_000);
		if (minutes < 1) return 'A reply is generating for this chat.';
		if (minutes < 60) return `A reply has been generating for ${minutes} minute${minutes === 1 ? '' : 's'}.`;
		const hours = Math.floor(minutes / 60);
		return `A reply has been generating for ${hours} hour${hours === 1 ? '' : 's'}.`;
	});

	let content = $state('');
	$effect(() => {
		promptTokensStore.draft = { chatId: chatStore.activeChatId, text: content };
	});
	let textareaElement: HTMLTextAreaElement;

	let menuOpen = $state(false);
	let personaDialogOpen = $state(false);

	// The persona currently bound to this chat's user turns (from any user message,
	// since they're uniform once set). Feeds the picker's active mark; null reads as "You".
	let currentChatPersonaId = $derived.by(() => {
		const msgs = chatStore.currentChatState?.allMessages ?? [];
		return msgs.find((m) => m.role === 'user')?.personaId ?? null;
	});

	function openPersonaDialog() {
		menuOpen = false;
		personaDialogOpen = true;
	}

	// Back to the welcome landing. This is a real exit, not just raising the layer: the
	// chat closes to the boot zero state (memory shows no chat).
	// Refused mid-generation: the stream writes into the state this tears down.
	function handleGoHome() {
		menuOpen = false;
		if (messageStore.warnIfBusy()) return;
		void chatStore.goHome();
	}

	// The Chats browser. With a chat open it lists this character's chats and can
	// start another one. The composer menu is its only entry point from inside a story.
	function handleOpenChats() {
		menuOpen = false;
		uiStore.openChats();
	}

	// Another chat with this story's character, greeting and all: the Chats panel's own
	// New chat button without the trip through the panel. Refused mid-generation for the
	// same reason Home is: createChat opens the chat it makes, which swaps out the state
	// the stream writes into. The row is disabled without a resolvable character, so the
	// throw is unreachable and stays loud rather than minting a characterless chat.
	function handleNewChat() {
		menuOpen = false;
		if (messageStore.warnIfBusy()) return;
		const entry = activeCharacterEntry;
		if (!entry) throw new Error('New chat: this story has no library character');
		void chatStore.createChat({ characterId: entry.id });
	}

	// Raises the find-in-chat bar over the message list (MessageList owns the mount).
	// Never disabled: reading back through the story is legal mid-stream.
	function handleFindInChat() {
		menuOpen = false;
		chatSearch.show();
	}

	// The chat's bound character, its lorebook, and the global persona: the world
	// context that the preset macros expand against.
	let activeCharacterEntry = $derived.by(() => {
		const cid = chatStore.activeChat?.characterId;
		if (!cid) return null;
		return characterLibraryStore.entries.find((e) => e.id === cid && e.type === 'character') ?? null;
	});

	let activePath = $derived(chatStore.currentChatState?.activePath ?? []);
	let authorsNotesOpen = $state(false);
	let authorsNotesActive = $derived(!!chatAuthorsNote(chatStore.activeChat).trim());

	// The popover that edits the notes lives in its own component.
	let steeringTarget = $derived(steeringTargetForChat(chatStore.activeChat));
	let activeSteering = $derived(steeringStore.activeFor(steeringTarget));
	let steeringActive = $derived(activeSteering.length > 0);
	let steeringTitle = $derived.by(() => {
		if (activeSteering.length === 0) return 'Steering: guide the next reply';
		const first = noteLabel(activeSteering[0]);
		if (activeSteering.length === 1) return `Steering: ${first}`;
		return `Steering: ${first} (+${activeSteering.length - 1} more)`;
	});

	let chatPersona = $derived(chatPersonaEntry(chatStore.activeChat));

	// ===== Persisted draft (per chat, survives reloads and device switches) =====

	// Restore the saved draft when a chat opens or switches. The previous chat's
	// pending write is keyed to its own id in the store, so nothing is lost here.
	let draftChatId: string | null = null;
	$effect(() => {
		const chatId = chatStore.activeChatId;
		if (chatId === draftChatId) return;
		draftChatId = chatId;
		historyPos = null;
		content = '';
		// Chat switched under the composer: close the steering popover and any transform
		// dialog, since both edit the OLD chat's state. A pending steering debounce self-flushes
		// via its own timer (it captured its chat id at schedule time). Command mode goes with
		// them: its gates were resolved against the chat that just left the screen.
		steeringOpen = false;
		authorsNotesOpen = false;
		transformKind = null;
		commandArmed = false;
		if (!chatId) return;
		void inputDraftStore.load(chatId).then(async (draft) => {
			// An empty box may have just SENT the draft. Reject reads superseded by
			// a send, typing or a newer load, even when they resolved before this callback.
			if (chatStore.activeChatId !== chatId || !draft?.content ||
				!inputDraftStore.isCurrent(draft) || content !== '') return;
			content = draft.content;
			await tick();
			handleInput();
		});
	});

	// The keyboard coming back from the story: Escape with nothing left to close, or stepping
	// down past the newest turn (architecture/chat-sessions.md, "The message cursor"). Read
	// against the nonce this component started at, or the box would grab focus on mount and
	// every chat open would pop a phone's keyboard.
	let seenComposerNonce = chatCursor.composerNonce;
	$effect(() => {
		const nonce = chatCursor.composerNonce;
		if (nonce === seenComposerNonce) return;
		seenComposerNonce = nonce;
		textareaElement?.focus();
	});

	// A draft changed on another device: adopt it, unless the user is mid-typing
	// here (an empty box always takes the remote text).
	$effect(() => {
		const remote = inputDraftStore.remote;
		if (!remote) return;
		untrack(() => {
			inputDraftStore.remote = null; // consume: each push applies at most once
			if (!inputDraftStore.isCurrent(remote)) return;
			if (remote.chatId !== chatStore.activeChatId) return;
			if (document.activeElement === textareaElement && content !== '') return;
			if (remote.content === content) return;
			content = remote.content;
			void tick().then(() => handleInput());
		});
	});

	function scheduleDraftSave() {
		const chatId = chatStore.activeChatId;
		if (chatId) inputDraftStore.schedule(chatId, content);
	}

	// ===== Input history (↑/↓ recalls previously sent messages) =====

	// The store holds everything ever sent (capped); the chat scope setting is
	// only a filter over it. Consecutive duplicates collapse for navigation.
	let sentHistory = $derived.by(() => {
		const chatOnly = generalSettingsStore.inputHistoryScope === 'chat';
		const chatId = chatStore.activeChatId;
		const items: string[] = [];
		for (const entry of inputHistoryStore.entries) {
			if (chatOnly && entry.chatId !== chatId) continue;
			if (items[items.length - 1] !== entry.content) items.push(entry.content);
		}
		return items;
	});

	// Index into sentHistory while navigating; null = not in history mode. Editing
	// the recalled text (any input event) leaves history mode.
	let historyPos = $state<number | null>(null);

	function navigateHistory(direction: -1 | 1): boolean {
		if (viewport.isTouch || !generalSettingsStore.inputHistory) return false;
		const history = sentHistory;
		let next: number;
		if (historyPos === null) {
			// Only an empty composer enters history mode, so ↑ never fights the
			// caret moving through multi-line text.
			if (direction !== -1 || content !== '' || !history.length) return false;
			next = history.length - 1;
		} else {
			next = historyPos + direction;
			if (next < 0) return true; // already at the oldest, so swallow the key
			if (next >= history.length) {
				// Walked past the newest: leave history mode with an empty box.
				historyPos = null;
				applyRecall('');
				return true;
			}
		}
		historyPos = next;
		applyRecall(history[next]);
		return true;
	}

	function applyRecall(text: string) {
		content = text;
		scheduleDraftSave();
		void tick().then(() => {
			handleInput();
			textareaElement?.setSelectionRange(text.length, text.length);
		});
	}

	function handleInsertDummy(role: 'user' | 'assistant') {
		menuOpen = false;
		onInsertDummy?.(role);
	}

	let lastTurn = $derived(activePath[activePath.length - 1] ?? null);

	// Continue extends the newest turn in place, so it only makes sense when that turn is an
	// AI reply. The button for it lives on that reply (MessageActions); what is left here is
	// the gate `/continue` runs behind.
	let canContinue = $derived(lastTurn?.role === 'assistant' && !lastTurn.excludedFromPrompt);

	// Same target as Continue (the newest turn), but what it does depends on whose turn that is:
	// a reply gets re-rolled, your own turn gets the reply it doesn't have yet. One store call
	// covers both, because 'replace' on a user turn finds nothing below to delete and goes
	// straight to generating. Reached by ⌘/Ctrl+Enter and `/retry`, both behind this gate.
	let canRegenerateLast = $derived.by(() => {
		const last = lastTurn;
		if (!last) return false;
		if (last.role === 'assistant') return last.parentId !== null || featurePromptsStore.openingSceneEnabled;
		return last.role === 'user';
	});

	let regenerateLastHint = $derived(
		!canRegenerateLast
			? 'The newest turn must be a reply, or a turn of yours with no reply yet'
			: lastTurn?.role === 'user'
				? 'Generate a reply to your last turn'
				: 'Replace the last response and all its swipes'
	);

	// The right arrow and /swipe add an alternative without removing existing responses.
	let canSwipeLast = $derived.by(() => {
		const last = lastTurn;
		if (!last) return false;
		if (last.role === 'assistant') return last.parentId !== null || featurePromptsStore.openingSceneEnabled;
		return last.role === 'user';
	});

	// ===== Steering (guidance injected into the prompt, never into the chat) =====

	// The panel is SteeringPopover's job; what stays here is the trigger's open state and
	// the commit-and-flush-on-close, so no outside interaction can build a prompt against a
	// note edit still sitting in the store's debounce window, or against a quick-box line
	// the user typed and never got to commit.
	let steeringOpen = $state(false);
	let steeringPopover = $state<SteeringPopover | null>(null);

	function closeSteering() {
		// Before the unmount, not after: the popover's quick box is component state.
		steeringPopover?.commitQuick();
		steeringOpen = false;
		void steeringStore.flush();
	}

	function toggleSteering() {
		if (steeringOpen) closeSteering();
		else steeringOpen = true;
	}

	function manageSteeringLibrary() {
		closeSteering();
		uiStore.gotoSettingsPage('engines');
		uiStore.settingsEngineId = 'steering';
		uiStore.pendingSteeringLibrary = true;
		uiStore.openSettings();
	}

	// ===== Persona quick switch =====

	// ===== Composer transforms (Spellcheck / Impersonate) =====

	// The strip that opens above the composer owns the run; what stays here is which one is
	// open and what that does to the box underneath it. While a proposal is on screen the
	// composer is frozen: the proposal is against the draft as it stood at the press, so
	// approving over an edited box would throw that edit away without saying so.
	let transformKind = $state<'spellcheck' | 'impersonate' | null>(null);
	let transformOriginal = $state('');
	let transformOpen = $derived(transformKind !== null);

	function startTransform(kind: 'spellcheck' | 'impersonate') {
		menuOpen = false;
		transformOriginal = content;
		transformKind = kind;
	}

	// Approve path: the original goes into the ↑ input history first, so even an
	// approved replacement stays recoverable. Rejecting never touches the box at all.
	async function applyTransform(proposed: string) {
		inputHistoryStore.record(chatStore.activeChatId, transformOriginal);
		transformKind = null;
		content = proposed;
		scheduleDraftSave();
		await tick();
		handleInput();
		textareaElement?.focus();
	}

	// ===== Commands =====

	// Typing "/" into an EMPTY composer arms command mode: from there the box is filling in a
	// call rather than holding a message, which is what lets an argument be the rest of the
	// line verbatim with nothing to escape. Arming only from empty is what keeps a story line
	// that happens to contain a slash out of the mode (what counts as empty is decided at the
	// arming site in handleComposerInput, and it includes attachments), and Escape or a line
	// naming no command drops straight back to prose, so the box is never a trap.
	let commandArmed = $state(false);
	let commandIndex = $state(0);

	let parsedCommand = $derived(commandArmed ? parseCommandInput(content) : null);
	let commandMatches = $derived(parsedCommand ? matchCommands(parsedCommand) : []);
	// The palette hides itself when nothing matches, so an unrecognised line behaves exactly
	// like prose: Enter sends it. There is no dead state to back out of.
	let commandOpen = $derived(commandMatches.length > 0);
	let activeCommand = $derived(commandMatches[Math.min(commandIndex, commandMatches.length - 1)] ?? null);
	// Headings are for BROWSING, so they appear only on a bare "/" where the list is the whole
	// vocabulary. The moment a letter is typed the list is a ranked answer, and grouping it
	// would reorder that ranking back into registry order: the best match would render under a
	// heading below a worse one, with the highlight on a row that is not the first on screen.
	let paletteGrouped = $derived(parsedCommand !== null && !parsedCommand.settled && parsedCommand.name === '');
	let paletteGroups = $derived(
		paletteGrouped
			? COMMAND_GROUPS.map((group) => ({
					id: group.id as string,
					label: group.label,
					commands: commandMatches.filter((c) => c.group === group.id)
				})).filter((group) => group.commands.length > 0)
			: [{ id: 'ranked', label: '', commands: commandMatches }]
	);

	const commandHost: CommandHost = {
		continueMessage: () => onContinue?.(),
		regenerateLast: () => onRegenerateLast?.(),
		swipeLast: () => onSwipeLast?.(),
		requestDuplicate: () => void startDuplicate()
	};

	// The gates a command runs behind are the composer's OWN deriveds, handed over rather than
	// recomputed: a command and the menu row that does the same thing then read one answer, so
	// neither can end up more permissive than the other.
	let commandContext = $derived<CommandContext>({
		chatId: chatStore.activeChatId,
		characterEntryId: activeCharacterEntry?.id ?? null,
		personaEntryId: chatPersona?.id ?? null,
		lastTurnId: lastTurn?.id ?? null,
		canContinue,
		canRegenerateLast,
		canSwipeLast,
		regenerateLastHint,
		host: commandHost
	});

	/** Why a row cannot run, for the row's own line. */
	function refusalFor(command: CommandDef): string | null {
		return command.unavailable?.(commandContext) ?? null;
	}

	/**
	 * Whether Enter (and the Send button, which is the same door) would actually do something.
	 *
	 * The button sits over the box in both modes, so it has to answer this: one that looks
	 * live over a name still being typed, a refused command or a missing argument is a press
	 * that silently does nothing, which is the exact failure the disabled state exists for.
	 */
	let commandReady = $derived.by(() => {
		const parsed = parsedCommand;
		if (!commandOpen || !parsed) return false;
		if (!parsed.settled) {
			// Completing the name IS an action, so an argument-taking command counts here.
			return activeCommand !== null && refusalFor(activeCommand) === null;
		}
		const picked = commandByName(parsed.name);
		return picked !== null && refusalFor(picked) === null && argSatisfied(picked, parsed.arg);
	});

	function moveCommandSelection(delta: 1 | -1) {
		const count = commandMatches.length;
		if (!count) return;
		commandIndex = (Math.min(commandIndex, count - 1) + delta + count) % count;
	}

	/** Put the name in the box and leave the caret where the argument goes. */
	async function completeCommandName(command: CommandDef) {
		content = `/${command.name}${command.arg ? ' ' : ''}`;
		commandIndex = 0;
		await tick();
		handleInput();
		textareaElement?.focus();
		textareaElement?.setSelectionRange(content.length, content.length);
	}

	async function executeCommand(command: CommandDef, arg: string) {
		// The mode ends on the press, not on the work: the command is accepted or refused here
		// and runs on its own from there, so a long one never leaves the box locked around a
		// half-typed line.
		const ok = runCommand(command, arg, commandContext);
		// A refusal leaves the line alone: the text is still the fastest way to fix it.
		if (!ok) return;
		content = '';
		commandArmed = false;
		commandIndex = 0;
		historyPos = null;
		if (chatStore.activeChatId) inputDraftStore.clear(chatStore.activeChatId);
		await tick();
		handleInput();
	}

	/** A click on a palette row: finish naming it, or run it when it is already named. */
	function pickCommand(command: CommandDef) {
		if (refusalFor(command)) return;
		const parsed = parsedCommand;
		if (command.arg && !(parsed?.settled && commandByName(parsed.name) === command)) {
			void completeCommandName(command);
			return;
		}
		void executeCommand(command, parsed?.settled ? parsed.arg : '');
	}

	/**
	 * Enter in command mode. An unfinished name completes rather than guessing, and a command
	 * still missing its required argument does nothing at all: the row on screen already says
	 * what it wants, and a toast on every keystroke-in-progress would be noise.
	 */
	function submitCommand() {
		const parsed = parsedCommand;
		if (!parsed) return;
		if (!parsed.settled) {
			const picked = activeCommand;
			if (!picked || refusalFor(picked)) return;
			if (picked.arg) void completeCommandName(picked);
			else void executeCommand(picked, '');
			return;
		}
		const picked = commandByName(parsed.name);
		if (!picked || refusalFor(picked) || !argSatisfied(picked, parsed.arg)) return;
		void executeCommand(picked, parsed.arg);
	}

	// ===== Duplicate this chat =====

	// `/duplicate` raises the Chats panel's own dialog rather than copying on the spot, so the
	// one question a copy cannot answer for itself (does the memory come too?) is asked here as
	// well. It differs from the panel in one deliberate way: this door lands you IN the copy,
	// because the command was typed from inside the story and that is where the next turn goes.
	let duplicateTarget = $state<{ chat: Chat; footprint: ChatMemoryFootprint } | null>(null);
	let duplicating = $state(false);

	async function startDuplicate() {
		const chat = chatStore.activeChat;
		if (!chat || duplicating) return;
		// The copy opens the chat it makes, which swaps out the state a stream writes into.
		if (messageStore.warnIfBusy()) return;
		duplicating = true;
		try {
			const footprint = await db.getChatMemoryFootprint(chat.id);
			if (!duplicateAsksAboutMemory(footprint)) {
				await runDuplicate(chat, false);
				return;
			}
			duplicateTarget = { chat, footprint };
		} catch (error) {
			toastStore.failed(`duplicate "${chat.title}"`, error);
		} finally {
			// Released here so the dialog's own buttons are live; the copy re-raises it.
			duplicating = false;
		}
	}

	async function runDuplicate(chat: Chat, includeMemory: boolean) {
		duplicating = true;
		try {
			const newChatId = await chatStore.duplicateChat(chat.id, { includeMemory });
			duplicateTarget = null;
			await chatStore.selectChat(newChatId);
			toastStore.success(includeMemory ? 'Chat duplicated with its memory' : 'Chat duplicated');
		} catch (error) {
			toastStore.failed(`duplicate "${chat.title}"`, error);
		} finally {
			duplicating = false;
		}
	}

	// ===== Image attachments =====

	let pendingImages = $state<{ path: string; url: string }[]>([]);
	let uploadingImages = $state(0);

	async function attachImageFiles(files: File[]): Promise<void> {
		const images: File[] = [];
		for (const file of files) {
			const refused = imageRejectionReason(file);
			if (refused) toastStore.error(refused);
			else images.push(file);
		}
		if (!images.length) return;
		// Attaching is always possible; whether the images actually ride the prompt
		// depends on the provider/model + the Send images setting, so say so up front
		// instead of silently dropping them at generation time.
		if (!llmService.sendsImages()) {
			toastStore.warning(
				'This model does not take images, or sending images is off. The picture stays in the chat but never reaches the model.'
			);
		}
		uploadingImages += images.length;
		for (const file of images) {
			try {
				const path = await imageService.saveImage(file, 'chat');
				const url = imageService.thumbnailUrl(path) ?? (await imageService.getImageUrl(path)) ?? '';
				pendingImages = [...pendingImages, { path, url }];
			} catch (error) {
				toastStore.failed(`attach "${file.name}"`, error);
			} finally {
				uploadingImages -= 1;
			}
		}
	}

	function handlePaste(e: ClipboardEvent) {
		const files = Array.from(e.clipboardData?.files ?? []).filter(isImageFile);
		if (files.length) {
			e.preventDefault();
			void attachImageFiles(files);
		}
	}

	// ===== Dropping a picture on the composer =====
	// Pictures only. A story turn has nowhere to put a text file, so one dropped here is
	// refused by name rather than silently ignored, which would read as the drop having failed.

	/** Depth-counted so a drag crossing a child element doesn't flicker the overlay off. */
	let dragDepth = $state(0);

	function handleDragEnter(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('Files')) return;
		dragDepth += 1;
	}

	function handleDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('Files')) return;
		// Without this the browser navigates away to the dropped file.
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	}

	function handleDragLeave() {
		dragDepth = Math.max(0, dragDepth - 1);
	}

	function handleDrop(e: DragEvent) {
		const dropped = Array.from(e.dataTransfer?.files ?? []);
		dragDepth = 0;
		if (!dropped.length) return;
		e.preventDefault();
		const images = dropped.filter(isImageFile);
		for (const file of dropped.filter((f) => !isImageFile(f))) {
			toastStore.error(`"${file.name}" is not a picture. Chat messages only accept pictures.`);
		}
		if (images.length) void attachImageFiles(images);
	}

	function removePendingImage(path: string) {
		pendingImages = pendingImages.filter((img) => img.path !== path);
		// The upload is already on the server; drop the file too so abandoned
		// attachments don't pile up in images/chat/.
		void imageService.deleteImage(path);
	}

	function handleSubmit() {
		// The Send button is the palette's other door, which is what makes command mode work
		// on touch, where Enter is a newline.
		if (commandOpen) {
			submitCommand();
			return;
		}
		// Enter reaches here with the box still typable while a reply this page did not start
		// is being written, and a press that consumed the key and produced neither a send nor
		// a newline would just look broken. The store owns the sentence, so the composer and
		// every other refused mutation say the same thing.
		if (isStreaming && messageStore.warnIfBusy()) return;
		const trimmed = content.trim();
		if ((trimmed || pendingImages.length) && !isStreaming && !uploadingImages) {
			const attachments: MessageAttachment[] = pendingImages.map((img) => ({ kind: 'image', path: img.path }));
			// The box empties when the send COMMITS, not when it is asked for. With a prompt
			// hold on this gate those are different moments, and a review the reader cancels
			// has to hand back exactly what they typed, pictures and all. The chat is named
			// here rather than read again later, so the draft cleared is the one sent.
			const chatId = chatStore.activeChatId;
			onSend(trimmed, attachments.length ? attachments : undefined, () => releaseDraft(chatId, trimmed));
		}
	}

	/** The draft is the message's now: record it for ↑ recall and clear the box. */
	function releaseDraft(chatId: string | null, sent: string) {
		if (sent) inputHistoryStore.record(chatId, sent);
		content = '';
		pendingImages = [];
		historyPos = null;
		// The message is sent, so the draft's job is done.
		if (chatId) inputDraftStore.clear(chatId);
		if (textareaElement) {
			textareaElement.style.height = 'auto';
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		// Frozen under an open transform strip: the box is readonly-in-effect, so neither
		// Enter-to-send nor history recall may rewrite the draft the proposal is about.
		if (transformOpen) return;
		// Ctrl/⌘+Enter regenerates, above command mode because the palette owns plain Enter and
		// nothing modified. Same gate as the newest turn's own Retry, so the key can never
		// outreach the button.
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			if (!isStreaming && canRegenerateLast) onRegenerateLast?.();
			return;
		}
		// Command mode owns the keys the palette needs and nothing else. It sits above the
		// history recall below, which reads the same arrows, and above the touch branch: in
		// command mode Enter runs the call on every device, since a newline in a command line
		// is prose the mode has already stood down for.
		if (commandOpen) {
			// Unmodified only, the same rule the history recall below follows: Alt+↑ takes the
			// keyboard up into the story, and a palette that also claimed it would move its
			// highlight on the way out.
			if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey) {
				e.preventDefault();
				moveCommandSelection(e.key === 'ArrowDown' ? 1 : -1);
				return;
			}
			if (e.key === 'Tab') {
				e.preventDefault();
				if (activeCommand) void completeCommandName(activeCommand);
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				submitCommand();
				return;
			}
			// Consumed per the shell Esc contract, so leaving the palette never also closes a
			// panel behind it. The text stays: this is the escape hatch for a line that really
			// does start with a slash.
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				commandArmed = false;
				// The line is prose from here on, so it becomes a draft like any other. Nothing
				// else fires: leaving the mode is not an input event.
				scheduleDraftSave();
				return;
			}
		}
		if (
			(e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
			!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
		) {
			if (navigateHistory(e.key === 'ArrowUp' ? -1 : 1)) {
				e.preventDefault();
				return;
			}
		}
		// On touch there is no Shift key, so Enter inserts a newline and the send
		// button submits. Only pointer devices submit on Enter.
		if (e.key === 'Enter' && !e.shiftKey && !viewport.isTouch) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function handleInput() {
		if (textareaElement) {
			textareaElement.style.height = 'auto';
			textareaElement.style.height = Math.min(textareaElement.scrollHeight, 200) + 'px';
		}
	}

	// Real typing (as opposed to programmatic content changes): resize, leave
	// history mode, and keep the persisted draft in step.
	function handleComposerInput() {
		handleInput();
		historyPos = null;
		// A lone "/" in an otherwise empty composer arms command mode; anything that stops
		// being a command line (a newline, a deleted slash) drops it. Typing always returns
		// the highlight to the first row, so the selection can never point at a command that
		// has scrolled out of the list.
		// A composer holding a picture is not empty, whatever the text box says: arming there
		// would let `/say` land a turn while the attachment sat behind it, silently dropped.
		if (!commandArmed && content === '/' && !pendingImages.length && !uploadingImages)
			commandArmed = true;
		else if (commandArmed && !parseCommandInput(content)) commandArmed = false;
		commandIndex = 0;
		// A command line is not a draft. Persisting one syncs it to every device and restores
		// it later as ordinary text, so a command typed and abandoned would come back as a
		// message that sends itself on the next Enter.
		if (!commandArmed) scheduleDraftSave();
	}

</script>

<div class="input-shell">
	<div class="input-inner">
		<!-- Spellcheck / Impersonate open here, directly over the box they rewrite: in flow,
		     so the transcript shortens and nothing about the story is covered. -->
		{#if transformKind && chatStore.activeChatId}
			<TransformPanel
				kind={transformKind}
				original={transformOriginal}
				chatMessages={activePath}
				onClose={() => (transformKind = null)}
				onApprove={applyTransform}
			/>
		{/if}

		<!-- A reply nobody on this screen started. In flow above the box, because it explains a
		     Stop button standing where Send usually is, and because there is no streaming
		     bubble to carry it: this page is not watching those tokens, only naming them. -->
		{#if generatingSince !== null}
			<div class="composer-elsewhere">
				<Icon name="refresh" class="w-3.5 h-3.5 shrink-0 animate-spin" />
				<span>{generatingLine}</span>
			</div>
		{/if}

		<!-- The composer is the drop target for pictures. Other files are refused by name
		     rather than quietly ignored. -->
		<div
			class="composer-shell input-base"
			class:composer-shell--frozen={transformOpen}
			class:composer-shell--command={commandOpen}
			style="box-shadow: var(--shadow-sm);"
			ondragenter={handleDragEnter}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
			role="presentation"
		>
			{#if dragDepth > 0}
				<div class="composer-drop">Drop a picture to attach it</div>
			{/if}

			<!-- What "/" turned the box into. The list is its own surface; the mode, the gates
			     and the keys stay here, because all three are about the box being typed into. -->
			{#if commandOpen}
				<CommandPalette
					groups={paletteGroups}
					active={activeCommand}
					{refusalFor}
					onPick={pickCommand}
				/>
			{/if}
			{#if pendingImages.length || uploadingImages > 0}
				<div class="attach-strip">
					{#each pendingImages as img (img.path)}
						<div class="attach-thumb">
							<img src={img.url} alt="Attached" />
							<button
								type="button"
								class="attach-remove"
								onclick={() => removePendingImage(img.path)}
								aria-label="Remove image"
								title="Remove"
							>
								<Icon name="x" class="w-3 h-3" strokeWidth={2.5} />
							</button>
						</div>
					{/each}
					{#if uploadingImages > 0}
						<div class="attach-thumb attach-uploading" title="Uploading…">
							<Icon name="refresh" class="w-4 h-4 animate-spin text-text-muted" />
						</div>
					{/if}
				</div>
			{/if}
			<div class="composer-main">
				<textarea
					bind:this={textareaElement}
					bind:value={content}
					onkeydown={handleKeydown}
					oninput={handleComposerInput}
					onpaste={handlePaste}
				placeholder="Type your message…"
				disabled={draftLocked || transformOpen}
					rows="1"
					class="composer-textarea bg-transparent font-body text-text-primary resize-none
				       focus:outline-none placeholder:text-text-muted
				       disabled:opacity-50 disabled:cursor-not-allowed
				       text-base leading-relaxed"
					style="max-height: 200px; min-height: 2rem;"
				></textarea>

				<div class="flex items-center gap-1 self-end">
					{#if isStreaming}
						<button
							type="button"
							onclick={onCancel}
							class="icon-btn text-error hover:bg-error/10"
							aria-label="Stop generating"
							title="Stop"
						>
							<Icon name="stop" class="w-5 h-5" />
						</button>
					{:else}
						<button
							type="button"
							onclick={handleSubmit}
							disabled={uploadingImages > 0 ||
							transformOpen ||
							(commandOpen ? !commandReady : !content.trim() && !pendingImages.length)}
							class="flex items-center justify-center w-9 h-9 rounded-full
						       bg-accent text-on-accent
						       hover:bg-accent-hover
						       disabled:opacity-30 disabled:cursor-not-allowed
						       transition-all duration-150"
						style="box-shadow: var(--shadow-sm);"
							aria-label={commandOpen ? 'Run command' : 'Send message'}
							title={commandOpen ? 'Run command' : 'Send'}
						>
							<Icon name="arrowRight" class="w-4 h-4" strokeWidth={2.5} />
						</button>
					{/if}
				</div>
			</div>

			<div class="composer-meta">
				<div class="composer-feature-group">
					<div class="composer-menu-wrap relative">
						<button
							type="button"
							onclick={() => (menuOpen = !menuOpen)}
							class="composer-icon-btn"
							class:composer-icon-btn--active={menuOpen}
							aria-label="Chat actions"
							title="Chat actions"
							aria-haspopup="dialog"
							aria-expanded={menuOpen}
						>
							<Icon name="menu" class="w-4 h-4" />
						</button>

						<Dialog
							open={menuOpen}
							onClose={() => (menuOpen = false)}
							title="Chat actions"
							titleAlign="left"
							size="sm"
							placement="center"
							bare
						>
							<!-- Spellcheck wears its registry icon (checkCircle), and the two Insert rows wear the
							     role glyphs MessageAvatar draws, so a row reads the same here as it
							     does in the transcript. -->
							<div class="composer-dialog-menu py-1">
								<button
									type="button"
									class="composer-menu-item"
									onclick={handleGoHome}
									data-dialog-initial-focus
								>
									<Icon name="home" class="w-4 h-4" />
									Home
								</button>
								<button
									type="button"
									class="composer-menu-item"
									title="Browse and search this character's chats"
									onclick={handleOpenChats}
								>
									<Icon name="chat" class="w-4 h-4" />
									Chats
								</button>
								<!-- Directly under Chats: this is that panel's own New chat button
								     surfaced as a shortcut, so it reads as one beside the row that
								     opens the panel. -->
								<button
									type="button"
									class="composer-menu-item"
									disabled={!activeCharacterEntry}
									title={activeCharacterEntry
										? undefined
										: "This story's character is gone from the library"}
									onclick={handleNewChat}
								>
									<Icon name="plus" class="w-4 h-4" />
									New chat
								</button>
								<button
									type="button"
									class="composer-menu-item"
									title="Search this story's messages"
									onclick={handleFindInChat}
								>
									<Icon name="search" class="w-4 h-4" />
									Find in chat…
								</button>
								<div class="composer-menu-sep"></div>
								<button
									type="button"
									class="composer-menu-item"
									onclick={() => handleInsertDummy('user')}
								>
									<Icon name="user" class="w-4 h-4" />
									Insert user message
								</button>
								<button
									type="button"
									class="composer-menu-item"
									onclick={() => handleInsertDummy('assistant')}
								>
									<Icon name="sparkles" class="w-4 h-4" />
									Insert LLM message
								</button>
								{#if featurePromptsStore.spellcheckEnabled}
									<div class="composer-menu-sep"></div>
									<button
										type="button"
										class="composer-menu-item"
										disabled={isStreaming || transformOpen || !content.trim()}
										title={transformOpen
											? 'Finish the one already open first'
											: content.trim()
												? 'Fix spelling and grammar, then review the changes before they apply'
												: 'Type a draft first'}
										onclick={() => startTransform('spellcheck')}
									>
										<Icon name="checkCircle" class="w-4 h-4" />
										Spellcheck draft
									</button>
								{/if}
								<div class="composer-menu-sep"></div>
								<button
									type="button"
									class="composer-menu-item"
									title="Show every message you have sent in this chat as a different persona"
									onclick={openPersonaDialog}
								>
									<Icon name="tag" class="w-4 h-4" />
									Relabel your messages…
								</button>
							</div>
						</Dialog>
					</div>

					{#if chatStore.activeChatId}
						<button
							type="button"
							onclick={() => (authorsNotesOpen = true)}
							class="composer-icon-btn steering-trigger"
							class:steering-trigger--active={authorsNotesActive}
							aria-label="Author's notes"
							aria-haspopup="dialog"
							aria-expanded={authorsNotesOpen}
							title="Author's notes"
						>
							<Icon name="document" class="w-4 h-4" />
							{#if authorsNotesActive}
								<span class="steering-dot" aria-hidden="true"></span>
							{/if}
						</button>
					{/if}

					{#if featurePromptsStore.steeringEnabled && chatStore.activeChatId}
						<div class="composer-menu-wrap relative">
							<!-- Deliberately never disabled while streaming: steering is next-turn
							     state, and lining up guidance mid-stream is the whole point. -->
							<button
								type="button"
								onclick={toggleSteering}
								class="composer-icon-btn steering-trigger"
								class:steering-trigger--active={steeringActive}
								aria-label="Steering"
								aria-haspopup="dialog"
								aria-expanded={steeringOpen}
								title={steeringTitle}
							>
								<Icon name="compass" class="w-4 h-4" />
								{#if steeringActive}
									<span class="steering-dot" aria-hidden="true"></span>
								{/if}
							</button>

							<!-- Every dismissal route reaches closeSteering, which commits quick text
							     and flushes pending note edits before the surface unmounts. -->
							<Dialog
								open={steeringOpen}
								onClose={closeSteering}
								title="Steering"
								titleAlign="left"
								size="sm"
								placement="center"
								bare
							>
								<SteeringPopover bind:this={steeringPopover} onManageLibrary={manageSteeringLibrary} />
							</Dialog>
						</div>
					{/if}

					{#if featurePromptsStore.impersonateEnabled && chatStore.activeChatId}
						<button
							type="button"
							class="composer-icon-btn"
							class:composer-icon-btn--active={transformKind === 'impersonate'}
							disabled={isStreaming || transformOpen || !content.trim()}
							aria-label="Impersonate"
							title={transformOpen
								? 'Finish the one already open first'
								: content.trim()
									? 'Impersonate: expand the draft into a full in-character message'
									: 'Impersonate: type a draft first'}
							onclick={() => startTransform('impersonate')}
						>
							<Icon name="mask" class="w-4 h-4" />
						</button>
					{/if}

					<div class="composer-feature-divider" aria-hidden="true"></div>

					<ChatSetupChip />
				</div>

			</div>
		</div>
	</div>
</div>

{#if authorsNotesOpen && chatStore.activeChatId}
	{#key chatStore.activeChatId}
		<AuthorsNotesDialog chatId={chatStore.activeChatId} onClose={() => (authorsNotesOpen = false)} />
	{/key}
{/if}

{#if chatStore.activeChatId}
	<ChatPersonaDialog
		open={personaDialogOpen}
		onClose={() => (personaDialogOpen = false)}
		chatId={chatStore.activeChatId}
		currentPersonaId={currentChatPersonaId}
	/>
{/if}

{#if duplicateTarget}
	<DuplicateChatDialog
		open={true}
		title={duplicateTarget.chat.title}
		footprint={duplicateTarget.footprint}
		busy={duplicating}
		onConfirm={(includeMemory) => runDuplicate(duplicateTarget!.chat, includeMemory)}
		onCancel={() => (duplicateTarget = null)}
	/>
{/if}

<style>
	.input-shell {
		border-top: 0;
		background: transparent;
		padding: clamp(0.55rem, 0.45rem + 0.55vw, 0.92rem) 0.7rem;
		/* Keep the composer above the home-bar inset. */
		padding-bottom: calc(clamp(0.55rem, 0.45rem + 0.55vw, 0.92rem) + env(safe-area-inset-bottom, 0px));
	}

	/* The composer tracks the transcript's content column (--chat-content-max,
	   app.css), not the chat shell: above the dock breakpoint the shell is a share
	   of the screen, and the box you type into has to sit exactly over the text it
	   feeds rather than stretch to the share. */
	.input-inner {
		width: 100%;
		max-width: var(--chat-content-max);
		margin: 0 auto;
	}

	/* One quiet line above the box, in the composer's own secondary voice. Muted on purpose:
	   it reports a state rather than asking for anything, and the answer to it (Stop) is the
	   button already sitting in the box below. */
	.composer-elsewhere {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.3rem 0.4rem;
		font-family: var(--font-ui);
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.composer-shell {
		padding: 0.48rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		border-radius: var(--radius-xl);
		position: relative;
	}

	/* Covers the composer while a drag is over it, and never interactive: the drop is
	   handled by the shell underneath, so this must not become the event target. */
	.composer-drop {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		border: 2px dashed var(--color-accent);
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-bg-solid) 88%, transparent);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.composer-main {
		display: flex;
		gap: 0.42rem;
		align-items: flex-end;
		min-width: 0;
	}

	/* ===== Image attachments ===== */
	.attach-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0.15rem 0.15rem 0;
	}

	.attach-thumb {
		position: relative;
		width: 3.4rem;
		height: 3.4rem;
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-border-subtle) 80%, transparent);
		overflow: hidden;
		background: color-mix(in srgb, var(--color-bg-tertiary) 60%, transparent);
	}

	.attach-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.attach-uploading {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.attach-remove {
		position: absolute;
		top: 2px;
		right: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.1rem;
		height: 1.1rem;
		border: none;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--color-bg-primary) 75%, transparent);
		color: var(--color-text-primary);
		cursor: pointer;
	}

	.attach-remove:hover {
		background: var(--color-bg-primary);
	}

	/* 17px is unhittable with a thumb, so grow the hit area and keep the visual size. */
	@media (pointer: coarse) {
		.attach-remove {
			width: 1.75rem;
			height: 1.75rem;
		}
	}

	.composer-textarea {
		flex: 1;
		min-width: 0;
		/* The row is just textarea + send now; give the text a little breathing room
		   and center it against the send button. */
		padding: 0.3rem 0.15rem 0.3rem 0.35rem;
	}

	/* Frozen under an open transform strip. The box is disabled, but it still holds the
	   draft that strip's proposal is about, so it keeps its text legible instead of fading
	   to the shared disabled 50%. Secondary text is muted enough to read as inert, never
	   as unreadable. */
	.composer-shell--frozen .composer-textarea:disabled {
		opacity: 1;
		color: var(--color-text-secondary);
	}

	/* The feature group handles its own wrapping on narrow screens. */
	.composer-meta {
		padding-top: 0.45rem;
		border-top: 1px solid var(--color-border-raised);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.composer-feature-group {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		flex-wrap: wrap;
	}

	/* The button wrapper must be a flex box: a block wrapper around an inline-flex
	   button reserves baseline descender space below it, which is exactly the
	   "one button sits lower" misalignment the old layout had. */
	.composer-menu-wrap {
		display: flex;
	}

	/* Compact tool buttons (chat actions, steering) sized to the meta-row chips so the
	   whole bottom row reads as one aligned strip. */
	.composer-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.9rem;
		height: 1.9rem;
		padding: 0;
		/* Same raised tier as the rule and the pips beside it: on the composer's own
		   surface `--color-border-subtle` measures ~1.2:1, so these outlines were a
		   hairline away from not being drawn at all, in every palette. */
		border: 1px solid var(--color-border-raised);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	}

	.composer-icon-btn:hover:not(:disabled),
	.composer-icon-btn--active {
		background: color-mix(in srgb, var(--color-bg-tertiary) 86%, transparent);
		color: var(--color-text-primary);
	}

	@media (pointer: coarse) {
		.composer-icon-btn {
			width: 2.4rem;
			height: 2.4rem;
		}
	}

	.composer-icon-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.composer-feature-divider {
		width: 1px;
		height: 1.15rem;
		margin: 0 0.2rem;
		background: var(--color-border-raised);
		flex-shrink: 0;
	}

	/* A short screen may not have room for every optional action. The Dialog owns the
	   fixed head; this list owns the remaining vertical space and its one scrollbar. */
	.composer-dialog-menu {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	/* Menu rows: a fixed icon column then the label, in the same font-ui/secondary →
	   primary language as the persona popover beside it and the Library's entry menu.
	   The icon inherits currentColor, so one hover rule lifts the whole row. */
	.composer-menu-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 0;
		background: transparent;
		color: var(--color-text-secondary);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.composer-menu-item:hover:not(:disabled) {
		background: var(--color-bg-tertiary);
		color: var(--color-text-primary);
	}

	.composer-menu-item:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.composer-menu-sep {
		margin: 0.25rem 0;
		border-top: 1px solid var(--color-border-subtle);
	}

	/* The box says what it has become, in the one colour the whole app uses for "this is
	   yours": nothing about the composer moves, so the change reads without costing a reflow
	   of the story above it. The list itself is CommandPalette.svelte. */
	.composer-shell--command {
		border-color: var(--color-accent);
	}

	/* ===== Steering trigger (the panel's own styles live in SteeringPopover) ===== */

	.steering-trigger {
		position: relative;
	}

	.steering-trigger--active {
		color: var(--color-accent);
		border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.steering-dot {
		position: absolute;
		top: -2px;
		right: -2px;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 999px;
		background: var(--color-accent);
	}

	@media (max-width: 900px) {
		.input-shell {
			padding-inline: 0.45rem;
		}
	}

	@media (max-width: 560px) {
		.input-shell {
			padding-inline: 0.45rem;
		}

		.composer-shell {
			padding: 0.4rem;
		}

		.composer-main {
			gap: 0.32rem;
		}
	}
</style>
