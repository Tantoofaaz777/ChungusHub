import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { captureScene, type MemoryScene } from '$shared/memory-scenes';
import type { Message } from '$lib/types/chat';

// Test read ordering and retained data; Svelte compiles runes in the app build.
const identity = <T>(value: T) => value;
(globalThis as any).$state = Object.assign(identity, { raw: identity, snapshot: structuredClone });
(globalThis as any).$derived = Object.assign(identity, { by: (fn: () => unknown) => fn() });
const realDatabase = { ...await import('$lib/services/database') };
const realLlm = { ...await import('$lib/services/llm/provider') };
const { featurePromptsStore, normalizeFeaturePrompts, FEATURE_PROMPT_DEFAULTS } = await import('$lib/stores/featurePrompts.svelte');
const initialFeatures = structuredClone(featurePromptsStore.state);
afterAll(() => {
	mock.module('$lib/services/database', () => realDatabase);
	mock.module('$lib/services/llm/provider', () => realLlm);
	featurePromptsStore.state = initialFeatures;
});

let reads: { chatId: string; resolve: (scenes: MemoryScene[]) => void; reject: (error: Error) => void }[] = [];
let calls: { signal: AbortSignal; messages: { role: string; content: string }[]; onToken: (text: string) => void; onThinkingToken: (text: string) => void;
	resolve: (result: { content: string; thinking?: string }) => void; reject: (error: Error) => void }[] = [];
mock.module('$lib/services/llm/provider', () => ({ ...realLlm, llmService: {
	modelFor: () => 'memory-test-model',
	complete: (_target: unknown, options: any) => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject }))
} }));
mock.module('$lib/services/database', () => ({ ...realDatabase, db: {
	...realDatabase.db,
	getMemoryScenes: (chatId: string) => new Promise<MemoryScene[]>((resolve, reject) => reads.push({ chatId, resolve, reject })),
	deleteMemoryScene: async () => {},
	saveMemoryScene: async (input: Partial<MemoryScene> & { expectedRevision?: number }) => ({ ...chapter(), ...input, id: input.id ?? 'new-chapter', revision: (input.expectedRevision ?? 0) + 1 })
} }));
const { SceneMemoryStore } = await import('./scene-store.svelte');
let store: InstanceType<typeof SceneMemoryStore>;
beforeEach(() => { reads = []; calls = []; featurePromptsStore.state = { ...initialFeatures, memoryEnabled: true }; store = new SceneMemoryStore(); });
const chapter = (chatId = 'a'): MemoryScene => ({
	id: `chapter-${chatId}`, chatId, title: 'A chapter', content: 'Saved summary', source: [],
	createdAt: 1, updatedAt: 1, revision: 1, reviewReason: null
});

