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
}
export interface SaveMemoryScene {
	id?: string;
	chatId: string;
	title: string;
	content: string;
	source: SceneSource[];
	expectedRevision?: number;
}
export type SceneStatus = 'active' | 'review' | 'other-branch';
export interface ResolvedScene { scene: MemoryScene; status: SceneStatus; reason: string; start: number; end: number }

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
	const resolved = scenes.map((scene): ResolvedScene => {
		const result = { scene, start: -1, end: -1 };
		if (scene.reviewReason) return { ...result, status: 'review', reason: scene.reviewReason };
		if (!scene.source.length || !scene.content.trim()) return { ...result, status: 'review', reason: 'This chapter has no valid source or text.' };
		for (const source of scene.source) {
			const message = byId.get(source.id);
			if (!message) return { ...result, status: 'review', reason: 'A source message was deleted.' };
			if (sceneSignature(message) !== source.signature) return { ...result, status: 'review', reason: 'Source text, images or visibility changed.' };
		}
		const indices = scene.source.map((source) => positions.get(source.id));
		if (indices.some((index) => index === undefined)) return { ...result, status: 'other-branch', reason: 'This chapter belongs to another branch.' };
		const start = indices[0]!;
		if (indices.some((index, offset) => index !== start + offset)) return { ...result, status: 'review', reason: 'The source range changed. Select its boundaries again.' };
		if (!path.slice(start, start + indices.length).some((m) => !m.excludedFromPrompt)) return { ...result, status: 'review', reason: 'Every source message is hidden from the prompt.' };
		return { scene, status: 'active', reason: '', start, end: start + indices.length - 1 };
	});
	// A malformed/imported overlap never causes a message to disappear or be summarized twice.
	const active = resolved.filter((item) => item.status === 'active').sort((a, b) => a.start - b.start);
	for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length && active[j].start <= active[i].end; j++) {
		active[i].status = active[j].status = 'review';
		active[i].reason = active[j].reason = 'This chapter overlaps another chapter. Review the ranges.';
	}
	return resolved;
}

/** Replace ranges at their original positions. Original rows and parent links stay untouched. */
export function sceneHistory<T extends SceneMessage>(path: T[], scenes: MemoryScene[]): (T & { memorySceneId?: string })[] {
	const starts = new Map(resolveScenes(scenes, path).filter((item) => item.status === 'active').map((item) => [item.start, item]));
	const history: (T & { memorySceneId?: string })[] = [];
	for (let i = 0; i < path.length; i++) {
		const item = starts.get(i);
		if (item) {
			history.push({ ...path[i], id: `scene:${item.scene.id}`, role: 'system',
				content: `[Chapter: ${chapterTitle(item.scene.title)}]\n${item.scene.content}\n[End of chapter]`,
				attachments: null, lorebook: null, thinking: null, excludedFromPrompt: false, memorySceneId: item.scene.id });
			i = item.end;
		} else if (!path[i].excludedFromPrompt) history.push(path[i]);
	}
	return history;
}
