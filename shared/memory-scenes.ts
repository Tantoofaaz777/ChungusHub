/** Scene memory's pure model, shared by persistence, prompt assembly and the UI. */
export interface SceneMessage {
	id: string;
	parentId: string | null;
	role: 'user' | 'assistant' | 'system';
	content: string;
	excludedFromPrompt?: boolean;
	attachments?: { kind: string; path: string }[] | null;
}

export interface SceneSource { id: string; signature: string }
export const MEMORY_LEVELS = ['chapter', 'arc', 'volume'] as const;
export type MemoryLevel = typeof MEMORY_LEVELS[number];
export type CompactionLevel = Exclude<MemoryLevel, 'chapter'>;
export interface MemoryChild { id: string; revision: number }
export const sceneLevel = (scene: { level?: MemoryLevel }): MemoryLevel => scene.level ?? 'chapter';
export const memoryLabel = (level: MemoryLevel): string => ({ chapter: 'Chapter', arc: 'Arc', volume: 'Volume' })[level];
export interface MemoryScene {
	id: string;
	chatId: string;
	title: string;
	content: string;
	source: SceneSource[];
	createdAt: number;
	updatedAt: number;
	revision: number;
	reviewReason: string | null;
	level?: MemoryLevel;
	children?: MemoryChild[];
}
export interface SaveMemoryScene {
	id?: string;
	chatId: string;
	title: string;
	content: string;
	source: SceneSource[];
	expectedRevision?: number;
	level?: MemoryLevel;
	children?: MemoryChild[];
}
export type SceneStatus = 'active' | 'covered' | 'review' | 'other-branch';
export interface ResolvedScene { scene: MemoryScene; status: SceneStatus; reason: string; start: number; end: number; coveredBy?: string }

/** Present titles generated before chapters were named, preserving custom titles
 *  and the stored data. An explicit edit/save can persist the new default name. */
export function chapterTitle(title: string): string {
	return title.replace(/^Scene (\d+[–-]\d+)$/, 'Chapter $1');
}

/** A synchronous 64-bit content fingerprint, not a security primitive. IDs are separate so
 *  copies can remap them without changing signatures. Visibility is part of the input. */