describe('chapter source counts and generation progress', () => {
	const messages = [
		{ id: 'first', parentId: null, role: 'user', content: 'Original {{char}} message', chatId: 'a' },
		{ id: 'second', parentId: 'first', role: 'assistant', content: 'Original **reply**', excludedFromPrompt: true, chatId: 'a' }
	] as Message[];
	async function draft() {
		await open();
		await store.syncForPath({ chatId: 'a', allMessages: messages, leafId: 'second', characterId: null,
			characterVersionId: null, personaId: null });
		// Bun's rune shim does not recompute derived fields; supply the already tested path.
		Object.defineProperty(store, 'path', { configurable: true, get: () => messages });
		store.draft = { chatId: 'a', level: 'chapter', children: [], source: captureScene(messages),
			title: 'A chapter', content: 'Previous draft', phase: 'ready', error: '' };
	}
	test('source counts use original message text, independent of summary edits or source order', async () => {
		await draft(); store.draft!.source.reverse();
		expect(store.draftSourceMessages?.map(message => message.content)).toEqual([messages[1].content, messages[0].content]);
		store.draft!.content = 'An entirely different summary'; store.draft!.title = 'Edited title';
		expect(store.draftSourceMessages?.map(message => message.content)).toEqual([messages[1].content, messages[0].content]);
	});
	test('missing source messages give an unknown total rather than a partial count', async () => {
		await draft(); store.draft!.source.push({ id: 'deleted', signature: 'missing' });
		expect(store.draftSourceMessages).toBeNull();
		store.draft!.chatId = 'other'; expect(store.draftSourceMessages).toBeNull();
		store.cancelDraft(); expect(store.draftSourceMessages).toBeNull();
	});
	test('compaction drafts still report original messages rather than child summaries', async () => {
		await draft(); store.draft!.level = 'arc'; store.draft!.children = [{ id: 'child', revision: 1 }];
		store.scenes = [{ ...chapter(), id: 'child', content: 'Different compressed text', source: captureScene(messages) }];
		expect(store.draftSourceMessages?.map(message => message.content)).toEqual(messages.map(message => message.content));
	});
	test('receives reasoning/response separately under the memory model without changing draft content', async () => {
		await draft(); const work = store.generateDraft(), call = calls[0];
		expect(store.generation).toMatchObject({ model: 'memory-test-model', reasoning: '', response: '' });
		call.onThinkingToken('First '); call.onThinkingToken('thought'); call.onToken('{"title":');
		expect(store.generation).toMatchObject({ reasoning: 'First thought', response: '{"title":' });
		expect(store.draft!.content).toBe('Previous draft');
		call.resolve({ content: '{"title":"New title","content":"Final chapter"}', thinking: 'Final thinking' }); await work;
		expect(store.draft).toMatchObject({ title: 'New title', content: 'Final chapter', phase: 'ready' });
		expect(store.generation).toBeNull();
	});
	test('cancelled chunks and an old completion cannot update a newer generation', async () => {
		await draft(); const old = store.generateDraft(), oldCall = calls[0];
		oldCall.onThinkingToken('Old thought'); store.cancelDraft();
		expect(oldCall.signal.aborted).toBe(true); expect(store.generation).toBeNull();
		await draft(); const current = store.generateDraft(), currentCall = calls[1], id = store.generation!.id;
		oldCall.onToken('Late response'); oldCall.resolve({ content: 'Old chapter' }); await old;
		expect(store.generation).toMatchObject({ id, reasoning: '', response: '' });
		currentCall.onToken('New response'); expect(store.generation!.response).toBe('New response');
		currentCall.resolve({ content: 'Current chapter' }); await current;
		expect(store.draft!.content).toBe('Current chapter'); expect(store.generation).toBeNull();
	});
	test('a failed generation clears progress and preserves editable draft text', async () => {
		await draft(); const work = store.generateDraft(); calls[0].onToken('Partial'); calls[0].reject(new Error('Connection lost')); await work;
		expect(store.generation).toBeNull();
		expect(store.draft).toMatchObject({ phase: 'error', error: 'Connection lost', content: 'Previous draft' });
	});
	test('switching chats cancels progress and ignores remaining source-chat callbacks', async () => {
		await draft(); const work = store.generateDraft(), call = calls[0]; call.onThinkingToken('Source chat');
		const opening = store.loadForChat('b'); reads.shift()!.resolve([]); await opening;
		call.onToken('Late content'); call.resolve({ content: 'Late chapter' }); await work;
		expect(call.signal.aborted).toBe(true); expect(store.draft).toBeNull(); expect(store.generation).toBeNull();
	});
});
async function open() {
	const opening = store.loadForChat('a');
	reads.shift()!.resolve([chapter()]); await opening;
}

