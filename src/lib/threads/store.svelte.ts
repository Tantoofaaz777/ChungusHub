import { db } from '#lib/services/database.ts';
import { chatStore } from '#lib/stores/chat.svelte.ts';
import { characterLibraryStore } from '#lib/stores/characterLibrary.svelte.ts';
import { chatPersonaEntry, toPromptCharacter } from '#lib/utils/chat-setup.ts';
import { llmService } from '#lib/services/llm/provider.ts';
import { THREADS_SUMMARY_POINT } from '#lib/stores/connections.svelte.ts';
import { featurePromptsStore } from '#lib/stores/featurePrompts.svelte.ts';
import { expandPromptSelfRefs, expandPromptTemplate, type MacroContext } from '#lib/macros.ts';
import type { Message } from '#lib/types/chat.ts';
import type { CallTarget } from '#lib/types/llm.ts';
import { countTokens, withTokenizers } from '#lib/tokenizer/index.ts';
import { toastStore } from '#lib/stores/toast.svelte.ts';
import { AO3_TEXT_FIELDS, emptyAo3Information, type Ao3Information } from '#shared/threads/ao3.ts';
import { normalizeThreadsConfig, selectThreadsMessages, threadsPrompt, threadsOnPath, threadsSelectionOverlaps, threadsStoryWindow } from '#shared/threads/model.ts';
import { parseGeneratedThreadsFeed } from '#shared/threads/feed.ts';
import { buildThreadsSummaryPrompt, MAX_THREADS_SUMMARY_LENGTH } from '#shared/threads/summary.ts';
import type { ThreadsFeed, ThreadsRound, ThreadsMessage, SaveThreadsRound, ThreadsNotesPatch } from '#shared/threads/types.ts';
import { threadsConfigStore } from './config.svelte';
import { retainLocalChanges } from '#lib/utils/retain-local-changes.ts';

