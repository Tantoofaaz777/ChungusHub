import { describe, expect, test } from 'bun:test';
import { normalizeThreadsPrompts, activeThreadsPrompt, addThreadsPrompt, selectThreadsPrompt, updateThreadsPrompt, renameThreadsPrompt, removeThreadsPrompt } from './presets';

describe('Threads instruction presets', () => {
	test('migrates the existing custom instructions and safely repairs missing selections', () => {
		const first = normalizeThreadsPrompts(null, 'Existing custom instructions');
		expect(activeThreadsPrompt(first)).toMatchObject({ name: 'Default', content: 'Existing custom instructions' });
		expect(normalizeThreadsPrompts({ ...first, activeId: 'missing' }, 'Fallback')).toEqual(first);
		expect(activeThreadsPrompt(normalizeThreadsPrompts({prompts:[null,{id:'bad',name:'Bad'}]},'Fallback')).content).toBe('Fallback');
	});
	test('copies, edits and selects prompts independently without changing other saved content', () => {
		const first = normalizeThreadsPrompts(null, 'Original');
		let library = addThreadsPrompt(first, { id: 'new', name: ' New preset ', content: activeThreadsPrompt(first).content });
		expect(library.activeId).toBe('new');
		library = updateThreadsPrompt(library, 'new', 'Different instructions');
		library = selectThreadsPrompt(library, first.activeId);
		expect(activeThreadsPrompt(library).content).toBe('Original');
		expect(activeThreadsPrompt(selectThreadsPrompt(library, 'new'))).toMatchObject({name:'New preset',content:'Different instructions'});
		expect(first.prompts).toHaveLength(1);
	});
	test('rejects empty, long and duplicate names but allows renaming without changing the prompt', () => {
		let library = addThreadsPrompt(normalizeThreadsPrompts(null, 'Original'), { id: 'new', name: 'Other', content: 'Other content' });
		for (const name of ['', '   ', 'default', 'a'.repeat(101)]) expect(() => renameThreadsPrompt(library, 'new', name)).toThrow();
		library = renameThreadsPrompt(library, 'new', 'Renamed');
		expect(activeThreadsPrompt(library)).toEqual({id:'new',name:'Renamed',content:'Other content'});
	});
	test('deletes only the chosen preset, chooses a surviving prompt and keeps at least one', () => {
		const first = normalizeThreadsPrompts(null, 'Original');
		const two = addThreadsPrompt(first,{id:'new',name:'Other',content:'Other content'});
		expect(removeThreadsPrompt(two,'new')).toEqual(first);
		const remaining = removeThreadsPrompt(two, first.activeId);
		expect(activeThreadsPrompt(remaining).content).toBe('Other content');
		expect(() => removeThreadsPrompt(remaining,'new')).toThrow('Keep at least one prompt');
		expect(updateThreadsPrompt(remaining, first.activeId, 'Late editor flush')).toEqual(remaining);
		expect(() => selectThreadsPrompt(remaining, first.activeId)).toThrow();
	});
	test('a late edit belongs to its original preset even after another one is selected', () => {
		const original = normalizeThreadsPrompts(null, 'Original');
		const next = addThreadsPrompt(original,{id:'new',name:'Other',content:'Other content'});
		const saved = updateThreadsPrompt(next,original.activeId,'Pending edit');
		expect(activeThreadsPrompt(saved).content).toBe('Other content');
		expect(activeThreadsPrompt(selectThreadsPrompt(saved,original.activeId)).content).toBe('Pending edit');
	});
});
