import { afterAll, beforeEach, describe, test, expect, mock } from 'bun:test';
import { emptyAo3Information } from '$shared/threads/ao3';
import type { SaveThreadsRound, ThreadsData, ThreadsRound, ThreadsFeed } from '$shared/threads/types';
import { DEFAULT_THREADS_CONFIG } from '$shared/threads/model';
const identity = <T>(value:T)=>value;
(globalThis as any).$state = Object.assign(identity,{raw:identity,snapshot:structuredClone});
(globalThis as any).$derived = Object.assign(identity,{by:(fn:()=>unknown)=>fn()});
const realDb={...await import('$lib/services/database')};
const realChat={...await import('$lib/stores/chat.svelte')};
const realLlm={...await import('$lib/services/llm/provider')};
const realTokenizer={...await import('$lib/tokenizer')};
afterAll(()=>{
	mock.module('$lib/services/database',()=>realDb);mock.module('$lib/stores/chat.svelte',()=>realChat);
	mock.module('$lib/services/llm/provider',()=>realLlm);mock.module('$lib/tokenizer',()=>realTokenizer);
});
let reads: {chatId:string; resolve:(data:ThreadsData)=>void; reject:(error:Error)=>void}[]=[];
let calls: {messages:{content:string}[]; signal:AbortSignal; onToken:(text:string)=>void; onThinkingToken:(text:string)=>void; resolve:(result:{content:string;thinking?:string})=>void}[]=[];
let saved:SaveThreadsRound[]=[], failSave=false;
let resetGate: Promise<void> | null = null;
let resets: {chatId:string; expected:{id:string;revision:number}[]}[]=[];
let notesGate: Promise<void> | null = null;
let tokenCalls: { text:string; model:string }[]=[];
const path=Array.from({length:5},(_,i)=>({id:String(i+1),parentId:i ? String(i) : null,role:'assistant',content:`Turn ${i+1}`,excludedFromPrompt:i===1}));
const fakeChat:any={activeChat:{id:'a'},currentChatState:{chat:{id:'a'},activePath:path,allMessages:path}};
const empty=():ThreadsData=>({rounds:[],notes:'',ao3:emptyAo3Information(),promptId:null});
const feed:ThreadsFeed={title:'Discussion',post:{username:'op',body:'A question',score:1},comments:[{username:'reader',body:'A theory',score:2,replies:[{username:'other',body:'Agreed',score:1,replies:[]}]}]};
mock.module('$lib/services/database',()=>({...realDb,db:{
	resetThreadsContinuity:async(chatId:string,expected:{id:string;revision:number}[])=>{resets.push({chatId,expected});await resetGate;},
	getThreadsData:(chatId:string)=>new Promise((resolve,reject)=>reads.push({chatId,resolve,reject})),
	updateThreadsNotes:async()=>{ await notesGate; },
	saveThreadsRound:async(input:SaveThreadsRound):Promise<ThreadsRound>=>{saved.push(input);if(failSave)throw new Error('Disconnected');return {...input,revision:1,createdAt:1,activeVersionId:'v1',versions:[{id:'v1',createdAt:1,feed:input.feed}]};}
}}));
mock.module('$lib/stores/chat.svelte',()=>({...realChat,chatStore:fakeChat}));
mock.module('$lib/services/llm/provider',()=>({...realLlm,llmService:{modelFor:()=> 'test',getPromptTokenBudget:()=>100000,complete:(_target:unknown,options:any)=>new Promise(resolve=>calls.push({...options,resolve}))}}));
mock.module('$lib/tokenizer',()=>({...realTokenizer,countTokens:(text:string,model:string)=>{tokenCalls.push({text,model});return 100;}}));
const {ThreadsStore}=await import('./store.svelte');
const {threadsConfigStore}=await import('./config.svelte');
const {featurePromptsStore}=await import('$lib/stores/featurePrompts.svelte');
const initialFeatureState=structuredClone(featurePromptsStore.state);
let store:InstanceType<typeof ThreadsStore>;
beforeEach(()=>{featurePromptsStore.state=structuredClone(initialFeatureState);reads=[];calls=[];saved=[];resets=[];resetGate=null;failSave=false;notesGate=null;tokenCalls=[];threadsConfigStore.value={...DEFAULT_THREADS_CONFIG};fakeChat.activeChat={id:'a'};fakeChat.currentChatState={chat:{id:'a'},activePath:path,allMessages:path};store=new ThreadsStore();});
async function open() {const p=store.load('a');reads.shift()!.resolve(empty());await p;}
async function start() {store.selected=['5','2'];const p=store.generate();for(let i=0;i<100 && !calls.length;i++) await Promise.resolve();return {p};}
function previous():ThreadsRound {return {id:'previous',chatId:'a',label:'Prior scene',revision:1,createdAt:1,messages:[{...path[0],role:'assistant',index:0,speaker:'Narrator'}],activeVersionId:'v1',versions:[{id:'v1',createdAt:1,feed}]};}
describe('Threads generation lifecycle',()=>{
	test('ordinary panel reopens reuse data and preserve scene selection and notes',async()=>{
		await open();store.rounds=[previous()];store.selected=['2','5'];store.label='Next chapter';store.notes='A local note';store.tab='make';
		await store.ensureLoaded('a');
		expect(reads).toHaveLength(0);expect(store.loaded).toBe(true);expect(store.rounds).toHaveLength(1);
		expect(store.selected).toEqual(['2','5']);expect(store.label).toBe('Next chapter');expect(store.notes).toBe('A local note');expect(store.tab).toBe('make');
	});
	test('rapid panel reopens share the active read, while live sync explicitly reloads',async()=>{
		const opening=store.ensureLoaded('a'),reopening=store.ensureLoaded('a');expect(reads).toHaveLength(1);
		reads.shift()!.resolve({...empty(),notes:'Initial notes'});await Promise.all([opening,reopening]);
		await store.ensureLoaded('a');expect(reads).toHaveLength(0);
		const sync=store.syncReload();expect(reads).toHaveLength(1);
		reads.shift()!.resolve({...empty(),notes:'Another device edited this'});await sync;
		expect(store.notes).toBe('Another device edited this');
	});
	test('reopening during generation does not restart or interrupt the model call',async()=>{
		await open();const {p}=await start();expect(calls).toHaveLength(1);
		await store.ensureLoaded('a');expect(reads).toHaveLength(0);expect(calls).toHaveLength(1);
		expect(calls[0].signal.aborted).toBe(false);expect(store.phase).toBe('generating');
		calls[0].resolve({content:JSON.stringify(feed)});await p;
		expect(saved).toHaveLength(1);expect(store.rounds).toHaveLength(1);expect(store.phase).toBe('idle');
	});
	test('a failed initial read can be retried on the next opening',async()=>{
		const opening=store.ensureLoaded('a');reads.shift()!.reject(new Error('Offline'));await opening;
		expect(store.loaded).toBe(false);expect(store.error).toBe('Offline');
		const retry=store.ensureLoaded('a');expect(reads).toHaveLength(1);
		reads.shift()!.resolve(empty());await retry;expect(store.loaded).toBe(true);expect(store.error).toBe('');
	});
	test('switching chats rejects late data without duplicating the new chat read',async()=>{
		const a=store.ensureLoaded('a'),b=store.ensureLoaded('b');expect(reads).toHaveLength(2);
		reads[0].resolve({...empty(),notes:'A'});await a;
		const reopening=store.ensureLoaded('b');expect(reads).toHaveLength(2);expect(store.loaded).toBe(false);
		reads[1].resolve({...empty(),notes:'B'});await Promise.all([b,reopening]);
		expect(store.chatId).toBe('b');expect(store.notes).toBe('B');
		await store.ensureLoaded(null);expect(store.chatId).toBeNull();expect(store.rounds).toEqual([]);expect(store.notes).toBe('');
	});
	test('reset restores all source messages, including hidden ones, and preserves selection and notes',async()=>{
		await open();store.rounds=[previous()];store.selected=['2'];store.notes='Keep notes';store.promptId='chosen';
		expect(store.available.map(m=>m.id)).not.toContain('1');
		await store.resetContinuity('a',[{id:'previous',revision:1}]);
		expect(resets).toEqual([{chatId:'a',expected:[{id:'previous',revision:1}]}]);
		expect(store.rounds).toEqual([]);expect(store.available.map(m=>m.id)).toEqual(['1','2','3','4','5']);
		expect(store.available[1].excludedFromPrompt).toBe(true);expect(store.selected).toEqual(['2']);
		expect(store.notes).toBe('Keep notes');expect(store.promptId).toBe('chosen');expect(store.tab).toBe('make');
	});
	test('reset failure preserves rounds and reports the error',async()=>{
		await open();const round=previous();store.rounds=[round];
		resetGate=Promise.reject(new Error('Continuity changed'));
		await store.resetContinuity('a',[round]);
		expect(store.rounds).toEqual([round]);expect(store.error).toBe('Continuity changed');expect(store.busy).toBe(false);
	});
	test('reset ignores another chat or busy state and does not clear a newly opened chat',async()=>{
		await open();store.rounds=[previous()];await store.resetContinuity('b',[]);
		store.phase='generating';await store.resetContinuity('a',[]);expect(resets).toHaveLength(0);store.phase='idle';
		let release!:()=>void;resetGate=new Promise<void>(resolve=>release=resolve);
		const reset=store.resetContinuity('a',[]),next=store.load('b');
		const round={...previous(),id:'other',chatId:'b'};reads.shift()!.resolve({...empty(),rounds:[round]});await next;
		release();await reset;expect(store.chatId).toBe('b');expect(store.rounds).toEqual([round]);
	});
	test('late loads cannot replace the next chat',async()=>{
		const a=store.load('a'),b=store.load('b');reads[1].resolve({...empty(),notes:'B'});await b;reads[0].resolve({...empty(),notes:'A'});await a;
		expect(store.chatId).toBe('b');expect(store.notes).toBe('B');
	});
	test('saving the old chat’s notes cannot suppress loading the next chat’s metadata',async()=>{
		await open();let release!:()=>void;notesGate=new Promise<void>(resolve=>release=resolve);
		store.updateNotes({notes:'A note'});const writing=store.flushNotes();
		const next=store.load('b');reads.shift()!.resolve({...empty(),notes:'B note',ao3:{...emptyAo3Information(),title:'B title'}});await next;
		expect(store.notes).toBe('B note');expect(store.ao3.title).toBe('B title');release();await writing;
	});
	test('returning to a chat during a slow notes save keeps its local edits visible',async()=>{
		await open();let release!:()=>void;notesGate=new Promise<void>(resolve=>release=resolve);
		store.updateNotes({notes:'Latest local note'});const writing=store.flushNotes();
		const b=store.load('b');reads.shift()!.resolve(empty());await b;
		const a=store.load('a');reads.shift()!.resolve({...empty(),notes:'Older stored note'});await a;
		expect(store.notes).toBe('Latest local note');release();await writing;
	});
	test('sparse and hidden selections reach the model and save, unused gaps do not',async()=>{
		await open();const {p}=await start();expect(calls).toHaveLength(1);
		const prompt=calls[0].messages[0].content;expect(prompt).toContain('Turn 2');expect(prompt).toContain('Turn 5');expect(prompt).not.toContain('Turn 3');
		calls[0].resolve({content:JSON.stringify(feed)});await p;
		expect(saved[0].messages.map(m=>m.id)).toEqual(['2','5']);expect(store.rounds).toHaveLength(1);expect(store.selected).toEqual([]);expect(store.tab).toBe('feed');
	});
	test('long picker ranges and sparse selections reach preview and generation beyond the first 50 rows',async()=>{
		await open();
		const longPath=Array.from({length:200},(_,i)=>({id:String(i+1),parentId:i ? String(i) : null,role:'assistant',content:`Source message ${i+1}.`,excludedFromPrompt:i===99}));
		fakeChat.currentChatState={chat:{id:'a'},activePath:longPath,allMessages:longPath};
		store.rounds=[previous()];
		store.toggle('2');store.toggle('175',true);store.toggle('200');
		const expected=[...longPath.slice(1,175),longPath[199]].map(m=>m.id);
		expect(store.available).toHaveLength(199);
		expect(store.selected).toEqual(expected);expect(store.selectedCount).toBe(175);
		expect(store.promptPreview!.messages.map(m=>m.id)).toEqual(expected);
		expect(store.promptPreview!.messages.find(m=>m.id==='100')?.content).toBe('Source message 100.');
		const generating=store.generate();for(let i=0;i<100 && !calls.length;i++)await Promise.resolve();
		expect(calls).toHaveLength(1);
		const prompt=calls[0].messages[0].content;
		expect(prompt).toContain('Source message 175.');expect(prompt).toContain('Source message 200.');expect(prompt).not.toContain('Source message 176.');
		calls[0].resolve({content:JSON.stringify(feed)});await generating;
		expect(saved[0].messages.map(m=>m.id)).toEqual(expected);
	});
	test('the selection meter previews the same full prompt as generation without calling the model',async()=>{
		expect(store.promptPreview).toBeNull();await open();expect(store.promptPreview?.messages).toEqual([]);
		store.rounds=[previous()];store.selected=['5','2'];store.label='Current scene';store.notes='A reader note';
		store.ao3={...emptyAo3Information(),enabled:true,title:'Story metadata'};
		const input=store.promptPreview!;
		expect(input.messages.map(m=>m.content)).toEqual(['Turn 2','Turn 5']);
		expect(input.notes).toBe('A reader note');expect(input.previous).toHaveLength(1);
		expect(calls).toHaveLength(0);expect(saved).toHaveLength(0);
		const {threadsPrompt}=await import('$shared/threads/model');
		const expected=await threadsPrompt(input);const {p}=await start();
		expect(calls[0].messages[0].content).toBe(expected);
		expect(expected).toContain('# PREVIOUS CONTEXT\n\n## Prior scene\nTurn 1');
		expect(expected).toContain('# RECENT CONTEXT\n\n## Current scene\nTurn 2\n\nTurn 5');
		store.cancel();calls[0].resolve({content:JSON.stringify(feed)});await p;
		store.clearSelection();expect(store.promptPreview?.messages).toEqual([]);expect(store.promptPreview?.previous).toHaveLength(1);
	});
	test('streams separate model-aware reasoning and response estimates and refreshes from the final result',async()=>{
		await open();const {p}=await start();const call=calls[0];
		expect(store.tokenProgress).toEqual({reasoning:null,response:null});
		call.onThinkingToken('First ');call.onThinkingToken('thought');call.onToken('{"title":');
		await new Promise(resolve=>setTimeout(resolve,130));
		expect(store.tokenProgress).toEqual({reasoning:100,response:100});
		expect(tokenCalls).toContainEqual({text:'First thought',model:'test'});
		expect(tokenCalls).toContainEqual({text:'{"title":',model:'test'});
		const content=JSON.stringify(feed);call.resolve({content,thinking:'Complete thought'});await p;
		expect(tokenCalls).toContainEqual({text:'Complete thought',model:'test'});
		expect(tokenCalls).toContainEqual({text:content,model:'test'});
	});
	test('late progress and queued counts cannot update a cancelled generation or a different chat',async()=>{
		await open();const {p}=await start();const call=calls[0];call.onThinkingToken('Pending thought');
		store.cancel();const next=store.load('b');reads.shift()!.resolve(empty());await next;
		call.onToken('Late response');await new Promise(resolve=>setTimeout(resolve,130));
		expect(store.tokenProgress).toEqual({reasoning:null,response:null});
		call.resolve({content:JSON.stringify(feed)});await p;expect(saved).toHaveLength(0);
	});
	test('invalid JSON consumes no messages and preserves selection',async()=>{
		await open();const {p}=await start();calls[0].resolve({content:'not json'});await p;
		expect(saved).toHaveLength(0);expect(store.usedIds.size).toBe(0);expect(store.selected).toEqual(['5','2']);expect(store.error).toContain('JSON');
	});
	test('a chat prompt overrides the engine selection without changing it',async()=>{
		await open();featurePromptsStore.state={...featurePromptsStore.state,threadsPrompts:{activeId:'engine',prompts:[{id:'engine',name:'Engine',content:'ENGINE INSTRUCTIONS'},{id:'chat',name:'Chat',content:'CHAT INSTRUCTIONS'}]}};
		store.promptId='chat';const {p}=await start();
		expect(calls[0].messages[0].content).toContain('CHAT INSTRUCTIONS');expect(calls[0].messages[0].content).not.toContain('ENGINE INSTRUCTIONS');
		expect(featurePromptsStore.activeThreadsPrompt.id).toBe('engine');
		store.cancel();calls[0].resolve({content:JSON.stringify(feed)});await p;
	});
	test('unset and deleted chat presets fall back to the engine prompt',async()=>{
		featurePromptsStore.state={...featurePromptsStore.state,threadsPrompts:{activeId:'engine',prompts:[{id:'engine',name:'Engine',content:'ENGINE INSTRUCTIONS'}]}};
		for(const id of [null,'deleted']){
			await open();store.promptId=id;const before=calls.length;
			store.selected=['5','2'];const p=store.generate();for(let i=0;i<100 && calls.length===before;i++)await Promise.resolve();
			expect(calls.at(-1)!.messages[0].content).toContain('ENGINE INSTRUCTIONS');
			store.cancel();calls.at(-1)!.resolve({content:JSON.stringify(feed)});await p;
		}
	});
	test('an explicit return to the engine default survives a stale reload during a pending write',async()=>{
		await open();let release!:()=>void;notesGate=new Promise<void>(resolve=>release=resolve);
		store.updateNotes({promptId:'old'});const writing=store.flushNotes();store.updateNotes({promptId:null});
		const reloading=store.load('a');reads.shift()!.resolve({...empty(),promptId:'old'});await reloading;
		expect(store.promptId).toBeNull();release();await writing;await store.flushNotes();expect(store.promptId).toBeNull();
		const next=store.load('b');reads.shift()!.resolve({...empty(),promptId:'other'});await next;expect(store.promptId).toBe('other');
	});
	test('token continuity uses the engine model and captures the branch at generation time',async()=>{
		await open();store.rounds=[previous()];threadsConfigStore.value={...DEFAULT_THREADS_CONFIG,previousMode:'tokens',fandomMode:'tokens',previousTokens:150,fandomTokens:150};
		const {p}=await start();expect(calls).toHaveLength(1);expect(tokenCalls.length).toBeGreaterThan(2);expect(tokenCalls.every(c=>c.model==='test')).toBe(true);
		expect(calls[0].messages[0].content).toContain('# PREVIOUS CONTEXT');expect(calls[0].messages[0].content).toContain('# FANDOM CONTINUITY');
		calls[0].resolve({content:JSON.stringify(feed)});await p;expect(saved[0].branchLeafId).toBe('5');
	});
	test('cancelling during token-budget assembly never starts a model call',async()=>{
		await open();store.rounds=[previous()];store.selected=['2','5'];threadsConfigStore.value={...DEFAULT_THREADS_CONFIG,previousMode:'tokens'};
		const p=store.generate();for(let i=0;i<100 && !tokenCalls.length;i++)await Promise.resolve();
		expect(tokenCalls.length).toBeGreaterThan(0);store.cancel();await p;expect(calls).toHaveLength(0);expect(saved).toHaveLength(0);
	});
	test('partial scenes on another continuation do not hide shared turns, but a prefix-only overlap is rejected before billing',async()=>{
		await open();const old=previous();old.messages.push({...old.messages[0],id:'old-end'});
		store.rounds=[old];fakeChat.currentChatState.allMessages=[...path,{id:'old-end',parentId:'2'}];
		expect(store.available.some(m=>m.id==='1')).toBe(true);store.selected=['1'];await store.generate();
		expect(calls).toHaveLength(0);expect(store.error).toContain('overlap');
	});
	test('save failures retain the valid feed and retry without another generation',async()=>{
		await open();failSave=true;const {p}=await start();calls[0].resolve({content:JSON.stringify(feed)});await p;
		expect(store.pending).not.toBeNull();expect(store.error).toBe('Disconnected');
		failSave=false;await store.saveResult();expect(calls).toHaveLength(1);expect(saved[0].id).toBe(saved[1].id);expect(store.rounds).toHaveLength(1);expect(store.pending).toBeNull();
	});
	test('cancellation and chat changes ignore even a late successful completion',async()=>{
		for(const switchChat of [false,true]){
			await open();const {p}=await start();const call=calls.at(-1)!;
			if(switchChat){fakeChat.activeChat={id:'b'};fakeChat.currentChatState={chat:{id:'b'},activePath:[]};const next=store.load('b');reads.shift()!.resolve(empty());await next;}else store.cancel();
			expect(call.signal.aborted).toBe(true);call.resolve({content:JSON.stringify(feed)});await p;expect(saved).toHaveLength(0);expect(store.phase).toBe('idle');
			fakeChat.activeChat={id:'a'};fakeChat.currentChatState={chat:{id:'a'},activePath:path,allMessages:path};
		}
	});
});
