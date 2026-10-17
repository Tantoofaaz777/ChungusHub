import { db } from '$lib/services/database';
import { chatStore } from '$lib/stores/chat.svelte';
import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
import { chatPersonaClaim, personaEntryFor, toPromptCharacter } from '$lib/utils/chat-setup';
import { llmService } from '$lib/services/llm/provider';
import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
import { expandSelfRefs } from '$lib/macros';
import { countTokens } from '$lib/tokenizer';
import { toastStore } from '$lib/stores/toast.svelte';
import { emptyAo3Information, type Ao3Information } from '$shared/threads/ao3';
import { selectThreadsMessages, threadsPrompt, threadsOnPath, threadsSelectionOverlaps } from '$shared/threads/model';
import { parseGeneratedThreadsFeed } from '$shared/threads/feed';
import type { ThreadsFeed, ThreadsRound, ThreadsMessage, SaveThreadsRound, ThreadsNotesPatch } from '$shared/threads/types';
import { threadsConfigStore } from './config.svelte';

type NotesPatch = ThreadsNotesPatch;
type PendingResult = { input: SaveThreadsRound } | { round: ThreadsRound; versionId: string; feed: ThreadsFeed };
export class ThreadsStore {
	chatId = $state<string | null>(null);
	loaded = $state(false);
	rounds = $state<ThreadsRound[]>([]);
	notes = $state('');
	promptId = $state<string | null>(null);
	ao3 = $state<Ao3Information>(emptyAo3Information());
	selected = $state<string[]>([]);
	label = $state('');
	tab = $state<'feed' | 'make'>('feed');
	phase = $state<'idle' | 'generating' | 'saving'>('idle');
	tokenProgress = $state<{ reasoning: number | null; response: number | null }>({ reasoning: null, response: null });
	error = $state('');
	notesError = $state('');
	pending = $state.raw<PendingResult | null>(null);
	private ticket = 0;
	private loading: { chatId: string | null; promise: Promise<void> } | null = null;
	private controller: AbortController | null = null;
	private anchor: string | null = null;
	private notesPatch: NotesPatch = {};
	private localNotes = new Map<string, NotesPatch>();
	private notesTimer: ReturnType<typeof setTimeout> | null = null;
	private notesQueue: Promise<void> = Promise.resolve();
	private notesWriting = new Map<string, number>();
	get instructions() { return featurePromptsStore.threadsPrompts.prompts.find(p => p.id === this.promptId)?.content ?? featurePromptsStore.promptFor('threads'); }
	get busy() { return this.phase !== 'idle'; }
	get path() { return chatStore.currentChatState?.chat.id === this.chatId ? chatStore.currentChatState.activePath : []; }
	get usedIds() { return new Set(this.previousRounds.flatMap(r => r.messages.map(m => m.id))); }
	get available() { const used = this.usedIds; return this.path.map((message, index) => ({ ...message, index })).filter(m => !used.has(m.id)); }
	get selectedCount() { const ids = new Set(this.selected); return this.available.filter(m => ids.has(m.id)).length; }
	get previousRounds() {
		return threadsOnPath(this.rounds, this.path);
	}
	/** Ordinary panel opens reuse the current data; explicit reloads and live sync stay fresh. */
	async ensureLoaded(chatId: string | null) {
		if (this.chatId === chatId && this.loaded) return;
		if (this.loading?.chatId === chatId) return this.loading.promise;
		await this.load(chatId);
	}
	load(chatId: string | null): Promise<void> {
		const request = { chatId, promise: this.loadData(chatId) };
		this.loading = request;
		const finish = () => { if (this.loading === request) this.loading = null; };
		void request.promise.then(finish, finish);
		return request.promise;
	}
	private async loadData(chatId: string | null) {
		if (chatId !== this.chatId) {
			void this.flushNotes().catch(() => {});
			this.cancel(); this.chatId = chatId; this.rounds = []; this.selected = []; this.anchor = null;
			this.notes = ''; this.promptId = null; this.ao3 = emptyAo3Information(); this.label = ''; this.pending = null; this.error = ''; this.notesError = '';
		}
		const ticket = ++this.ticket;
		this.loaded = false; this.error = '';
		if (!chatId) return;
		try {
			const data = await db.getThreadsData(chatId);
			if (this.ticket !== ticket || this.chatId !== chatId) return;
			this.rounds = data.rounds;
			const local = this.localNotes.get(chatId) ?? {};
			this.notes = local.notes ?? data.notes; this.ao3 = local.ao3 ?? data.ao3;
			this.promptId = local.promptId !== undefined ? local.promptId : data.promptId ?? null;
			if (!this.notesWriting.get(chatId)) this.notesPatch = { ...local };
			this.loaded = true;
		} catch (error) { if (this.ticket === ticket) this.error = error instanceof Error ? error.message : String(error); }
	}
	async syncReload() { if (this.chatId) await this.load(this.chatId); }
	toggle(id: string, range = false) {
		if (this.busy || !this.available.some(m => m.id === id)) return;
		if (range && this.anchor) {
			const a = this.available.findIndex(m => m.id === this.anchor), b = this.available.findIndex(m => m.id === id);
			if (a >= 0 && b >= 0) this.selected = [...new Set([...this.selected, ...this.available.slice(Math.min(a,b), Math.max(a,b)+1).map(m => m.id)])];
			else this.selected = [...new Set([...this.selected, id])];
		} else this.selected = this.selected.includes(id) ? this.selected.filter(v => v !== id) : [...this.selected, id];
		this.anchor = id;
	}
	clearSelection() { this.selected = []; this.anchor = null; }
	updateNotes(patch: NotesPatch) {
		if (!this.chatId) return;
		if (patch.notes !== undefined) this.notes = patch.notes;
		if (patch.promptId !== undefined) this.promptId = patch.promptId;
		if (patch.ao3) this.ao3 = patch.ao3;
		this.notesPatch = { ...this.notesPatch, ...patch };
		this.localNotes.set(this.chatId, { ...this.localNotes.get(this.chatId), ...structuredClone($state.snapshot(patch)) });
		if (this.notesTimer) clearTimeout(this.notesTimer);
		this.notesTimer = setTimeout(() => void this.flushNotes().catch(() => {}), 500);
	}
	async flushNotes() {
		if (this.notesTimer) clearTimeout(this.notesTimer);
		this.notesTimer = null;
		const chatId = this.chatId, patch = structuredClone($state.snapshot(this.notesPatch));
		this.notesPatch = {};
		if (!chatId || !Object.keys(patch).length) return this.notesQueue;
		this.notesWriting.set(chatId, (this.notesWriting.get(chatId) ?? 0) + 1);
		const write = this.notesQueue.catch(() => {}).then(() => db.updateThreadsNotes(chatId, patch));
		this.notesQueue = write;
		try {
			await write;
			const local = { ...this.localNotes.get(chatId) };
			if (patch.notes !== undefined && local.notes === patch.notes) delete local.notes;
			if (patch.promptId !== undefined && local.promptId === patch.promptId) delete local.promptId;
			if (patch.ao3 !== undefined && JSON.stringify(local.ao3) === JSON.stringify(patch.ao3)) delete local.ao3;
			if (Object.keys(local).length) this.localNotes.set(chatId, local); else this.localNotes.delete(chatId);
			if (this.chatId === chatId) this.notesError = '';
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (this.chatId === chatId) { this.notesPatch = { ...patch, ...this.notesPatch }; this.notesError = message; }
			else toastStore.error(`Threads notes could not be saved: ${message}`);
			throw error;
		} finally {
			const remaining = (this.notesWriting.get(chatId) ?? 1) - 1;
			if (remaining) this.notesWriting.set(chatId, remaining); else this.notesWriting.delete(chatId);
		}
	}
	cancel() { this.controller?.abort(); this.controller = null; if (this.phase === 'generating') this.phase = 'idle'; }
	private preparePrompt(round?: ThreadsRound, validate = true) {
		const chat = chatStore.activeChat;
		const entry = characterLibraryStore.entries.find(e => e.id === chat?.characterId);
		const character = entry ? toPromptCharacter(entry, characterLibraryStore.dataForVersion(entry, chat?.characterVersionId ?? null)) : null;
		const persona = toPromptCharacter(personaEntryFor(chatPersonaClaim(chat)));
		const charName = character?.name || 'Narrator', userName = persona?.name || 'User';
		const messages: ThreadsMessage[] = round ? structuredClone($state.snapshot(round.messages)) : (!validate && !this.selected.length ? [] : selectThreadsMessages(this.path, this.selected, this.usedIds)).map(m => ({
			id: m.id, index: this.path.findIndex(p => p.id === m.id), content: m.content, role: m.role,
			speaker: m.role === 'assistant' ? charName : m.role === 'user' ? userName : 'System'
		}));
		const branchLeafId = this.path.at(-1)?.id;
		if (validate && !round && threadsSelectionOverlaps(this.rounds, messages, this.path, chatStore.currentChatState?.allMessages ?? this.path)) throw new Error('These messages overlap a saved thread. Include this fork’s own messages or select another scene.');
		const cutoff = round ? this.rounds.findIndex(r => r.id === round.id) : this.rounds.length;
		if (round && (cutoff < 0 || !this.previousRounds.some(r => r.id === round.id))) throw new Error('This thread belongs to another branch. Return to its branch to regenerate it.');
		const earlierIds = new Set(this.rounds.slice(0, cutoff).map(r => r.id));
		const previous = this.previousRounds.filter(r => earlierIds.has(r.id));
		const expand = (m: ThreadsMessage) => ({ ...m, content: expandSelfRefs(m.content, charName, userName, persona?.pronouns ?? {}) });
		const label = round?.label ?? this.label;
		const input = $state.snapshot({ messages: messages.map(expand), label,
			previous: previous.map(r => ({ ...r, messages: r.messages.map(expand) })), notes: this.notes, ao3: this.ao3,
			instructions: this.instructions, config: threadsConfigStore.value });
		return { messages, branchLeafId, label, input };
	}
	get promptPreview(): Parameters<typeof threadsPrompt>[0] | null {
		if (!this.loaded) return null;
		try { return this.preparePrompt(undefined, false).input; } catch { return null; }
	}
	async generate(round?: ThreadsRound) {
		if (!this.chatId || !this.loaded || this.busy || this.pending) return;
		const chatId = this.chatId, controller = this.controller = new AbortController();
		this.phase = 'generating'; this.error = '';
		this.tokenProgress = { reasoning: null, response: null };
		let progressTimer: ReturnType<typeof setTimeout> | null = null;
		try {
			if (!featurePromptsStore.threadsEnabled) throw new Error('Enable Threads in Settings → Engines to generate a thread.');
			await this.flushNotes();
			if (controller.signal.aborted) return;
			const { messages, branchLeafId, label, input } = this.preparePrompt(round);
			const target = { engine: 'threads' }, model = llmService.modelFor(target);
			if (!model) throw new Error('Choose a model for Threads on Connections before generating.');
			const prompt = await threadsPrompt({ ...input, countTokens: text => countTokens(text, model) });
			if (controller.signal.aborted || this.controller !== controller || this.chatId !== chatId) return;
			if (countTokens(prompt, model) > llmService.getPromptTokenBudget(target)) throw new Error('This scene and its context exceed the connection’s context window. Select fewer messages or lower the Threads continuity limits in Engines.');
			let response = '', reasoning = '';
			const current = () => !controller.signal.aborted && this.controller === controller && this.chatId === chatId;
			const updateProgress = (finished = false) => {
				if (!current()) return;
				this.tokenProgress = {
					reasoning: reasoning || finished ? countTokens(reasoning, model) : null,
					response: response || finished ? countTokens(response, model) : null
				};
			};
			// Count accumulated text at most ten times a second, rather than tokenizing each delta.
			const receive = (text: string, thinking: boolean) => {
				if (!current()) return;
				if (thinking) reasoning += text; else response += text;
				if (progressTimer === null) progressTimer = setTimeout(() => { progressTimer = null; updateProgress(); }, 100);
			};
			const result = await llmService.complete(target, {
				source: 'threads', signal: controller.signal, messages: [{ role: 'user', content: prompt }],
				onToken: text => receive(text, false), onThinkingToken: text => receive(text, true)
			});
			if (controller.signal.aborted || this.controller !== controller || this.chatId !== chatId) return;
			if (progressTimer !== null) { clearTimeout(progressTimer); progressTimer = null; }
			response = result.content; reasoning = result.thinking ?? ''; updateProgress(true);
			const feed = parseGeneratedThreadsFeed(result.content);
			this.pending = round ? { round: structuredClone($state.snapshot(round)), versionId: crypto.randomUUID(), feed }
				: { input: { id: crypto.randomUUID(), chatId, label, messages, feed, branchLeafId } };
			await this.saveResult();
		} catch (error) { if (!controller.signal.aborted && this.chatId === chatId) this.error = error instanceof Error ? error.message : String(error); }
		finally { if (progressTimer !== null) clearTimeout(progressTimer); if (this.controller === controller) { this.controller = null; this.phase = 'idle'; } }
	}
	async saveResult() {
		const pending = this.pending;
		if (!pending || this.phase === 'saving') return;
		this.phase = 'saving'; this.error = '';
		try {
			const round = 'input' in pending ? await db.saveThreadsRound(pending.input)
				: await db.addThreadsVersion(pending.round.chatId, pending.round.id, pending.round.revision, pending.versionId, pending.feed);
			if (this.chatId !== round.chatId || this.pending !== pending) return;
			this.rounds = this.rounds.some(r => r.id === round.id) ? this.rounds.map(r => r.id === round.id ? round : r) : [...this.rounds, round];
			this.pending = null; this.clearSelection(); this.label = ''; this.tab = 'feed';
		} catch (error) { if (this.pending === pending) this.error = error instanceof Error ? error.message : String(error); }
		finally { if (this.pending === pending || !this.pending) this.phase = 'idle'; }
	}
	async chooseVersion(round: ThreadsRound, versionId: string) {
		if (this.busy) return;
		this.phase = 'saving';
		try {
			const saved = await db.setThreadsVersion(round.chatId, round.id, round.revision, versionId);
			if (this.chatId === saved.chatId) this.rounds = this.rounds.map(r => r.id === saved.id ? saved : r);
		} catch (error) { if (this.chatId === round.chatId) this.error = error instanceof Error ? error.message : String(error); }
		finally { this.phase = 'idle'; }
	}
	async resetContinuity(chatId: string, expected: { id: string; revision: number }[]) {
		if (this.chatId !== chatId || !this.loaded || this.busy || this.pending) return;
		this.phase = 'saving'; this.error = '';
		try {
			await db.resetThreadsContinuity(chatId, expected);
			if (this.chatId === chatId) { this.rounds = []; this.tab = 'make'; }
		} catch (error) {
			if (this.chatId === chatId) this.error = error instanceof Error ? error.message : String(error);
		} finally { this.phase = 'idle'; }
	}
	async remove(round: ThreadsRound) {
		if (this.busy) return;
		this.phase = 'saving';
		try {
			await db.deleteThreadsRound(round.chatId, round.id, round.revision);
			if (this.chatId === round.chatId) this.rounds = this.rounds.filter(r => r.id !== round.id);
		} catch (error) { if (this.chatId === round.chatId) this.error = error instanceof Error ? error.message : String(error); }
		finally { this.phase = 'idle'; }
	}
}
export const threadsStore = new ThreadsStore();
