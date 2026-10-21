import { beforeAll, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Exercise the real service, live context, macro expansion and message shaping together.
// Only singleton IO is replaced, inside a VM so no mock leaks into another test suite.
let source: string;
beforeAll(async () => {
	const mocks: Record<string, string> = {
		'$lib/services/llm/provider': `export const llmService={getPromptPostProcessing:()=>fixture.mode,getPromptPlaceholder:()=> '[Start]',complete:async(target,request)=>{fixture.sent.push({target,request});return {content:'A new draft'}}};`,
		'$lib/stores/featurePrompts.svelte': `export const featurePromptsStore={promptFor:()=>fixture.template,spellcheckEnabled:true,impersonateEnabled:true};`,
		'$lib/stores/promptHold.svelte': `export const promptHoldStore={review:async(kind,messages,target)=>{fixture.reviewed.push({kind,messages,target});return fixture.approved??messages}};`,
		'$lib/stores/chat.svelte': `export const chatStore={get activeChat(){return fixture.chat},get currentChatState(){return {activePath:fixture.messages}}};`,
		'$lib/stores/characterLibrary.svelte': `export const characterLibraryStore={get entries(){return [fixture.character,fixture.persona]},dataForVersion:()=>fixture.character.data};`,
		'$lib/memory/scene-store.svelte': `export const memoryStore={scenes:[]};`,
		'$lib/lorebook/store.svelte': `export const lorebookStore={booksForChat:()=>{fixture.access.push('lorebooks');return []}};`,
		'$lib/lorebook/settings.svelte': `export const lorebookSettingsStore={get settings(){fixture.access.push('lorebook-settings');return {budgetPercent:0}}};`,
		'$lib/stores/presetControls.svelte': `export const presetControlsStore={valuesFor:()=>{fixture.access.push('controls');return {roleplayOnly:'PRIVATE PRESET CONTROL'}}};`,
		'$lib/utils/chat-setup': `export const toPromptCharacter=(entry,data)=>entry?{name:entry.identity.name,traits:(data??entry.data).traits,pronouns:entry.identity.pronouns}:null;
			export const chatPersonaEntry=()=>fixture.persona;
			export const chatPreset=()=>{fixture.access.push('preset');return fixture.preset};
			export const resolvePromptTarget=()=>{fixture.access.push('primary-budget');return {model:'primary-model',contextBudget:4000}};
			export const chatLorebookClaim=()=>[];export const chatMutedLorebookClaim=()=>[];`,
		'$lib/lorebook/engine': `export function resolveLorebooks(){fixture.access.push('lorebook-scan');return {text:'PRIVATE LOREBOOK',trace:{records:[]}}}`,
		'$lib/tokenizer/count': `export const countTokens=()=>{throw new Error('Unexpected tokenization while building the transform')};`
	};
	const libRoot = fileURLToPath(new URL('../', import.meta.url));
	const byPath = new Map(Object.entries(mocks).map(([key, contents]) =>
		[join(libRoot, key.slice('$lib/'.length)).replaceAll('\\', '/') + '.ts', contents]));
	const build = await Bun.build({
		entrypoints: [fileURLToPath(new URL('./composerTransformService.ts', import.meta.url))],
		target: 'browser', format: 'cjs', write: false,
		define: { 'import.meta.env.DEV': 'false' },
		plugins: [{ name: 'isolated-transform-io', setup(builder) {
			builder.onLoad({ filter: /\.ts$/ }, args => {
				const contents = byPath.get(args.path.replaceAll('\\', '/'));
				return contents === undefined ? undefined : { contents, loader: 'js' };
			});
		} }]
	});
	if (!build.success) throw new Error(build.logs.join('\n'));
	source = await build.outputs[0].text();
});

function harness() {
	const messages = [
		{ id: 'a', parentId: null, role: 'assistant', content: '{{char}} greets {{user}}.', createdAt: 1 },
		{ id: 'u', parentId: 'a', role: 'user', content: 'I greet him back.', createdAt: 2 },
		{ id: 'hidden', parentId: 'u', role: 'assistant', content: 'HIDDEN TEXT', excludedFromPrompt: true, createdAt: 3 }
	];
	const fixture = {
		messages, template: 'Write {{user}} in third person: {{draft}}', mode: 'none',
		chat: { id: 'chat', characterId: 'character', characterVersionId: 'pinned', featureState: JSON.stringify({ authorsNote: { text: 'PRIVATE AUTHOR NOTE' } }) },
		character: { id: 'character', type: 'character', identity: { name: 'Sephiroth' }, data: { traits: { description: 'A character' }, lorebookIds: ['private-book'] } },
		persona: { id: 'persona', type: 'persona', identity: { name: 'Alice' }, data: { traits: { description: 'A persona' } } },
		preset: { id: 'preset', items: [{ content: 'PRIVATE ROLEPLAY INSTRUCTIONS' }], controls: [] },
		access: [] as string[], sent: [] as any[], reviewed: [] as any[], approved: undefined as any
	};
	const module = { exports: {} as typeof import('./composerTransformService') };
	runInNewContext(source, { module, exports: module.exports, fixture, console, DOMException });
	const params = { kind: 'impersonate' as const, draft: 'Say hello', chatMessages: messages as any };
	return { service: module.exports, fixture, params };
}

test('impersonation sends history and its own filled prompt without consulting RP inputs', () => {
	const { service, fixture, params } = harness();
	const messages = service.buildComposerTransformPrompt(params);
	expect(messages).toEqual([
		{ role: 'user', content: 'Sephiroth greets Alice.' },
		{ role: 'assistant', content: 'I greet him back.' },
		{ role: 'user', content: 'Write Alice in third person: Say hello' }
	]);
	expect(fixture.access).toEqual([]);
	fixture.preset.items = [{ content: 'A DIFFERENT ROLEPLAY PRESET' }];
	expect(service.buildComposerTransformPrompt(params)).toEqual(messages);
	expect(fixture.access).toEqual([]);
});

test('an impersonation override cannot pull private preset controls, lore or author notes', () => {
	const { service, fixture, params } = harness();
	fixture.template = '{{draft}} / {{roleplayOnly}} / {{lorebook}} / {{authorsNote}}';
	const messages = service.buildComposerTransformPrompt(params);
	expect(messages.at(-1)?.content).toContain('Say hello');
	expect(JSON.stringify(messages)).not.toContain('PRIVATE');
	expect(fixture.access).toEqual([]);
});

test('narrative person comes from the template, independently of legacy per-chat choices', () => {
	const { service, fixture, params } = harness();
	fixture.chat.featureState = JSON.stringify({ impersonatePerspective: 'first' });
	for (const person of ['first', 'second', 'third']) {
		fixture.template = `Write {{user}} in ${person} person: {{draft}}`;
		expect(service.buildComposerTransformPrompt(params).at(-1)?.content).toBe(`Write Alice in ${person} person: Say hello`);
	}
});

test('the engine connection still shapes the history, and review edits are what it sends', async () => {
	const { service, fixture, params } = harness();
	fixture.mode = 'single-user';
	expect(service.buildComposerTransformPrompt(params)).toHaveLength(1);
	fixture.approved = [{ role: 'user', content: 'Reviewed independent prompt' }];
	expect(await service.runComposerTransform(params)).toBe('A new draft');
	expect(fixture.sent[0]).toMatchObject({ target: { engine: 'impersonate' }, request: { source: 'impersonate', messages: fixture.approved } });
	expect(fixture.access).toEqual([]);
});

test('spellcheck keeps its existing context and single-message shape', () => {
	const { service, fixture, params } = harness();
	fixture.template = '{{draft}} / {{lorebook}}';
	expect(service.buildComposerTransformPrompt({ ...params, kind: 'spellcheck' })).toEqual([{ role: 'user', content: 'Say hello / PRIVATE LOREBOOK' }]);
	expect(fixture.access).toContain('preset');
	expect(fixture.access).toContain('controls');
	expect(fixture.access).toContain('lorebook-scan');
});