describe('generation request context', () => {
	test.each(['chapter', 'arc', 'volume'] as const)('%s keeps instructions in system and earlier summaries in user', async level => {
		const messages = Array.from({ length: 16 }, (_, i) => ({
			id: `m${i}`, parentId: i ? `m${i - 1}` : null, role: 'assistant', content: `Message ${i}`, chatId: 'a'
		})) as Message[];
		const chapters = messages.map((message, i) => ({ ...chapter(), id: `c${i}`, title: `Chapter ${i}`, content: `Chapter summary ${i}`, source: captureScene([message]) }));
		const arcs = Array.from({ length: 8 }, (_, i) => ({ ...chapter(), id: `a${i}`, level: 'arc' as const,
			title: `Arc ${i}`, content: `Arc summary ${i}`, source: chapters.slice(i * 2, i * 2 + 2).flatMap(c => c.source),
			children: chapters.slice(i * 2, i * 2 + 2).map(c => ({ id: c.id, revision: c.revision })) }));
		const volumes = Array.from({ length: 3 }, (_, i) => ({ ...chapter(), id: `v${i}`, level: 'volume' as const,
			title: `Volume ${i}`, content: `Volume summary ${i}`, source: arcs.slice(i * 2, i * 2 + 2).flatMap(c => c.source),
			children: arcs.slice(i * 2, i * 2 + 2).map(c => ({ id: c.id, revision: c.revision })) }));
		const scenes = level === 'chapter' ? [...chapters.slice(0, 12), ...arcs.slice(0, 6), ...volumes]
			: level === 'arc' ? [...chapters, ...arcs.slice(0, 6), ...volumes] : [...chapters, ...arcs, ...volumes];
		const opening = store.loadForChat('a'); reads.shift()!.resolve(scenes.reverse()); await opening;
		await store.syncForPath({ chatId: 'a', allMessages: messages, leafId: 'm15', characterId: null,
			characterVersionId: null, personaId: null });
		Object.defineProperty(store, 'path', { configurable: true, get: () => messages });
		const children = level === 'chapter' ? [] : (level === 'arc' ? chapters.slice(12, 14) : arcs.slice(6, 8)).map(c => ({ id: c.id, revision: c.revision }));
		store.draft = { chatId: 'a', level, children, source: captureScene(messages.slice(12, level === 'volume' ? 16 : level === 'arc' ? 14 : 13)),
			title: 'New memory', content: '', phase: 'ready', error: '' };
		featurePromptsStore.state = { ...featurePromptsStore.state, memoryPreviousSummaries: 2 };
		const work = store.generateDraft(), call = calls[0];
		const key = level === 'chapter' ? 'memoryScene' : level === 'arc' ? 'memoryArc' : 'memoryVolume';
		expect(call.messages.map(message => message.role)).toEqual(['system', 'user']);
		expect(call.messages[0].content).toBe(featurePromptsStore.promptFor(key));
		const user = call.messages[1].content;
		expect(user).not.toContain('Volume summary 0');
		expect(user.indexOf('Volume summary 1')).toBeGreaterThan(0);
		expect(user.indexOf('Volume summary 2')).toBeGreaterThan(user.indexOf('Volume summary 1'));
		expect(user.indexOf('=== SOURCE TO SUMMARIZE ===')).toBeGreaterThan(user.indexOf('Volume summary 2'));
		expect(user).toContain(level === 'chapter' ? 'Message 12' : level === 'arc' ? 'Chapter summary 12' : 'Arc summary 6');
		call.resolve({ content: 'New summary' }); await work;
		// Disabling context affects the next generation and never changes its sources.
		featurePromptsStore.state = { ...featurePromptsStore.state, memoryPreviousSummaries: 0 };
		const again = store.generateDraft();
		expect(calls[1].messages[1].content).not.toContain('PREVIOUS SCENE CONTEXT');
		expect(calls[1].messages[1].content).not.toContain('Volume summary');
		calls[1].resolve({ content: 'Another summary' }); await again;
	});
});