export function sceneSignature(message: SceneMessage): string {
	const value = JSON.stringify([message.role, message.content, !!message.excludedFromPrompt, message.attachments ?? []]);
	let a = 2166136261, b = 2246822519;
	for (let i = 0; i < value.length; i++) {
		a = Math.imul(a ^ value.charCodeAt(i), 16777619);
		b = Math.imul(b ^ value.charCodeAt(i), 3266489917);
	}
	return `${value.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}
export const captureScene = (messages: SceneMessage[]): SceneSource[] =>
	messages.map((message) => ({ id: message.id, signature: sceneSignature(message) }));

export function scenePath<T extends SceneMessage>(messages: T[], leafId: string | null): T[] {
	const byId = new Map(messages.map((message) => [message.id, message]));
	const path: T[] = [], seen = new Set<string>();
	for (let id = leafId; id && !seen.has(id); ) {
		seen.add(id);
		const message = byId.get(id);
		if (!message) break;
		path.push(message);
		id = message.parentId;
	}
	return path.reverse();
}

export function resolveScenes(scenes: MemoryScene[], path: SceneMessage[], all: SceneMessage[] = path): ResolvedScene[] {
	const byId = new Map(all.map((message) => [message.id, message]));
	const positions = new Map(path.map((message, index) => [message.id, index]));
	const signatures = new Map<string, string>();
	const resolved = scenes.map((scene): ResolvedScene => {
		const result = { scene, start: -1, end: -1 };
		if (scene.reviewReason) return { ...result, status: 'review', reason: scene.reviewReason };
		if (!MEMORY_LEVELS.includes(sceneLevel(scene))) return { ...result, status: 'review', reason: 'Unknown memory level.' };
		if (!scene.source.length || !scene.content.trim()) return { ...result, status: 'review', reason: 'This chapter has no valid source or text.' };
		for (const source of scene.source) {
			const message = byId.get(source.id);
			if (!message) return { ...result, status: 'review', reason: 'A source message was deleted.' };
			if (!signatures.has(message.id)) signatures.set(message.id, sceneSignature(message));
			if (signatures.get(message.id) !== source.signature) return { ...result, status: 'review', reason: 'Source text, images or visibility changed.' };
		}
		const indices = scene.source.map((source) => positions.get(source.id));
		if (indices.some((index) => index === undefined)) return { ...result, status: 'other-branch', reason: 'This chapter belongs to another branch.' };
		const start = indices[0]!;
		if (indices.some((index, offset) => index !== start + offset)) return { ...result, status: 'review', reason: 'The source range changed. Select its boundaries again.' };
		if (!path.slice(start, start + indices.length).some((m) => !m.excludedFromPrompt)) return { ...result, status: 'review', reason: 'Every source message is hidden from the prompt.' };
		return { scene, status: 'active', reason: '', start, end: start + indices.length - 1 };
	});
	const bySceneId = new Map(resolved.map(item => [item.scene.id, item]));
	// Validate dependencies from the bottom up before choosing which summaries enter the prompt.
	for (const level of MEMORY_LEVELS) {
		for (const item of resolved.filter(r => sceneLevel(r.scene) === level && r.status !== 'review')) {
			const children = item.scene.children ?? [];
			let reason = '';
			if (level === 'chapter') {
				if (children.length) reason = 'A chapter must refer to messages, not other memories.';
			} else {
				const lower = level === 'arc' ? 'chapter' : 'arc';
				const sources: SceneSource[] = [];
				if (children.length < 2 || new Set(children.map(c => c.id)).size !== children.length) reason = `Select at least two different ${lower}s.`;
				for (const child of children) {
					const original = bySceneId.get(child.id);
					if (!original || original.scene.chatId !== item.scene.chatId || sceneLevel(original.scene) !== lower ||
						original.scene.revision !== child.revision || original.status === 'review') {
						reason = 'A source memory changed, was removed or needs review. Review the sources and select them again.';
						break;
					}
					sources.push(...original.scene.source);
				}
				if (!reason && (sources.length !== item.scene.source.length || sources.some((s, i) => s.id !== item.scene.source[i].id || s.signature !== item.scene.source[i].signature))) {
					reason = 'The selected source memories no longer match this range. Select them again.';
				}
			}
			if (reason) { item.status = 'review'; item.reason = reason; }
		}
		// Overlap is legal only between a parent and its own validated descendants.
		const active = resolved.filter(item => sceneLevel(item.scene) === level && item.status === 'active').sort((a, b) => a.start - b.start);
		for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length && active[j].start <= active[i].end; j++) {
			active[i].status = active[j].status = 'review';
			active[i].reason = active[j].reason = `This ${level} overlaps another ${level}. Review the ranges.`;
		}
	}
	for (const parent of resolved.filter(r => r.status === 'active')) {
		for (const ref of parent.scene.children ?? []) {
			const child = bySceneId.get(ref.id)!;
			child.status = 'covered'; child.coveredBy = parent.scene.id;
		}
	}
	return resolved;
}

/** Consecutive saved memories, in transcript order; never compact raw gaps or stale text. */
export function prepareCompaction(level: CompactionLevel, selectedIds: string[], scenes: MemoryScene[], path: SceneMessage[], all = path, editingId?: string): { source: SceneSource[]; children: MemoryChild[] } {
	if (selectedIds.length < 2 || new Set(selectedIds).size !== selectedIds.length) throw new Error('Select at least two different source memories.');
	const lower = level === 'arc' ? 'chapter' : 'arc';
	const states = resolveScenes(scenes.filter(s => s.id !== editingId), path, all);
	const selected = selectedIds.map(id => states.find(r => r.scene.id === id));
	if (selected.some(r => !r || r.status !== 'active' || sceneLevel(r.scene) !== lower)) throw new Error(`Select valid ${lower}s that are not already compacted.`);
	const ordered = (selected as ResolvedScene[]).sort((a, b) => a.start - b.start);
	if (ordered.some((r, i) => i > 0 && r.start !== ordered[i - 1].end + 1)) throw new Error(`Select consecutive ${lower}s without uncovered messages between them.`);
	return { source: ordered.flatMap(r => r.scene.source.map(s => ({ ...s }))), children: ordered.map(r => ({ id: r.scene.id, revision: r.scene.revision })) };
}

/** Replace ranges at their original positions. Original rows and parent links stay untouched. */
export function sceneHistory<T extends SceneMessage>(path: T[], scenes: MemoryScene[]): (T & { memorySceneId?: string })[] {
	const starts = new Map(resolveScenes(scenes, path).filter((item) => item.status === 'active').map((item) => [item.start, item]));
	const history: (T & { memorySceneId?: string })[] = [];
	for (let i = 0; i < path.length; i++) {
		const item = starts.get(i);
		if (item) {
			const label = memoryLabel(sceneLevel(item.scene));
			history.push({ ...path[i], id: `scene:${item.scene.id}`, role: 'system',
				content: `[${label}: ${chapterTitle(item.scene.title)}]\n${item.scene.content}\n[End of ${label.toLowerCase()}]`,
				attachments: null, lorebook: null, thinking: null, excludedFromPrompt: false, memorySceneId: item.scene.id });
			i = item.end;
		} else if (!path[i].excludedFromPrompt) history.push(path[i]);
	}
	return history;
}
