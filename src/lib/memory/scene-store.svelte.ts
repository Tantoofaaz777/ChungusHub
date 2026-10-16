/** Manual scene summaries. Saved text replaces its source range; generating is only a draft. */
import { db as database } from '$lib/services/database';
import { llmService } from '$lib/services/llm/provider';
import { featurePromptsStore } from '$lib/stores/featurePrompts.svelte';
import { characterLibraryStore } from '$lib/stores/characterLibrary.svelte';
import { personaEntryFor, toPromptCharacter } from '$lib/utils/chat-setup';
import { expandSelfRefs } from '$lib/macros';
import { EMPTY_IMPACT } from './branching';
import { markSceneBoundary } from './scene-selection';
import type { ChatCtx } from './store.svelte';
import { chapterTitle, captureScene, resolveScenes, scenePath, sceneSignature, type MemoryScene, type SceneSource } from '../../../shared/memory-scenes';

interface Draft {
	chatId: string; sceneId?: string; expectedRevision?: number;
	title: string; content: string; source: SceneSource[];
	phase: 'ready' | 'generating' | 'error'; error: string;
}
class SceneMemoryStore {
	activeChatId = $state<string | null>(null);
	loaded = $state(false);
	scenes = $state<MemoryScene[]>([]);
	private ctx = $state.raw<ChatCtx | null>(null);
	private ticket = 0;
	private abort: AbortController | null = null;
	enabled = true;
	autoExtract = false;
	recall = '';
	selection = $state<{ chatId: string; startId: string | null; endId: string | null; sceneId?: string; seed?: Pick<Draft, 'title' | 'content' | 'expectedRevision'> } | null>(null);
	draft = $state<Draft | null>(null);
	saving = $state(false);
	private currentPath = $derived(this.ctx ? scenePath(this.ctx.allMessages, this.ctx.leafId) : []);
	private sceneStates = $derived(resolveScenes(this.scenes, this.currentPath, this.ctx?.allMessages ?? []));
	get path() { return this.currentPath; }
	get resolved() { return this.sceneStates; }
	get archivedMessageIds() { return new Set(this.resolved.filter((r) => r.status === 'active').flatMap((r) => r.scene.source.map((s) => s.id))); }
	get activeScenes() { return this.resolved.filter((r) => r.status === 'active').map((r) => r.scene); }
	get standing(): { kind: 'idle' | 'working' | 'behind' | 'error'; label: string; outstanding: number } {
		if (this.draft?.phase === 'generating') return { kind: 'working', label: 'Generating chapter', outstanding: 1 };
		const reviews = this.resolved.filter((r) => r.status === 'review').length;
		return { kind: reviews ? 'behind' : 'idle', label: reviews ? `${reviews} ${reviews === 1 ? 'chapter needs' : 'chapters need'} review` : 'Manual chapters', outstanding: reviews };
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
		if (this.activeChatId !== chatId) { this.cancelDraft(); this.selection = null; this.ctx = null; this.scenes = []; }
		this.activeChatId = chatId; this.loaded = false;
		const scenes = await database.getMemoryScenes(chatId);
		if (ticket !== this.ticket || this.activeChatId !== chatId) return;
		this.scenes = scenes; this.loaded = true;
	}
	clear() { ++this.ticket; this.cancelDraft(); this.activeChatId = null; this.ctx = null; this.scenes = []; this.selection = null; this.loaded = false; }
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
		this.cancelDraft();
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
		this.draft = { chatId: selection.chatId, sceneId: selection.sceneId, expectedRevision: selection.seed?.expectedRevision ?? previous?.revision,
			title: selection.seed?.title ?? (previous ? chapterTitle(previous.title) : undefined) ?? `Chapter ${index + 1}–${index + range.length}`, content: selection.seed?.content ?? previous?.content ?? '',
			source: captureScene(range), phase: 'ready', error: '' };
		this.selection = null;
		if (!selection.seed?.content.trim()) await this.generateDraft();
	}
	reselectDraft() {
		const draft = this.draft;
		if (!draft) return;
		const seed = { title: draft.title, content: draft.content, expectedRevision: draft.expectedRevision };
		this.startSelection(draft.sceneId);
		if (this.selection) this.selection = { ...this.selection, seed };
	}
	editScene(scene: MemoryScene) {
		this.cancelDraft();
		// Review binds to what is on screen now. Saving still verifies that snapshot on the server.
		const wanted = new Set(scene.source.map((s) => s.id));
		const range = this.path.filter((m) => wanted.has(m.id));
		this.draft = { chatId: scene.chatId, sceneId: scene.id, expectedRevision: scene.revision,
			title: chapterTitle(scene.title), content: scene.content,
			source: range.length === scene.source.length ? captureScene(range) : scene.source.map((s) => ({ ...s })),
			phase: 'ready', error: '' };
	}
	async generateDraft() {
		const draft = this.draft;
		if (!draft || this.saving || draft.phase === 'generating') return;
		this.abort?.abort();
		const controller = this.abort = new AbortController();
		draft.phase = 'generating'; draft.error = '';
		try {
			if (!featurePromptsStore.memoryEnabled) throw new Error('Enable Chat Memory in Settings → Engines to generate a chapter, or write one below.');
			const all = new Map(this.path.map((m) => [m.id, m]));
			const source = draft.source.map((s) => all.get(s.id));
			if (source.some((m, i) => !m || sceneSignature(m) !== draft.source[i].signature)) throw new Error('Source messages are unavailable on this branch. Select the chapter range again.');
			const messages = source.filter((m) => m && !m.excludedFromPrompt);
			const entry = characterLibraryStore.entries.find((e) => e.id === this.ctx?.characterId);
			const character = entry ? toPromptCharacter(entry, characterLibraryStore.dataForVersion(entry, this.ctx?.characterVersionId ?? null)) : null;
			const persona = toPromptCharacter(personaEntryFor(this.ctx?.personaId ?? null));
			const charName = character?.name || 'Narrator', userName = persona?.name || 'User';
			const transcript = messages.map((m) => `[${m!.role === 'assistant' ? charName : m!.role === 'user' ? userName : 'System'}]\n${expandSelfRefs(m!.content, charName, userName, persona?.pronouns ?? {})}`).join('\n\n');
			const result = await llmService.complete({ engine: 'memory' }, { source: 'memory', signal: controller.signal,
				messages: [{ role: 'system', content: featurePromptsStore.promptFor('memoryScene') },
					{ role: 'user', content: `Create a chapter summarizing these messages:\n\n${transcript}` }] });
			if (controller.signal.aborted || this.abort !== controller || this.draft !== draft) return;
			if (!result.content.trim()) throw new Error('The model returned no chapter. Check the connection’s output limit or write one below.');
			draft.content = result.content.trim(); draft.phase = 'ready';
		} catch (error) {
			if (controller.signal.aborted || this.draft !== draft) return;
			draft.error = error instanceof Error ? error.message : String(error); draft.phase = 'error';
		} finally { if (this.abort === controller) this.abort = null; }
	}
	cancelDraft() { this.abort?.abort(); this.abort = null; this.draft = null; }
	async saveDraft() {
		const draft = this.draft;
		if (!draft || this.saving || draft.phase === 'generating') return;
		this.saving = true; draft.error = '';
		try {
			const saved = await database.saveMemoryScene({ id: draft.sceneId, chatId: draft.chatId, title: draft.title,
				content: draft.content, source: $state.snapshot(draft.source), expectedRevision: draft.expectedRevision });
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
