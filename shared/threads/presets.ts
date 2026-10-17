export interface ThreadsPromptPreset { id: string; name: string; content: string }
export interface ThreadsPromptLibrary { activeId: string; prompts: ThreadsPromptPreset[] }

/** Older installations had one instructions string. Preserve it as the first preset. */
export function normalizeThreadsPrompts(raw: unknown, fallback: string): ThreadsPromptLibrary {
	const value = raw && typeof raw === 'object' ? raw as Partial<ThreadsPromptLibrary> : null;
	const seen = new Set<string>();
	const prompts: ThreadsPromptPreset[] = [];
	for (const item of Array.isArray(value?.prompts) ? value.prompts : []) {
		if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || typeof item.content !== 'string') continue;
		seen.add(item.id); prompts.push({ id: item.id, name: item.name.trim().slice(0, 100), content: item.content });
	}
	if (!prompts.length) prompts.push({ id: 'threads-default', name: 'Default', content: fallback });
	return { prompts, activeId: prompts.some(p => p.id === value?.activeId) ? value!.activeId! : prompts[0].id };
}
export function activeThreadsPrompt(library: ThreadsPromptLibrary): ThreadsPromptPreset {
	return library.prompts.find(p => p.id === library.activeId) ?? library.prompts[0];
}
function nameFor(library: ThreadsPromptLibrary, name: string, exceptId?: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Enter a prompt name.');
	if (trimmed.length > 100) throw new Error('Use a prompt name with at most 100 characters.');
	if (library.prompts.some(p => p.id !== exceptId && p.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) throw new Error('A prompt with that name already exists.');
	return trimmed;
}
export function addThreadsPrompt(library: ThreadsPromptLibrary, preset: ThreadsPromptPreset): ThreadsPromptLibrary {
	if (!preset.id || library.prompts.some(p => p.id === preset.id)) throw new Error('This prompt already exists.');
	return { prompts: [...library.prompts, { ...preset, name: nameFor(library, preset.name) }], activeId: preset.id };
}
export function renameThreadsPrompt(library: ThreadsPromptLibrary, id: string, name: string): ThreadsPromptLibrary {
	if (!library.prompts.some(p => p.id === id)) throw new Error('This prompt no longer exists.');
	const nextName = nameFor(library, name, id);
	return { ...library, prompts: library.prompts.map(p => p.id === id ? { ...p, name: nextName } : p) };
}
export function selectThreadsPrompt(library: ThreadsPromptLibrary, id: string): ThreadsPromptLibrary {
	if (!library.prompts.some(p => p.id === id)) throw new Error('This prompt no longer exists.');
	return { ...library, activeId: id };
}
export function updateThreadsPrompt(library: ThreadsPromptLibrary, id: string, content: string): ThreadsPromptLibrary {
	// A delayed editor flush must never recreate a preset removed on another device.
	return { ...library, prompts: library.prompts.map(p => p.id === id ? { ...p, content } : p) };
}
export function removeThreadsPrompt(library: ThreadsPromptLibrary, id: string): ThreadsPromptLibrary {
	const index = library.prompts.findIndex(p => p.id === id);
	if (index < 0) return library;
	if (library.prompts.length === 1) throw new Error('Keep at least one prompt.');
	const prompts = library.prompts.filter(p => p.id !== id);
	return { prompts, activeId: library.activeId === id ? prompts[Math.min(index, prompts.length - 1)].id : library.activeId };
}
