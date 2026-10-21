/** Manual scene summaries. Saved text replaces its source range; generating is only a draft. */
import { db as database } from '$lib/services/database';
import { llmService } from '$lib/services/llm/provider';
import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
import { personaEntryFor, toPromptCharacter } from '$lib/utils/chat-setup';
import { expandSelfRefs } from '$lib/macros';
import { EMPTY_IMPACT } from './branching';
import { markSceneBoundary } from './scene-selection';
import { parseChapterResponse } from './chapter-response';
import { generationSourcePrompt, previousGenerationSummaries } from './generation-context';
import { retainLocalChanges } from '$lib/utils/retain-local-changes';
import type { ChatCtx } from './store.svelte';
import type { Message } from '$lib/types/chat';
import { chapterTitle, captureScene, resolveScenes, scenePath, sceneSignature, sceneLevel, memoryLabel, prepareCompaction, type MemoryScene, type SceneSource, type MemoryLevel, type CompactionLevel, type MemoryChild } from '../../../shared/memory-scenes';

interface Draft {
	chatId: string; sceneId?: string; expectedRevision?: number; level: MemoryLevel; children: MemoryChild[];
	title: string; content: string; source: SceneSource[];
	phase: 'ready' | 'generating' | 'error'; error: string;
}
export class SceneMemoryStore {
	activeChatId = $state<string | null>(null);
	loaded = $state(false);
	refreshing = $state(false);
	loadError = $state('');
	scenes = $state<MemoryScene[]>([]);
	private ctx = $state.raw<ChatCtx | null>(null);
	private ticket = 0;
	private abort: AbortController | null = null;
	enabled = true;
	autoExtract = false;
	recall = '';
	selection = $state<{ chatId: string; startId: string | null; endId: string | null; sceneId?: string; seed?: Pick<Draft, 'title' | 'content' | 'expectedRevision'> } | null>(null);
	compaction = $state<{ level: CompactionLevel; ids: string[]; sceneId?: string; seed?: Pick<Draft, 'title' | 'content' | 'expectedRevision'> } | null>(null);
	draft = $state<Draft | null>(null);
	/** Received text for the dialog's throttled counters; never persisted as chapter content. */
	generation = $state<{ id: string; model: string; reasoning: string; response: string } | null>(null);
	saving = $state(false);
	private currentPath = $derived(this.ctx ? scenePath(this.ctx.allMessages, this.ctx.leafId) : []);
	private sceneStates = $derived(resolveScenes(this.scenes, this.currentPath, this.ctx?.allMessages ?? []));
	get path() { return this.currentPath; }
	get draftSourceMessages(): Message[] | null {
		const draft = this.draft;
		if (!draft || this.ctx?.chatId !== draft.chatId) return null;
		const all = new Map(this.ctx.allMessages.map(message => [message.id, message]));
		const messages = draft.source.map(source => all.get(source.id));
		return messages.every((message): message is Message => !!message) ? messages : null;
	}
	get resolved() { return this.sceneStates; }
	get archivedMessageIds() { return new Set(this.resolved.filter((r) => r.status === 'active').flatMap((r) => r.scene.source.map((s) => s.id))); }
	get activeScenes() { return this.resolved.filter((r) => r.status === 'active').map((r) => r.scene); }
	get standing(): { kind: 'idle' | 'working' | 'behind' | 'error'; label: string; outstanding: number } {
		if (this.draft?.phase === 'generating') return { kind: 'working', label: `Generating ${this.draft.level}`, outstanding: 1 };
		const reviews = this.resolved.filter((r) => r.status === 'review').length;
		return { kind: reviews ? 'behind' : 'idle', label: reviews ? `${reviews} ${reviews === 1 ? 'memory needs' : 'memories need'} review` : 'Manual memory', outstanding: reviews };
	}
	get selectedMessages() {
		const s = this.selection;
		if (!s || s.chatId !== this.activeChatId || !s.startId || !s.endId) return [];
		const path = this.path, a = path.findIndex((m) => m.id === s.startId), b = path.findIndex((m) => m.id === s.endId);
		return a < 0 || b < 0 ? [] : path.slice(Math.min(a, b), Math.max(a, b) + 1);
	}
	get selectionError() {
		const ids = new Set(this.selectedMessages.map((m) => m.id));
		return this.resolved.some((r) => r.status === 'active' && r.scene.id !== this.selection?.sceneId && r.scene.source.some((s) => ids.has(s.id)))
			? 'This range overlaps a saved chapter. Review or remove that chapter first.' : '';
	}