type NotesPatch = ThreadsNotesPatch;
type PendingResult = { input: SaveThreadsRound } | { round: ThreadsRound; versionId: string; feed: ThreadsFeed };
const notesFields = ['notes', 'ao3', 'promptId'] as const;
type NotesRevisions = Partial<Record<keyof NotesPatch, number>>;
type NotesEdits = { values: NotesPatch; revisions: NotesRevisions };
export class ThreadsStore {
	chatId = $state<string | null>(null);
	loaded = $state(false);
	refreshing = $state(false);
	loadError = $state('');
	rounds = $state<ThreadsRound[]>([]);
	viewedRoundId = $state<string | null>(null);
	notes = $state('');
	promptId = $state<string | null>(null);
	ao3 = $state<Ao3Information>(emptyAo3Information());
	selected = $state<string[]>([]);
	label = $state('');
	tab = $state<'feed' | 'make' | 'summaries'>('feed');
	phase = $state<'idle' | 'generating' | 'saving' | 'saving-summary'>('idle');
	summaryProgress = $state<{ current: number; total: number } | null>(null);
	tokenProgress = $state<{ reasoning: number | null; response: number | null }>({ reasoning: null, response: null });
	error = $state('');
	notesError = $state('');
	pending = $state.raw<PendingResult | null>(null);
	private ticket = 0;
	private loading: { chatId: string | null; promise: Promise<void> } | null = null;
	private controller: AbortController | null = null;
	private write: object | null = null;
	private anchor: string | null = null;
	private notesPatch: NotesPatch = {};
	private localNotes = new Map<string, NotesEdits>();
	private notesTimer: ReturnType<typeof setTimeout> | null = null;
	private notesWrites = new Map<string, Promise<void>>();
	private notesRevisions = { notes: 0, ao3: 0, promptId: 0 };
	get instructions() { return featurePromptsStore.threadsPrompts.prompts.find(p => p.id === this.promptId)?.content ?? featurePromptsStore.promptFor('threads'); }
	get busy() { return this.phase !== 'idle'; }
	get path() { return chatStore.currentChatState?.chat.id === this.chatId ? chatStore.currentChatState.activePath : []; }
	get usedIds() { return new Set(this.previousRounds.flatMap(r => r.messages.map(m => m.id))); }
	get available() { const used = this.usedIds; return this.path.map((message, index) => ({ ...message, index })).filter(m => !used.has(m.id)); }
	private get selectedSource() { return selectThreadsMessages(this.available, this.selected); }
	get selectedCount() { return this.selectedSource.length; }
	get previousRounds() {
		return threadsOnPath(this.rounds, this.path);
	}
	get displayedLabels() {
		const cast = this.promptCast();
		const byId = new Map(chatStore.currentChatState?.allMessages.map(m => [m.id, m]));
		return new Map(this.rounds.map((round, index) => {
			const label = expandPromptTemplate(round.label, this.templateContext(cast, round.messages, byId));
			return [round.id, label.trim() || `Thread ${index + 1}`];
		}));
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
			this.cancel(); this.chatId = chatId; this.loaded = false; this.rounds = []; this.viewedRoundId = null; this.selected = []; this.anchor = null;
			this.write = null; this.phase = 'idle';
			this.notes = ''; this.promptId = null; this.ao3 = emptyAo3Information(); this.label = ''; this.pending = null; this.error = ''; this.notesError = '';
		}
		const ticket = ++this.ticket;
		// Once loaded, keep the current chat mounted throughout refreshes and failures.
		this.refreshing = this.loaded; this.loadError = '';
		if (!chatId) return;
		const before = [...this.rounds], notesRevisions = { ...this.notesRevisions };
		const notesAtStart = { ...this.localNotes.get(chatId)?.values };
		try {
			const data = await db.getThreadsData(chatId);
			if (this.ticket !== ticket || this.chatId !== chatId) return;
			this.rounds = retainLocalChanges(data.rounds, before, this.rounds);
			if (!this.rounds.some(round => round.id === this.viewedRoundId)) this.viewedRoundId = this.rounds.at(-1)?.id ?? null;
			const local = this.localNotes.get(chatId)?.values ?? {};
			// A pending save may finish and clear localNotes before this older read returns.
			const retained = { ...notesAtStart, ...local };
			if (notesRevisions.notes === this.notesRevisions.notes) this.notes = retained.notes ?? data.notes;
			if (notesRevisions.ao3 === this.notesRevisions.ao3) this.ao3 = retained.ao3 ?? data.ao3;
			if (notesRevisions.promptId === this.notesRevisions.promptId) this.promptId = retained.promptId !== undefined ? retained.promptId : data.promptId ?? null;
			if (!this.notesWrites.has(chatId)) this.notesPatch = { ...local };
			this.loaded = true;
		} catch (error) { if (this.ticket === ticket) this.loadError = error instanceof Error ? error.message : String(error); }
		finally { if (this.ticket === ticket) this.refreshing = false; }
	}
	async syncReload() { if (this.chatId) await this.load(this.chatId); }
	toggle(id: string, range = false) {
		if (this.busy) return;
		const available = this.available, index = available.findIndex(m => m.id === id);
		if (index < 0) return;
		if (range && this.anchor) {
			const a = available.findIndex(m => m.id === this.anchor);
			if (a >= 0) this.selected = [...new Set([...this.selected, ...available.slice(Math.min(a,index), Math.max(a,index)+1).map(m => m.id)])];
			else this.selected = [...new Set([...this.selected, id])];
		} else this.selected = this.selected.includes(id) ? this.selected.filter(v => v !== id) : [...this.selected, id];
		this.anchor = id;
	}
	clearSelection() { this.selected = []; this.anchor = null; }
	updateNotes(patch: NotesPatch) {
		if (!this.chatId) return;
		if (patch.notes !== undefined) { this.notes = patch.notes; this.notesRevisions.notes++; }
		if (patch.promptId !== undefined) { this.promptId = patch.promptId; this.notesRevisions.promptId++; }
		if (patch.ao3) { this.ao3 = patch.ao3; this.notesRevisions.ao3++; }
		this.notesPatch = { ...this.notesPatch, ...patch };
		const local = this.localNotes.get(this.chatId);
		const revisions = { ...local?.revisions };
		for (const key of notesFields) if (patch[key] !== undefined) revisions[key] = this.notesRevisions[key];
		this.localNotes.set(this.chatId, {
			values: { ...local?.values, ...structuredClone($state.snapshot(patch)) },
			revisions
		});
		if (this.notesTimer) clearTimeout(this.notesTimer);
		this.notesTimer = setTimeout(() => void this.flushNotes().catch(() => {}), 500);
	}
	async flushNotes() {
		if (this.notesTimer) clearTimeout(this.notesTimer);
		this.notesTimer = null;
		const chatId = this.chatId, patch = structuredClone($state.snapshot(this.notesPatch));
		this.notesPatch = {};
		if (!chatId) return;
		const queued = this.notesWrites.get(chatId);
		if (!Object.keys(patch).length) return queued;
		const revisions = { ...this.localNotes.get(chatId)?.revisions };
		const matchingFields = (local?: NotesEdits) => notesFields.filter(key => patch[key] !== undefined &&
			revisions[key] !== undefined && local?.revisions[key] === revisions[key]);
		const write = (queued ?? Promise.resolve()).catch(() => {}).then(() => db.updateThreadsNotes(chatId, patch));
		this.notesWrites.set(chatId, write);
		try {
			await write;
			const local = this.localNotes.get(chatId);
			if (local) {
				for (const key of matchingFields(local)) {
					delete local.values[key];
					delete local.revisions[key];
				}
				if (!Object.keys(local.values).length) this.localNotes.delete(chatId);
			}
			if (this.chatId === chatId && !Object.keys(this.notesPatch).length) this.notesError = '';
		}
		catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const keys = matchingFields(this.localNotes.get(chatId));
			if (keys.length && this.chatId === chatId) {
				const retry = Object.fromEntries(keys.map(key => [key, patch[key]]));
				this.notesPatch = { ...retry, ...this.notesPatch };
				this.notesError = message;
			} else if (keys.length) toastStore.error(`Threads notes could not be saved: ${message}`);
			throw error;
		} finally {
			if (this.notesWrites.get(chatId) === write) this.notesWrites.delete(chatId);
		}
	}
	cancel() { this.controller?.abort(); this.controller = null; this.summaryProgress = null; if (this.phase === 'generating') this.phase = 'idle'; }
	private beginWrite(chatId: string, phase: 'saving' | 'saving-summary') {
		const write = this.write = {};
		this.phase = phase;
		const current = () => this.write === write && this.chatId === chatId;
		return {
			current,
			finish: () => {
				if (current()) {
					this.write = null;
					this.phase = 'idle';
				} else if (this.chatId === chatId) {
					// Our own writes do not generate a sync event for this client.
					void this.syncReload();
				}
			}
		};
	}
	private promptCast() {
		const chat = chatStore.activeChat;
		const entry = characterLibraryStore.entries.find(e => e.id === chat?.characterId);
		const character = entry ? toPromptCharacter(entry, characterLibraryStore.dataForVersion(entry, chat?.characterVersionId ?? null)) : null;
		const persona = toPromptCharacter(chatPersonaEntry(chat));
		return {
			resolvedCharacters: character ? [character] : [],
			resolvedPersona: persona,
			fallbackNames: { char: character?.name || 'Narrator', user: persona?.name || 'User' }
		};
	}
	private templateContext(cast: MacroContext, source: ThreadsMessage[], byId: ReadonlyMap<string, Message>): MacroContext {
		return {
			...cast,
			// Inline history describes the selected scene, including older saved rounds.
			chatMessages: source.flatMap(m => {
				const original = byId.get(m.id);
				return original ? [{ ...original, role: m.role, content: m.content }] : [];
			})
		};
	}
	private preparePrompt(round?: ThreadsRound, validate = true) {
		const cast = this.promptCast();
		const { char: charName, user: userName } = cast.fallbackNames;
		const messages: ThreadsMessage[] = round ? structuredClone($state.snapshot(round.messages)) : this.selectedSource.map(m => ({
			id: m.id, ...(m.selectedVariantId ? { variantId: m.selectedVariantId } : {}), index: m.index, content: m.content, role: m.role,
			speaker: m.role === 'assistant' ? charName : m.role === 'user' ? userName : 'System'
		}));
		if (validate && !round && !messages.length) throw new Error('Select unused messages for this thread.');
		const branchLeafId = this.path.at(-1)?.id;
		if (validate && !round && threadsSelectionOverlaps(this.rounds, messages, this.path, chatStore.currentChatState?.allMessages ?? this.path)) throw new Error('These messages overlap a saved thread. Include this fork’s own messages or select another scene.');
		const cutoff = round ? this.rounds.findIndex(r => r.id === round.id) : this.rounds.length;
		if (round && (cutoff < 0 || !this.previousRounds.some(r => r.id === round.id))) throw new Error('This thread belongs to another branch. Return to its branch to regenerate it.');
		const earlierIds = new Set(this.rounds.slice(0, cutoff).map(r => r.id));
		const previous = this.previousRounds.filter(r => earlierIds.has(r.id));
		const pathById = new Map(this.path.map(m => [m.id, m]));
		const context = this.templateContext(cast, messages, pathById);
		const expandTemplate = (text: string) => expandPromptTemplate(text, context);
		const expandMessage = (m: ThreadsMessage) => ({
			...m, content: expandPromptSelfRefs(m.content, context)
		});
		const ao3 = { ...this.ao3 };
		if (ao3.enabled) {
			for (const [key] of AO3_TEXT_FIELDS) ao3[key] = expandTemplate(ao3[key]);
		}
		const label = round?.label ?? this.label;
		const input = $state.snapshot({
			messages: messages.map(expandMessage), label: expandTemplate(label),
			previous: previous.map(r => ({
				...r, label: expandPromptTemplate(r.label, this.templateContext(cast, r.messages, pathById)), messages: r.messages.map(expandMessage)
			})),
			notes: expandTemplate(this.notes), ao3, instructions: expandTemplate(this.instructions),
			config: threadsConfigStore.value
		});
		const summaryInstructions = validate && input.config.summarizeOlderRounds ? featurePromptsStore.promptFor('threadsSummary') : '';
		const summaryPromptFor = (scene: ThreadsRound) => buildThreadsSummaryPrompt(
			expandPromptTemplate(summaryInstructions, this.templateContext(cast, scene.messages, pathById)), scene.label, scene.messages
		);
		return { messages, branchLeafId, label, input, summaryPromptFor };
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
		const current = () => !controller.signal.aborted && this.controller === controller && this.chatId === chatId;
		try {
			if (!featurePromptsStore.threadsEnabled) throw new Error('Enable Threads in Settings → Engines to generate a thread.');
			const { messages, branchLeafId, label, input, summaryPromptFor } = this.preparePrompt(round);
			await this.flushNotes();
			if (!current()) return;
			const feedTarget = { engine: 'threads' }, feedModel = llmService.modelFor(feedTarget);
			if (!feedModel) throw new Error('Choose a model for Threads on Connections before generating.');
			const completeWithProgress = async (target: CallTarget, model: string, source: 'threads' | typeof THREADS_SUMMARY_POINT, prompt: string) => {
				if (llmService.modelFor(target) !== model) throw new Error('A Threads model changed during generation. Try again.');
				this.tokenProgress = { reasoning: null, response: null };
				let response = '', reasoning = '', done = false;
				let progressTimer: ReturnType<typeof setTimeout> | null = null;
				const updateProgress = (final = false) => {
					if (!current()) return;
					this.tokenProgress = {
						reasoning: reasoning || final ? countTokens(reasoning, model) : null,
						response: response || final ? countTokens(response, model) : null
					};
				};
				const receive = (text: string, thinking: boolean) => {
					if (done || !current()) return;
					if (thinking) reasoning += text; else response += text;
					// Count accumulated text at most ten times a second.
					if (progressTimer === null) progressTimer = setTimeout(() => { progressTimer = null; updateProgress(); }, 100);
				};
				try {
					const result = await llmService.complete(target, {
						source, signal: controller.signal, messages: [{ role: 'user', content: prompt }],
						onToken: text => receive(text, false), onThinkingToken: text => receive(text, true)
					});
					response = result.content; reasoning = result.thinking ?? ''; updateProgress(true);
					return result;
				} finally {
					done = true;
					if (progressTimer !== null) clearTimeout(progressTimer);
				}
			};
			const assemble = () => {
				const prompt = threadsPrompt(input);
				return withTokenizers(() => {
					if (countTokens(prompt, feedModel) > llmService.getPromptTokenBudget(feedTarget)) {
						throw new Error('This scene and its context exceed the connection’s context window. Select fewer messages or adjust the Threads continuity limits in Engines.');
					}
					return prompt;
				});
			};
			let prompt = await assemble();
			if (!current()) return;
			const { older } = threadsStoryWindow(input.previous, normalizeThreadsConfig(input.config));
			const missing = older.filter(scene => !scene.summary);
			const summaryTarget = { engine: THREADS_SUMMARY_POINT };
			const summaryModel = missing.length ? llmService.modelFor(summaryTarget) : '';
			if (missing.length && !summaryModel) throw new Error('Choose a model for Threads summaries on Connections before generating.');
			for (const [index, scene] of missing.entries()) {
				const summaryPrompt = summaryPromptFor(scene);
				const tokens = await withTokenizers(() => countTokens(summaryPrompt, summaryModel));
				if (!current()) return;
				if (tokens > llmService.getPromptTokenBudget(summaryTarget)) throw new Error('An older story round exceeds the summary model’s context window. Choose a connection with a larger context window for Threads summaries.');
				this.summaryProgress = { current: index + 1, total: missing.length };
				const result = await completeWithProgress(summaryTarget, summaryModel, THREADS_SUMMARY_POINT, summaryPrompt);
				if (!current()) return;
				const summary = result.content.trim();
				if (!summary || summary.length > MAX_THREADS_SUMMARY_LENGTH) throw new Error('The model returned an empty or oversized Threads story summary.');
				const saved = await db.saveThreadsSummary(chatId, scene.id, summary);
				if (!current()) return;
				this.rounds = this.rounds.map(r => r.id === saved.id && r.revision < saved.revision ? saved : r);
				scene.summary = saved.summary;
			}
			if (missing.length) {
				prompt = await assemble();
				if (!current()) return;
				this.summaryProgress = null;
			}
			const result = await completeWithProgress(feedTarget, feedModel, 'threads', prompt);
			if (!current()) return;
			const feed = parseGeneratedThreadsFeed(result.content);
			this.pending = round ? { round: structuredClone($state.snapshot(round)), versionId: crypto.randomUUID(), feed }
				: { input: { id: crypto.randomUUID(), chatId, label, messages, feed, branchLeafId } };
			await this.saveResult();
		} catch (error) { if (current()) this.error = error instanceof Error ? error.message : String(error); }
		finally { if (this.controller === controller) { this.controller = null; this.summaryProgress = null; this.phase = 'idle'; } }
	}
	async saveResult() {
		const pending = this.pending;
		if (!pending || this.phase === 'saving' || this.phase === 'saving-summary') return;
		const chatId = 'input' in pending ? pending.input.chatId : pending.round.chatId;
		if (chatId !== this.chatId) return;
		const write = this.beginWrite(chatId, 'saving');
		this.error = '';
		try {
			const round = 'input' in pending ? await db.saveThreadsRound(pending.input)
				: await db.addThreadsVersion(pending.round.chatId, pending.round.id, pending.round.revision, pending.versionId, pending.feed);
			if (!write.current() || this.pending !== pending) return;
			this.rounds = this.rounds.some(r => r.id === round.id)
				? this.rounds.map(r => r.id === round.id && r.revision < round.revision ? round : r)
				: [...this.rounds, round].sort((a, b) => a.createdAt - b.createdAt);
			this.viewedRoundId = round.id;
			this.pending = null;
			if ('input' in pending) {
				this.clearSelection();
				this.label = '';
			}
			this.tab = 'feed';
		} catch (error) { if (write.current() && this.pending === pending) this.error = error instanceof Error ? error.message : String(error); }
		finally { write.finish(); }
	}
	async updateSummary(round: ThreadsRound, expectedSummary: string, summary: string) {
		if (this.chatId !== round.chatId || this.busy) throw new Error('Threads is busy or this chat has changed. Try again.');
		const write = this.beginWrite(round.chatId, 'saving-summary');
		try {
			const saved = await db.updateThreadsSummary(round.chatId, round.id, expectedSummary, summary);
			if (write.current()) this.rounds = this.rounds.map(r => r.id === saved.id && r.revision < saved.revision ? saved : r);
		} finally { write.finish(); }
	}
	async chooseVersion(round: ThreadsRound, versionId: string) {
		if (this.chatId !== round.chatId || this.busy) return;
		const write = this.beginWrite(round.chatId, 'saving');
		try {
			const saved = await db.setThreadsVersion(round.chatId, round.id, round.revision, versionId);
			if (write.current()) this.rounds = this.rounds.map(r => r.id === saved.id && r.revision < saved.revision ? saved : r);
		} catch (error) { if (write.current()) this.error = error instanceof Error ? error.message : String(error); }
		finally { write.finish(); }
	}
	async resetContinuity(chatId: string, expected: { id: string; revision: number }[]) {
		if (this.chatId !== chatId || !this.loaded || this.busy || this.pending) return;
		const write = this.beginWrite(chatId, 'saving'); this.error = '';
		try {
			await db.resetThreadsContinuity(chatId, expected);
			if (write.current()) { this.rounds = []; this.viewedRoundId = null; this.tab = 'make'; }
		} catch (error) {
			if (write.current()) this.error = error instanceof Error ? error.message : String(error);
		} finally { write.finish(); }
	}
	async remove(round: ThreadsRound) {
		if (this.chatId !== round.chatId || this.busy) return;
		const write = this.beginWrite(round.chatId, 'saving');
		try {
			await db.deleteThreadsRound(round.chatId, round.id, round.revision);
			if (write.current()) {
				this.rounds = this.rounds.filter(r => r.id !== round.id);
				if (this.viewedRoundId === round.id) this.viewedRoundId = this.rounds.at(-1)?.id ?? null;
			}
		} catch (error) { if (write.current()) this.error = error instanceof Error ? error.message : String(error); }
		finally { write.finish(); }
	}
}
export const threadsStore = new ThreadsStore();