describe('memory refresh lifecycle', () => {
	test('first load waits for data, while refreshes retain loaded chapters and local work', async () => {
		const opening = store.loadForChat('a');
		expect(store.loaded).toBe(false); expect(store.refreshing).toBe(false);
		reads.shift()!.resolve([chapter()]); await opening;
		store.selection = { chatId: 'a', startId: 'message', endId: null };
		store.compaction = { level: 'arc', ids: ['chapter-a'] };
		const refresh = store.syncReload();
		expect(store.loaded).toBe(true); expect(store.refreshing).toBe(true); expect(store.scenes).toEqual([chapter()]);
		expect(store.selection?.startId).toBe('message'); expect(store.compaction?.ids).toEqual(['chapter-a']);
		reads.shift()!.resolve([{ ...chapter(), content: 'Updated summary', revision: 2 }]); await refresh;
		expect(store.loaded).toBe(true); expect(store.refreshing).toBe(false); expect(store.scenes[0].content).toBe('Updated summary');
		expect(store.selection?.startId).toBe('message'); expect(store.compaction?.ids).toEqual(['chapter-a']);
	});
	test('failed refreshes retain chapters and can be retried without hiding content', async () => {
		await open(); const refresh = store.syncReload();
		reads.shift()!.reject(new Error('Offline')); await expect(refresh).rejects.toThrow('Offline');
		expect(store.loaded).toBe(true); expect(store.refreshing).toBe(false); expect(store.scenes).toEqual([chapter()]); expect(store.loadError).toBe('Offline');
		const retry = store.syncReload(); expect(store.loaded).toBe(true); expect(store.loadError).toBe('');
		reads.shift()!.resolve([]); await retry;
		expect(store.loaded).toBe(true); expect(store.scenes).toEqual([]); expect(store.loadError).toBe('');
	});
	test('a failed first load remains unloaded until a retry succeeds', async () => {
		const opening = store.loadForChat('a'); reads.shift()!.reject(new Error('Offline'));
		await expect(opening).rejects.toThrow('Offline'); expect(store.loaded).toBe(false); expect(store.loadError).toBe('Offline');
		await open(); expect(store.loaded).toBe(true); expect(store.loadError).toBe('');
	});
	test('a stale refresh cannot undo a local chapter deletion or save', async () => {
		await open(); const refresh = store.syncReload();
		await store.removeScene(chapter());
		store.draft = { chatId: 'a', level: 'chapter', children: [], source: [], title: 'New', content: 'Saved now', phase: 'ready', error: '' };
		await store.saveDraft(); reads.shift()!.resolve([chapter()]); await refresh;
		expect(store.scenes.map(scene => scene.id)).toEqual(['new-chapter']); expect(store.scenes[0].content).toBe('Saved now');
	});
	test('concurrent edits retain a local save but still accept a higher server revision', async () => {
		for (const revision of [1, 3]) {
			await open(); const refresh = store.syncReload();
			store.draft = { chatId: 'a', sceneId: 'chapter-a', expectedRevision: 1, level: 'chapter', children: [], source: [], title: 'Edited', content: 'Local edit', phase: 'ready', error: '' };
			await store.saveDraft(); reads.shift()!.resolve([{ ...chapter(), revision, content: 'Remote edit' }]); await refresh;
			expect(store.scenes[0].revision).toBe(Math.max(2, revision));
			expect(store.scenes[0].content).toBe(revision > 2 ? 'Remote edit' : 'Local edit');
		}
	});
	test('switching chats clears old data and ignores a late refresh', async () => {
		await open(); store.selection = { chatId: 'a', startId: 'message', endId: null };
		const refresh = store.syncReload(), next = store.loadForChat('b');
		expect(store.activeChatId).toBe('b'); expect(store.loaded).toBe(false); expect(store.refreshing).toBe(false);
		expect(store.scenes).toEqual([]); expect(store.selection).toBeNull();
		reads[1].resolve([chapter('b')]); await next;
		reads[0].resolve([chapter()]); await refresh;
		expect(store.activeChatId).toBe('b'); expect(store.scenes).toEqual([chapter('b')]); expect(store.loaded).toBe(true);
	});
	test('an older failure cannot overwrite a newer refresh or reset its progress', async () => {
		await open(); const older = store.syncReload(), newer = store.syncReload();
		reads.shift()!.reject(new Error('Old failure')); await expect(older).rejects.toThrow('Old failure');
		expect(store.refreshing).toBe(true); expect(store.loadError).toBe('');
		reads.shift()!.resolve([chapter()]); await newer;
		expect(store.refreshing).toBe(false); expect(store.loaded).toBe(true);
	});
	test('clearing memory invalidates pending reads and errors', async () => {
		await open(); const refresh = store.syncReload(); store.clear();
		reads.shift()!.resolve([chapter()]); await refresh;
		expect(store.activeChatId).toBeNull(); expect(store.loaded).toBe(false); expect(store.refreshing).toBe(false);
		expect(store.scenes).toEqual([]); expect(store.loadError).toBe('');
	});
});

test('retired automatic-memory settings are ignored while current memory prompts and settings survive', () => {
 const legacy = { ...initialFeatures, memoryEnabled: false, memoryPreviousSummaries: 9,
  memoryDefaults: { batchSize: 99, verbatimTail: 42 },
  overrides: { memoryScene: 'My chapter prompt', memoryArc: 'My arc prompt', memoryVolume: 'My volume prompt',
   memoryExtract: 'Retired extractor', memoryPromote: 'Retired promoter' } };
 const normalized = normalizeFeaturePrompts(legacy);
 expect(normalized.memoryEnabled).toBe(false);
 expect(normalized.memoryPreviousSummaries).toBe(9);
 expect(normalized.overrides).toEqual({ memoryScene: 'My chapter prompt', memoryArc: 'My arc prompt', memoryVolume: 'My volume prompt' });
 expect(Object.hasOwn(normalized, 'memoryDefaults')).toBe(false);
 expect(Object.hasOwn(FEATURE_PROMPT_DEFAULTS, 'memoryExtract')).toBe(false);
 expect(Object.hasOwn(FEATURE_PROMPT_DEFAULTS, 'memoryPromote')).toBe(false);
});

test('loading a chat and refreshing its path never starts automatic model work', async () => {
 await open();
 const ctx = { chatId: 'a', allMessages: [], leafId: null, characterId: null, characterVersionId: null, personaId: null };
 await store.syncForPath(ctx);
 await store.syncForPath({ ...ctx, leafId: 'another-turn' });
 expect(calls).toHaveLength(0);
 expect(store.draft).toBeNull();
});