	async loadForChat(chatId: string) {
		const ticket = ++this.ticket;
		if (this.activeChatId !== chatId) { this.cancelDraft(); this.compaction = null; this.selection = null; this.ctx = null; this.scenes = []; this.loaded = false; }
		this.activeChatId = chatId;
		// Refreshing the same chat must not collapse expanded chapters or the transcript's controls.
		this.refreshing = this.loaded; this.loadError = '';
		const before = [...this.scenes];
		try {
			const scenes = await database.getMemoryScenes(chatId);
			if (ticket !== this.ticket || this.activeChatId !== chatId) return;
			this.scenes = retainLocalChanges(scenes, before, this.scenes); this.loaded = true;
		} catch (error) {
			if (ticket === this.ticket) this.loadError = error instanceof Error ? error.message : String(error);
			throw error;
		} finally { if (ticket === this.ticket) this.refreshing = false; }
	}
	clear() { ++this.ticket; this.cancelDraft(); this.compaction = null; this.activeChatId = null; this.ctx = null; this.scenes = []; this.selection = null; this.loaded = false; this.refreshing = false; this.loadError = ''; }
	async syncForPath(ctx: ChatCtx) {
		if (this.activeChatId !== ctx.chatId) await this.loadForChat(ctx.chatId);
		if (this.activeChatId === ctx.chatId) this.ctx = ctx;
	}
	async syncReload() { const id = this.activeChatId; if (id) await this.loadForChat(id); }
	async getRecall(chatId: string, _path?: unknown) {
		return { text: null, archivedIds: new Set<string>(), scenes: await database.getMemoryScenes(chatId) };
	}
	async maintainAfterTurn(_ctx: ChatCtx) { /* Deliberately manual: no model calls after a turn. */ }
	async invalidateMessage(_chatId: string, _id: string) { return 0; }
	impactOf(..._args: unknown[]) { return EMPTY_IMPACT; }
	startSelection(sceneId?: string) {
		if (!this.activeChatId) return;
		this.cancelDraft(); this.compaction = null;
		this.selection = { chatId: this.activeChatId, startId: null, endId: null, sceneId };
	}
	setBoundary(boundary: 'start' | 'end', id: string) {
		if (!this.activeChatId || !this.loaded || this.saving || this.draft) return;
		const selection = this.selection?.chatId === this.activeChatId ? this.selection : null;
		const bounds = markSceneBoundary(this.path, selection, boundary, id);
		if (!bounds) return;
		this.selection = { ...selection, chatId: this.activeChatId, ...bounds };
	}
	async summarizeSelection() {
		const range = this.selectedMessages, selection = this.selection;
		if (!selection || this.selectionError || !range.some((m) => !m.excludedFromPrompt)) return;
		const previous = this.scenes.find((s) => s.id === selection.sceneId);
		const index = this.path.findIndex((m) => m.id === range[0].id);
		this.draft = { level: 'chapter', children: [], chatId: selection.chatId, sceneId: selection.sceneId, expectedRevision: selection.seed?.expectedRevision ?? previous?.revision,
			title: selection.seed?.title ?? (previous ? chapterTitle(previous.title) : undefined) ?? `Chapter ${index + 1}–${index + range.length}`, content: selection.seed?.content ?? previous?.content ?? '',
			source: captureScene(range), phase: 'ready', error: '' };
		this.selection = null;
		if (!selection.seed?.content.trim()) await this.generateDraft();
	}
	reselectDraft() {
		const draft = this.draft;
		if (!draft) return;
		const seed = { title: draft.title, content: draft.content, expectedRevision: draft.expectedRevision };
		if (draft.level !== 'chapter') {
			this.openCompaction(draft.level);
			this.compaction = { level: draft.level, ids: draft.children.map(c => c.id), sceneId: draft.sceneId, seed };
			return;
		}
		this.startSelection(draft.sceneId);
		if (this.selection) this.selection = { ...this.selection, seed };
	}
	editScene(scene: MemoryScene) {
		this.cancelDraft();
		// Review binds to what is on screen now. Saving still verifies that snapshot on the server.
		const wanted = new Set(scene.source.map((s) => s.id));
		const range = this.path.filter((m) => wanted.has(m.id));
		this.compaction = null; this.selection = null;
		const level = sceneLevel(scene);
		let source = range.length === scene.source.length ? captureScene(range) : scene.source.map(s => ({ ...s }));
		let children = (scene.children ?? []).map(c => ({ ...c }));
		if (level !== 'chapter') {
			try { ({ source, children } = prepareCompaction(level, children.map(c => c.id), this.scenes, this.path, this.ctx?.allMessages, scene.id)); }
			catch { /* Keep the old references visible for review; reselect can repair missing sources. */ }
		}
		this.draft = { level, children, chatId: scene.chatId, sceneId: scene.id, expectedRevision: scene.revision,
			title: chapterTitle(scene.title), content: scene.content,
			source,
			phase: 'ready', error: '' };
	}
	openCompaction(level: CompactionLevel) {
		if (!this.activeChatId || !this.loaded || this.saving) return;
		this.cancelDraft(); this.selection = null;
		this.compaction = { level, ids: [] };
	}
	get compactionCandidates() {
		const c = this.compaction;
		if (!c) return [];
		const lower = c.level === 'arc' ? 'chapter' : 'arc';
		return resolveScenes(this.scenes.filter(s => s.id !== c.sceneId), this.path, this.ctx?.allMessages)
			.filter(r => sceneLevel(r.scene) === lower && r.status === 'active').sort((a, b) => a.start - b.start);
	}
	toggleCompactionSource(id: string) {
		const c = this.compaction;
		if (c) c.ids = c.ids.includes(id) ? c.ids.filter(v => v !== id) : [...c.ids, id];
	}
	get compactionError() {
		const c = this.compaction;
		if (!c) return '';
		try { prepareCompaction(c.level, c.ids, this.scenes, this.path, this.ctx?.allMessages, c.sceneId); return ''; }
		catch (error) { return error instanceof Error ? error.message : String(error); }
	}
	async createCompaction(generate: boolean) {
		const c = this.compaction;
		if (!c || !this.activeChatId || this.saving || this.compactionError) return;
		const { source, children } = prepareCompaction(c.level, c.ids, this.scenes, this.path, this.ctx?.allMessages, c.sceneId);
		this.draft = { level: c.level, children, source, chatId: this.activeChatId, sceneId: c.sceneId,
			expectedRevision: c.seed?.expectedRevision, title: c.seed?.title ?? `${memoryLabel(c.level)} ${this.scenes.filter(s => sceneLevel(s) === c.level).length + 1}`,
			content: c.seed?.content ?? '', phase: 'ready', error: '' };
		this.compaction = null;
		if (generate) await this.generateDraft();
	}
	async generateDraft() {
		const draft = this.draft;
		if (!draft || this.saving || draft.phase === 'generating') return;
		this.abort?.abort();
		const controller = this.abort = new AbortController();
		this.generation = null;
		draft.phase = 'generating'; draft.error = '';
		try {
			if (!featurePromptsStore.memoryEnabled) throw new Error(`Enable Chat Memory in Settings → Engines to generate a ${draft.level}, or write one below.`);
			let transcript: string;
			if (draft.level === 'chapter') {
				const all = new Map(this.path.map((m) => [m.id, m]));
				const source = draft.source.map((s) => all.get(s.id));
				if (source.some((m, i) => !m || sceneSignature(m) !== draft.source[i].signature)) throw new Error('Source messages are unavailable on this branch. Select the chapter range again.');
				const messages = source.filter((m) => m && !m.excludedFromPrompt);
				const entry = characterLibraryStore.entries.find((e) => e.id === this.ctx?.characterId);
				const character = entry ? toPromptCharacter(entry, characterLibraryStore.dataForVersion(entry, this.ctx?.characterVersionId ?? null)) : null;
				const persona = toPromptCharacter(personaEntryFor(this.ctx?.personaId ?? null));
				const charName = character?.name || 'Narrator', userName = persona?.name || 'User';
				transcript = messages.map((m) => `[${m!.role === 'assistant' ? charName : m!.role === 'user' ? userName : 'System'}]\n${expandSelfRefs(m!.content, charName, userName, persona?.pronouns ?? {})}`).join('\n\n');
			} else {
				const prepared = prepareCompaction(draft.level, draft.children.map(c => c.id), this.scenes, this.path, this.ctx?.allMessages, draft.sceneId);
				if (JSON.stringify(prepared.children) !== JSON.stringify(draft.children) || JSON.stringify(prepared.source) !== JSON.stringify(draft.source)) throw new Error('Source memories changed. Reselect the sources before generating.');
				transcript = draft.children.map(c => this.scenes.find(s => s.id === c.id)!).map(s => `[${memoryLabel(sceneLevel(s))}: ${chapterTitle(s.title)}]\n${s.content}`).join('\n\n');
			}
			const promptKey = draft.level === 'chapter' ? 'memoryScene' : draft.level === 'arc' ? 'memoryArc' : 'memoryVolume';
			const previous = previousGenerationSummaries(this.scenes, this.path, this.ctx?.allMessages ?? this.path,
				draft.chatId, draft.source, featurePromptsStore.memoryPreviousSummaries);
			const target = { engine: 'memory' } as const;
			this.generation = { id: crypto.randomUUID(), model: llmService.modelFor(target), reasoning: '', response: '' };
			const receive = (text: string, thinking: boolean) => {
				if (controller.signal.aborted || this.abort !== controller || this.draft !== draft || !this.generation) return;
				if (thinking) this.generation.reasoning += text; else this.generation.response += text;
			};
			const result = await llmService.complete(target, { source: 'memory', signal: controller.signal,
				onToken: text => receive(text, false), onThinkingToken: text => receive(text, true),
				messages: [{ role: 'system', content: featurePromptsStore.promptFor(promptKey) },
					{ role: 'user', content: generationSourcePrompt(draft.level, transcript, previous) }] });
			if (controller.signal.aborted || this.abort !== controller || this.draft !== draft) return;
			const chapter = parseChapterResponse(result.content, memoryLabel(draft.level));
			if (chapter.title !== undefined) draft.title = chapter.title;
			draft.content = chapter.content; draft.phase = 'ready';
		} catch (error) {
			if (controller.signal.aborted || this.draft !== draft) return;
			draft.error = error instanceof Error ? error.message : String(error); draft.phase = 'error';
		} finally { if (this.abort === controller) { this.abort = null; this.generation = null; } }
	}
	cancelDraft() { this.abort?.abort(); this.abort = null; this.generation = null; this.draft = null; }
	async saveDraft() {
		const draft = this.draft;
		if (!draft || this.saving || draft.phase === 'generating') return;
		this.saving = true; draft.error = '';
		try {
			const saved = await database.saveMemoryScene({ id: draft.sceneId, chatId: draft.chatId, title: draft.title,
				content: draft.content, source: $state.snapshot(draft.source), expectedRevision: draft.expectedRevision,
				level: draft.level, children: $state.snapshot(draft.children) });
			if (this.activeChatId === saved.chatId) {
				this.scenes = this.scenes.some((chapter) => chapter.id === saved.id)
					? this.scenes.map((chapter) => chapter.id === saved.id ? saved : chapter)
					: [...this.scenes, saved];
			}
			if (this.draft === draft) this.draft = null;
		} catch (error) { draft.error = error instanceof Error ? error.message : String(error); }
		finally { this.saving = false; }
	}
	async removeScene(scene: MemoryScene) {
		await database.deleteMemoryScene(scene.chatId, scene.id, scene.revision);
		if (this.activeChatId === scene.chatId) this.scenes = this.scenes.filter((s) => s.id !== scene.id);
	}
}
export const memoryStore = new SceneMemoryStore();
